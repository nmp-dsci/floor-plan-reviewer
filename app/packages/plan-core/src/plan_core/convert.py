"""Convert the repo's plan_v##.json (v1 format: room rects + opening rects) to schema v2."""

from __future__ import annotations

import re
from typing import Any

from plan_core.schema import (
    DEFAULT_LEVEL,
    Fixture,
    Kind,
    Opening,
    PlanGeometry,
    Room,
    Wall,
    level_name,
)
from plan_core.validate import MIN_NESTED, MIN_ROOM
from plan_core.walls import derive_walls, locate_wall

# Vision extraction rounds room rects to the pixel grid, so adjacent rooms often
# overlap by a sliver. Nudge z=0 rooms apart when the penetration is at most this,
# by shrinking the later room's facing edge — keeps the common near-miss clean so
# it never trips the validator. Bigger overlaps are left for the validator to warn on.
HEAL_TOL = 0.2
_HEAL_OVERLAP_MIN = 0.05

_KIND_RULES: list[tuple[str, Kind]] = [
    ("bed", "bedroom"),
    ("ensuite", "wet"),
    ("bath", "wet"),
    ("wc", "wet"),
    ("kitchen", "kitchen"),
    ("l'dry", "laundry"),
    ("laundry", "laundry"),
    ("wir", "storage"),
    ("robe", "storage"),
    ("bir", "storage"),
    ("linen", "storage"),
    ("pantry", "storage"),
    ("hall", "circulation"),
    ("entry", "circulation"),
    ("living", "living"),
    ("lounge", "living"),
    ("dining", "living"),
    ("porch", "utility"),
    ("balcony", "utility"),
    ("store", "utility"),
    ("garage", "utility"),
]


def kind_for(name: str) -> Kind:
    low = name.lower()
    for needle, kind in _KIND_RULES:
        if needle in low:
            return kind
    return "room"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("\n", " ")).strip("-") or "room"


def _heal_overlaps(rooms: list[Room]) -> None:
    """Shrink slivers where the vision model rounded adjacent rooms into each other.
    Shrinking only reduces a room's extent, so it can never create a new overlap.
    Scoped per level like derive_walls — levels share a coordinate origin, so rooms
    on different structures must never be compared or one gets falsely shrunk."""
    by_level: dict[str, list[Room]] = {}
    for r in rooms:
        if r.z == 0:
            by_level.setdefault(r.level, []).append(r)
    for z0 in by_level.values():
        for i, a in enumerate(z0):
            for b in z0[i + 1 :]:  # adjust the later room; earlier rooms anchor
                ox = min(a.x2, b.x2) - max(a.x, b.x)
                oy = min(a.y2, b.y2) - max(a.y, b.y)
                if ox <= _HEAL_OVERLAP_MIN or oy <= _HEAL_OVERLAP_MIN or min(ox, oy) > HEAL_TOL:
                    continue
                if ox <= oy:  # horizontal penetration → trim b along x
                    nx, nw = (b.x, b.w - ox) if b.x <= a.x else (b.x + ox, b.w - ox)
                    ny, nh = b.y, b.h
                else:  # vertical penetration → trim b along y
                    nx, nw = b.x, b.w
                    ny, nh = (b.y, b.h - oy) if b.y <= a.y else (b.y + oy, b.h - oy)
                min_side = MIN_NESTED if (b.z or b.kind == "storage") else MIN_ROOM
                if min(nw, nh) < min_side:
                    continue  # below the validator's minimum — leave the modest overlap
                    # as a warning rather than heal into a blocking "too small" error
                b.x, b.y, b.w, b.h = nx, ny, nw, nh


def _level_order(rooms: list[Room]) -> list[str]:
    order: list[str] = []
    for r in rooms:
        if r.level not in order:
            order.append(r.level)
    return order or [DEFAULT_LEVEL]


