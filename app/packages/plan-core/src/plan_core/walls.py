"""Derive first-class walls from room-rectangle adjacency.

Rooms tile the plan with small gaps (0–0.35 m) that read as wall mass. A shared
wall exists where two z=0 rooms' edges face each other within GAP_TOL with
enough overlap; whatever part of a room edge no neighbour covers becomes an
exterior wall. z=1 rooms (robes, pantries) contribute four nested walls against
their containing parent.
"""

from __future__ import annotations

from itertools import combinations

from plan_core.schema import Room, Wall

GAP_TOL = 0.35
MIN_SHARED = 0.3

Interval = tuple[float, float]


def _overlap(a0: float, a1: float, b0: float, b1: float) -> Interval | None:
    lo, hi = max(a0, b0), min(a1, b1)
    return (lo, hi) if hi - lo >= MIN_SHARED else None


def _subtract(base: Interval, covers: list[Interval]) -> list[Interval]:
    """base minus union(covers), keeping pieces >= MIN_SHARED."""
    pieces = [base]
    for c0, c1 in sorted(covers):
        nxt: list[Interval] = []
        for p0, p1 in pieces:
            if c1 <= p0 or c0 >= p1:
                nxt.append((p0, p1))
                continue
            if c0 - p0 >= MIN_SHARED:
                nxt.append((p0, c0))
            if p1 - c1 >= MIN_SHARED:
                nxt.append((c1, p1))
        pieces = nxt
    return pieces


def derive_walls(rooms: list[Room]) -> list[Wall]:
    z0 = sorted((r for r in rooms if r.z == 0), key=lambda r: r.id)
    z1 = sorted((r for r in rooms if r.z != 0), key=lambda r: r.id)
    walls: list[Wall] = []
    # coverage[(room_id, edge)] -> intervals of that edge already explained by a neighbour
    coverage: dict[tuple[str, str], list[Interval]] = {}

    def cover(rid: str, edge: str, iv: Interval) -> None:
        coverage.setdefault((rid, edge), []).append(iv)

    def add_wall(a: str, b: str, line: tuple[float, float, float, float]) -> None:
        first, second = sorted((a, b)) if b != "exterior" else (a, b)
        k = sum(1 for w in walls if w.a == first and w.b == second)
        walls.append(Wall(id=f"w:{first}|{second}:{k}", a=first, b=second, line=line))

    for ra, rb in combinations(z0, 2):
        # vertical shared wall: ra right ↔ rb left (either order)
        for lft, rgt in ((ra, rb), (rb, ra)):
            if abs(lft.x2 - rgt.x) <= GAP_TOL:
                iv = _overlap(lft.y, lft.y2, rgt.y, rgt.y2)
                if iv:
                    xm = (lft.x2 + rgt.x) / 2
                    add_wall(lft.id, rgt.id, (xm, iv[0], xm, iv[1]))
                    cover(lft.id, "right", iv)
                    cover(rgt.id, "left", iv)
        # horizontal shared wall: ra bottom ↔ rb top (either order)
        for top, bot in ((ra, rb), (rb, ra)):
            if abs(top.y2 - bot.y) <= GAP_TOL:
                iv = _overlap(top.x, top.x2, bot.x, bot.x2)
                if iv:
                    ym = (top.y2 + bot.y) / 2
                    add_wall(top.id, bot.id, (iv[0], ym, iv[1], ym))
                    cover(top.id, "bottom", iv)
                    cover(bot.id, "top", iv)

    # nested rooms: four walls against the containing parent
    for nr in z1:
        parent = next((p for p in z0 if p.contains(nr)), None)
        pid = parent.id if parent else "exterior"
        add_wall(nr.id, pid, (nr.x, nr.y, nr.x2, nr.y))
        add_wall(nr.id, pid, (nr.x, nr.y2, nr.x2, nr.y2))
        add_wall(nr.id, pid, (nr.x, nr.y, nr.x, nr.y2))
        add_wall(nr.id, pid, (nr.x2, nr.y, nr.x2, nr.y2))

    # exterior walls: whatever no neighbour covered
    edge_specs: list[tuple[str, bool]] = [
        ("left", True),
        ("right", True),
        ("top", False),
        ("bottom", False),
    ]
    for r in z0:
        for edge, vertical in edge_specs:
            base: Interval = (r.y, r.y2) if vertical else (r.x, r.x2)
            coord = {"left": r.x, "right": r.x2, "top": r.y, "bottom": r.y2}[edge]
            for iv in _subtract(base, coverage.get((r.id, edge), [])):
                line = (coord, iv[0], coord, iv[1]) if vertical else (iv[0], coord, iv[1], coord)
                add_wall(r.id, "exterior", line)

    return walls


def locate_wall(
    walls: list[Wall],
    vertical: bool,
    coord: float,
    lo: float,
    hi: float,
    coord_tol: float = 0.45,
) -> tuple[Wall, float, float] | None:
    """Find the wall best matching an absolute span; returns (wall, t0, t1)."""
    best: tuple[float, Wall] | None = None
    for w in walls:
        if w.vertical != vertical or abs(w.coord - coord) > coord_tol:
            continue
        wlo, whi = w.span()
        olap = min(hi, whi) - max(lo, wlo)
        if olap > 0.05 and (best is None or olap > best[0]):
            best = (olap, w)
    if best is None:
        return None
    w = best[1]
    t0 = max(0.0, min(1.0, w.abs_to_t(max(lo, w.span()[0]))))
    t1 = max(0.0, min(1.0, w.abs_to_t(min(hi, w.span()[1]))))
    return (w, t0, t1) if t1 - t0 > 1e-6 else None
