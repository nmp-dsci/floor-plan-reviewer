"""Advisory NSW compliance flags per change — informative, never blocking."""

from __future__ import annotations

from plan_core.ops import AddOpening, MergeRooms, Op, RemoveRoom, RemoveWallChunk, SplitRoom
from plan_core.schema import PlanGeometry


def flags_for(before: PlanGeometry, after: PlanGeometry, ops: list[Op]) -> list[str]:
    flags: list[str] = []
    rb = {r.id: r for r in before.rooms}
    ra = {r.id: r for r in after.rooms}

    for rid, room in ra.items():
        prev = rb.get(rid)
        if room.kind == "bedroom" and (prev is None or prev.kind != "bedroom"):
            flags.append("New habitable room — natural light/ventilation ratios + smoke alarms")
        if room.kind == "wet" and (prev is None or prev.kind != "wet"):
            flags.append("New wet area — CDC + waterproofing; drainage run needs hydraulic advice")
        if prev is not None and prev.kind == "utility" and room.kind != "utility":
            flags.append("Change of use from non-habitable space — CDC/DA pathway likely")

    for op in ops:
        if isinstance(op, AddOpening | RemoveWallChunk):
            try:
                wall = before.wall(op.wall_id)
            except KeyError:
                continue
            span = (min(1.0, op.t1) - max(0.0, op.t0)) * wall.length
            if wall.b == "exterior":
                flags.append("New external opening — engineer + BASIX glazing requirements")
            elif span >= 1.4:
                flags.append("Wide internal opening — confirm the wall is not load-bearing")
        if isinstance(op, SplitRoom | MergeRooms | RemoveRoom):
            flags.append("Internal partition works — verify non-structural before removal")

    seen: set[str] = set()
    out: list[str] = []
    for f in flags:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out[:5]
