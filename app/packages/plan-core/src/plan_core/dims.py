"""Clear internal dimensions — room size measured wall inner face to wall inner face.

Room rects span to the wall centreline gap, so raw w×h overstates usable space.
The clear size subtracts each side's wall encroachment (how far the drawn wall
intrudes past the room edge). This is the ONE dimension standard: canvas labels,
register lines, PNG export and the context-bar areas all use it. Ops and the
agent keep working in rect space — clear size is a derived display quantity.
"""

from __future__ import annotations

from plan_core.schema import PlanGeometry, Room, Wall

INTERIOR_HALF = 0.09
EXTERIOR_HALF = 0.11
COORD_TOL = 0.4  # wall centreline within this of the room edge counts as that edge's wall
MIN_OVERLAP = 0.3  # wall span must overlap the edge by at least this much

_EDGES = ("left", "right", "top", "bottom")


def _encroachment(room: Room, walls: list[Wall], edge: str) -> float:
    vertical = edge in ("left", "right")
    coord = {
        "left": room.x,
        "right": room.x2,
        "top": room.y,
        "bottom": room.y2,
    }[edge]
    span = (room.y, room.y2) if vertical else (room.x, room.x2)
    enc = 0.0
    for w in walls:
        if w.vertical != vertical:
            continue
        if w.a != room.id and w.b != room.id:
            continue
        if abs(w.coord - coord) > COORD_TOL:
            continue
        lo, hi = w.span()
        if min(hi, span[1]) - max(lo, span[0]) < MIN_OVERLAP:
            continue
        half = EXTERIOR_HALF if w.b == "exterior" else INTERIOR_HALF
        inner = w.coord + half if edge in ("left", "top") else w.coord - half
        e = inner - coord if edge in ("left", "top") else coord - inner
        if e > enc:
            enc = e
    return enc


def clear_size(room: Room, walls: list[Wall]) -> tuple[float, float]:
    """(clear width, clear height) in metres — never below 0."""
    cw = room.w - _encroachment(room, walls, "left") - _encroachment(room, walls, "right")
    ch = room.h - _encroachment(room, walls, "top") - _encroachment(room, walls, "bottom")
    return (max(cw, 0.0), max(ch, 0.0))


def clear_dims_label(room: Room, walls: list[Wall]) -> str:
    cw, ch = clear_size(room, walls)
    return f"{cw:.2f} x {ch:.2f}m"


def clear_describe(room: Room, walls: list[Wall]) -> str:
    """Register-line description using clear dimensions."""
    cw, ch = clear_size(room, walls)
    return f"{room.name.lower():<16} {cw:.1f} x {ch:.1f}m  {room.kind}"


def clear_internal_area(geo: PlanGeometry) -> float:
    """Habitable internal area from clear sizes (z=0, non-grey rooms)."""
    total = 0.0
    for r in geo.rooms:
        if r.z == 0 and r.fill != "grey":
            cw, ch = clear_size(r, geo.walls)
            total += cw * ch
    return total
