"""Typed geometry operations — the ONLY way the agent may edit a plan.

apply_ops() copies the geometry, applies room/fixture mutations, re-derives
walls, and re-maps every opening (existing + newly added) onto the new walls by
absolute position. Unmappable openings become warnings, never crashes.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from plan_core.convert import kind_for, slugify
from plan_core.schema import (
    DEFAULT_LEVEL,
    Fixture,
    Kind,
    Opening,
    OpeningType,
    PlanGeometry,
    Room,
    Wall,
    fixture_slug,
)
from plan_core.walls import derive_walls, locate_wall


class Rename(BaseModel):
    op: Literal["rename"]
    room_id: str
    name: str


class SetKind(BaseModel):
    op: Literal["set_kind"]
    room_id: str
    kind: Kind | None = None
    name: str | None = None
    fill: Literal["white", "grey"] | None = None


class ResizeRoom(BaseModel):
    op: Literal["resize_room"]
    room_id: str
    x: float
    y: float
    w: float
    h: float


class SplitRoom(BaseModel):
    op: Literal["split_room"]
    room_id: str
    axis: Literal["x", "y"]  # "x" → vertical cut at x=at; "y" → horizontal cut at y=at
    at: float
    new_name: str
    new_kind: Kind | None = None
    side: Literal["low", "high"] = "high"  # which side becomes the NEW room
    gap: float = 0.1  # wall gap left between the two rooms


class AddRoom(BaseModel):
    op: Literal["add_room"]
    name: str
    kind: Kind | None = None
    x: float
    y: float
    w: float
    h: float
    fill: Literal["white", "grey"] = "white"
    level: str | None = None  # which storey/structure; defaults to the plan's first level


class MergeRooms(BaseModel):
    op: Literal["merge_rooms"]
    room_id: str
    other_id: str
    name: str | None = None
    kind: Kind | None = None


class RemoveRoom(BaseModel):
    op: Literal["remove_room"]
    room_id: str


class AddOpening(BaseModel):
    op: Literal["add_opening"]
    wall_id: str
    t0: float
    t1: float
    type: OpeningType = "door"


class ModifyOpening(BaseModel):
    op: Literal["modify_opening"]
    opening_id: str
    t0: float | None = None
    t1: float | None = None
    type: OpeningType | None = None


class RemoveOpening(BaseModel):
    op: Literal["remove_opening"]
    opening_id: str


class RemoveWallChunk(BaseModel):
    op: Literal["remove_wall_chunk"]
    wall_id: str
    t0: float
    t1: float


class AddFixture(BaseModel):
    op: Literal["add_fixture"]
    x: float
    y: float
    w: float
    h: float
    label: str = ""
    level: str | None = None


class ModifyFixture(BaseModel):
    op: Literal["modify_fixture"]
    fixture_id: str
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None
    label: str | None = None


class RemoveFixture(BaseModel):
    op: Literal["remove_fixture"]
    fixture_id: str = ""
    index: int | None = None  # legacy positional form; prefer fixture_id


_OpUnion = (
    Rename
    | SetKind
    | ResizeRoom
    | SplitRoom
    | AddRoom
    | MergeRooms
    | RemoveRoom
    | AddOpening
    | ModifyOpening
    | RemoveOpening
    | RemoveWallChunk
    | AddFixture
    | ModifyFixture
    | RemoveFixture
)
Op = Annotated[_OpUnion, Field(discriminator="op")]

_OPS_ADAPTER: TypeAdapter[list[Op]] = TypeAdapter(list[Op])


def parse_ops(raw: object) -> list[Op]:
    return _OPS_ADAPTER.validate_python(raw)


class _AbsOpening(BaseModel):
    vertical: bool
    coord: float
    lo: float
    hi: float
    type: OpeningType
    id: str
    level: str  # host structure — openings only re-home onto same-level walls


class OpsResult(BaseModel):
    geometry: PlanGeometry
    warnings: list[str] = Field(default_factory=list)


def _snapshot_openings(geo: PlanGeometry) -> list[_AbsOpening]:
    # a wall's level is the level of its room (wall.a is always a real room id)
    room_level = {r.id: r.level for r in geo.rooms}
    out: list[_AbsOpening] = []
    for w in geo.walls:
        for o in w.openings:
            out.append(
                _AbsOpening(
                    vertical=w.vertical,
                    coord=w.coord,
                    lo=w.t_to_abs(o.t0),
                    hi=w.t_to_abs(o.t1),
                    type=o.type,
                    id=o.id,
                    level=room_level.get(w.a, DEFAULT_LEVEL),
                )
            )
    return out


def _default_level(geo: PlanGeometry) -> str:
    ids = geo.level_ids()
    return ids[0] if ids else "level-1"


def _unique_id(rooms: list[Room], name: str) -> str:
    base = slugify(name)
    if all(r.id != base for r in rooms):
        return base
    i = 2
    while any(r.id == f"{base}-{i}" for r in rooms):
        i += 1
    return f"{base}-{i}"


def apply_ops(geo: PlanGeometry, ops: list[Op]) -> OpsResult:
    g = geo.model_copy(deep=True)
    warnings: list[str] = []
    abs_openings = _snapshot_openings(g)
    # add_opening / remove_wall_chunk, resolved against the re-derived walls after the loop
    deferred_openings: list[tuple[str, float, float, OpeningType, str]] = []
    max_oid = max(
        (int(o.id[1:]) for o in abs_openings if o.id[1:].isdigit()),
        default=0,
    )

    def next_oid() -> str:
        nonlocal max_oid
        max_oid += 1
        return f"o{max_oid:02d}"

    for op in ops:
        # Skip (don't crash) ops whose target no longer exists — e.g. an
        # uncommitted preview id (pv-room1) that never reached the server, or a
        # room removed earlier in the same batch.
        room_ref = getattr(op, "room_id", None)
        if room_ref is not None and all(r.id != room_ref for r in g.rooms):
            warnings.append(f"{op.op}: room '{room_ref}' not found; skipped")
            continue
        other_ref = getattr(op, "other_id", None)
        if other_ref is not None and all(r.id != other_ref for r in g.rooms):
            warnings.append(f"{op.op}: room '{other_ref}' not found; skipped")
            continue
        wall_ref = getattr(op, "wall_id", None)
        # add_opening / remove_wall_chunk are resolved AFTER walls are re-derived (a room
        # move in the same batch changes wall ids), so don't reject them against old walls.
        if (
            wall_ref is not None
            and not isinstance(op, AddOpening | RemoveWallChunk)
            and all(w.id != wall_ref for w in g.walls)
        ):
            warnings.append(f"{op.op}: wall '{wall_ref}' not found; skipped")
            continue

        if isinstance(op, Rename):
            g.room(op.room_id).name = op.name
        elif isinstance(op, SetKind):
            r = g.room(op.room_id)
            if op.kind:
                r.kind = op.kind
            if op.name:
                r.name = op.name
                if not op.kind:
                    r.kind = kind_for(op.name)
            if op.fill:
                r.fill = op.fill
            r.dims = ""  # geometry unchanged; keep auto dims honest
        elif isinstance(op, ResizeRoom):
            r = g.room(op.room_id)
            r.x, r.y, r.w, r.h = op.x, op.y, op.w, op.h
            r.dims = ""
        elif isinstance(op, SplitRoom):
            r = g.room(op.room_id)
            half = op.gap / 2
            if op.axis == "x":
                if not (r.x + 0.5 < op.at < r.x2 - 0.5):
                    warnings.append(f"split_room {op.room_id}: cut {op.at} outside room; skipped")
                    continue
                low = (r.x, r.y, op.at - half - r.x, r.h)
                high = (op.at + half, r.y, r.x2 - op.at - half, r.h)
            else:
                if not (r.y + 0.5 < op.at < r.y2 - 0.5):
                    warnings.append(f"split_room {op.room_id}: cut {op.at} outside room; skipped")
                    continue
                low = (r.x, r.y, r.w, op.at - half - r.y)
                high = (r.x, op.at + half, r.w, r.y2 - op.at - half)
            keep, new = (high, low) if op.side == "low" else (low, high)
            r.x, r.y, r.w, r.h = keep
            r.dims = ""
            g.rooms.append(
                Room(
                    id=_unique_id(g.rooms, op.new_name),
                    name=op.new_name,
                    kind=op.new_kind or kind_for(op.new_name),
                    x=new[0],
                    y=new[1],
                    w=new[2],
                    h=new[3],
                    fill=r.fill,
                    z=r.z,
                    level=r.level,
                )
            )
        elif isinstance(op, AddRoom):
            g.rooms.append(
                Room(
                    id=_unique_id(g.rooms, op.name),
                    name=op.name,
                    kind=op.kind or kind_for(op.name),
                    x=op.x,
                    y=op.y,
                    w=op.w,
                    h=op.h,
                    fill=op.fill,
                    z=0,
                    level=op.level or _default_level(g),
                )
            )
        elif isinstance(op, MergeRooms):
            r, o = g.room(op.room_id), g.room(op.other_id)
            x0, y0 = min(r.x, o.x), min(r.y, o.y)
            x1, y1 = max(r.x2, o.x2), max(r.y2, o.y2)
            union_area = (x1 - x0) * (y1 - y0)
            if union_area > r.area + o.area + 1.2:
                warnings.append(
                    f"merge_rooms {op.room_id}+{op.other_id}: union is not rectangular; skipped"
                )
                continue
            r.x, r.y, r.w, r.h = x0, y0, x1 - x0, y1 - y0
            if op.name:
                r.name = op.name
            r.kind = op.kind or r.kind
            r.dims = ""
            g.rooms = [rm for rm in g.rooms if rm.id != op.other_id]
        elif isinstance(op, RemoveRoom):
            g.rooms = [rm for rm in g.rooms if rm.id != op.room_id]
        elif isinstance(op, AddOpening | RemoveWallChunk):
            t0, t1 = sorted((max(0.0, op.t0), min(1.0, op.t1)))
            typ: OpeningType = "open" if isinstance(op, RemoveWallChunk) else op.type
            # resolve against the re-derived walls (its id/positions are final there)
            deferred_openings.append((op.wall_id, t0, t1, typ, next_oid()))
        elif isinstance(op, ModifyOpening):
            found = next((a for a in abs_openings if a.id == op.opening_id), None)
            if found is None:
                warnings.append(f"modify_opening: '{op.opening_id}' not found; skipped")
                continue
            host, _ = geo.opening(op.opening_id)
            if op.t0 is not None:
                found.lo = host.t_to_abs(op.t0)
            if op.t1 is not None:
                found.hi = host.t_to_abs(op.t1)
            if op.type is not None:
                found.type = op.type
        elif isinstance(op, RemoveOpening):
            before = len(abs_openings)
            abs_openings = [a for a in abs_openings if a.id != op.opening_id]
            if len(abs_openings) == before:
                warnings.append(f"remove_opening: '{op.opening_id}' not found; skipped")
        elif isinstance(op, AddFixture):
            slug = fixture_slug(op.label)
            k = 1
            while any(f.id == f"fx:{slug}-{k}" for f in g.fixtures):
                k += 1
            g.fixtures.append(
                Fixture(
                    id=f"fx:{slug}-{k}",
                    x=op.x,
                    y=op.y,
                    w=op.w,
                    h=op.h,
                    label=op.label,
                    level=op.level or _default_level(g),
                )
            )
        elif isinstance(op, ModifyFixture):
            fx = next((f for f in g.fixtures if f.id == op.fixture_id), None)
            if fx is None:
                warnings.append(f"modify_fixture: '{op.fixture_id}' not found; skipped")
                continue
            if op.x is not None:
                fx.x = op.x
            if op.y is not None:
                fx.y = op.y
            if op.w is not None:
                fx.w = op.w
            if op.h is not None:
                fx.h = op.h
            if op.label is not None:
                fx.label = op.label
        elif isinstance(op, RemoveFixture):
            if op.fixture_id:
                before_n = len(g.fixtures)
                g.fixtures = [f for f in g.fixtures if f.id != op.fixture_id]
                if len(g.fixtures) == before_n:
                    warnings.append(f"remove_fixture: '{op.fixture_id}' not found; skipped")
            elif op.index is not None and 0 <= op.index < len(g.fixtures):
                g.fixtures.pop(op.index)
            else:
                warnings.append(f"remove_fixture: index {op.index} out of range; skipped")

    # rebuild walls from the mutated rooms, then place the deferred new openings onto the
    # final walls (their wall ids/positions are only correct here), then re-home everything
    g.walls = derive_walls(g.rooms)
    # scope re-homing per level like convert_v1/derive_walls: detached structures share a
    # coord origin, so an opening must never re-home onto a different level's wall
    room_level = {r.id: r.level for r in g.rooms}
    walls_by_level: dict[str, list[Wall]] = {}
    for wl in g.walls:
        walls_by_level.setdefault(room_level.get(wl.a, DEFAULT_LEVEL), []).append(wl)
    for wall_id, t0, t1, typ, oid in deferred_openings:
        w = next((wl for wl in g.walls if wl.id == wall_id), None)
        if w is None:
            warnings.append(f"add_opening: wall '{wall_id}' no longer exists; skipped")
            continue
        abs_openings.append(
            _AbsOpening(
                vertical=w.vertical,
                coord=w.coord,
                lo=w.t_to_abs(t0),
                hi=w.t_to_abs(t1),
                type=typ,
                id=oid,
                level=room_level.get(w.a, DEFAULT_LEVEL),
            )
        )
    for a in abs_openings:
        hit = locate_wall(
            walls_by_level.get(a.level, []),
            vertical=a.vertical,
            coord=a.coord,
            lo=a.lo,
            hi=a.hi,
        )
        if hit is None:
            warnings.append(f"opening {a.id} ({a.type}) no longer sits on any wall; dropped")
            continue
        wall, t0, t1 = hit
        if any(o.id == a.id for o in wall.openings):
            continue
        wall.openings.append(Opening(id=a.id, type=a.type, t0=t0, t1=t1))

    return OpsResult(geometry=g, warnings=warnings)
