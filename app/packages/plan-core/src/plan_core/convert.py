"""Convert the repo's plan_v##.json (v1 format: room rects + opening rects) to schema v2."""

from __future__ import annotations

import re
from typing import Any

from plan_core.schema import Fixture, Kind, Opening, PlanGeometry, Room
from plan_core.walls import derive_walls, locate_wall

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
            )
        )

    walls = derive_walls(rooms)

    # map v1 opening rects (white punches straddling a wall) onto derived walls
    counter = 0
    unmapped: list[dict[str, Any]] = []
    for raw in data.get("openings", []):
        x, y = float(raw["x"]), float(raw["y"])
        w, h = float(raw["w"]), float(raw["h"])
        if h >= w:  # tall punch → vertical wall
            hit = locate_wall(walls, vertical=True, coord=x + w / 2, lo=y, hi=y + h)
        else:
            hit = locate_wall(walls, vertical=False, coord=y + h / 2, lo=x, hi=x + w)
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
        )
        for f in data.get("fixtures", [])
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
            "source": "plan_v1",
            "source_version": data.get("version"),
            "unmapped_openings": len(unmapped),
        },
    )