def convert_v1(data: dict[str, Any]) -> PlanGeometry:
    rooms: list[Room] = []
    used: dict[str, int] = {}
    for raw in data.get("rooms", []):
        base = slugify(str(raw["name"]))
        used[base] = used.get(base, 0) + 1
        rid = base if used[base] == 1 else f"{base}-{used[base]}"
        rooms.append(
            Room(
                id=rid,
                name=str(raw["name"]).replace("\n", " "),
                kind=kind_for(str(raw["name"])),
                dims=str(raw.get("dims", "") or ""),
                x=float(raw["x"]),
                y=float(raw["y"]),
                w=float(raw["w"]),
                h=float(raw["h"]),
                fill="grey" if raw.get("fill") == "grey" else "white",
                z=int(raw.get("z", 0)),
                level=str(raw.get("level") or DEFAULT_LEVEL),
            )
        )

    _heal_overlaps(rooms)
    walls = derive_walls(rooms)

    # map v1 opening rects (white punches straddling a wall) onto derived walls —
    # scoped to the opening's own level so overlapping level coord-spaces don't cross-map
    room_level = {r.id: r.level for r in rooms}
    walls_by_level: dict[str, list[Wall]] = {}
    for wl in walls:
        walls_by_level.setdefault(room_level.get(wl.a, DEFAULT_LEVEL), []).append(wl)
    counter = 0
    unmapped: list[dict[str, Any]] = []
    for raw in data.get("openings", []):
        x, y = float(raw["x"]), float(raw["y"])
        w, h = float(raw["w"]), float(raw["h"])
        level_walls = walls_by_level.get(str(raw.get("level") or DEFAULT_LEVEL), walls)
        if h >= w:  # tall punch → vertical wall
            hit = locate_wall(level_walls, vertical=True, coord=x + w / 2, lo=y, hi=y + h)
        else:
            hit = locate_wall(level_walls, vertical=False, coord=y + h / 2, lo=x, hi=x + w)
        if hit is None:
            unmapped.append(raw)
            continue
        wall, t0, t1 = hit
        span = (t1 - t0) * wall.length
        counter += 1
        wall.openings.append(
            Opening(id=f"o{counter:02d}", type="open" if span >= 1.4 else "door", t0=t0, t1=t1)
        )

    fixtures = [
        Fixture(
            x=float(f["x"]),
            y=float(f["y"]),
            w=float(f["w"]),
            h=float(f["h"]),
            label=str(f.get("label", "")),
            level=str(f.get("level") or DEFAULT_LEVEL),
        )
        for f in data.get("fixtures", [])
    ]

    # ordered levels: honour the draft's list, then append any room level it missed.
    # Only levels that actually carry rooms are kept — a phantom level (declared in the
    # draft but tagged on no room) has no envelope, so it would inflate total_area and
    # draw an empty panel if it reached meta["levels"].
    order = _level_order(rooms)
    room_levels = set(order)
    draft_levels = data.get("levels") or []
    levels: list[dict[str, str]] = []
    seen: set[str] = set()
    for lvl in draft_levels:
        lid = str(lvl["id"])
        if lid not in room_levels or lid in seen:
            continue
        levels.append({"id": lid, "name": str(lvl.get("name") or level_name(lid))})
        seen.add(lid)
    for lid in order:
        if lid not in seen:
            levels.append({"id": lid, "name": level_name(lid)})
            seen.add(lid)

    # per-level footprint (each level has its own origin), plus a whole-plan bbox for back-compat
    envelopes: dict[str, list[float]] = {}
    for lid in order:
        lr = [r for r in rooms if r.level == lid]
        envelopes[lid] = [
            min(r.x for r in lr),
            min(r.y for r in lr),
            max(r.x2 for r in lr),
            max(r.y2 for r in lr),
        ]
    xs0 = min(r.x for r in rooms)
    ys0 = min(r.y for r in rooms)
    xs1 = max(r.x2 for r in rooms)
    ys1 = max(r.y2 for r in rooms)
    return PlanGeometry(
        property=str(data.get("property", "")),
        address=str(data.get("address", "")),
        rooms=rooms,
        walls=walls,
        fixtures=fixtures,
        meta={
            "envelope": [xs0, ys0, xs1, ys1],
            "envelopes": envelopes,
            "levels": levels,
            "source": "plan_v1",
            "source_version": data.get("version"),
            "unmapped_openings": len(unmapped),
        },
    )
