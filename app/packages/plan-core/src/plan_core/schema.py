"""Schema v2: the plan as a typed shape object. All coordinates in metres, axis-aligned."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Kind = Literal[
    "bedroom",
    "living",
    "kitchen",
    "wet",
    "laundry",
    "storage",
    "circulation",
    "utility",
    "room",
]

OpeningType = Literal["door", "window", "open"]


class Room(BaseModel):
    id: str
    name: str
    kind: Kind = "room"
    dims: str = ""  # label override; empty → renderer auto-derives from w×h
    x: float
    y: float
    w: float
    h: float
    fill: Literal["white", "grey"] = "white"
    z: int = 0  # z=1 nests inside a z=0 parent (robes, pantry)

    @property
    def x2(self) -> float:
        return self.x + self.w

    @property
    def y2(self) -> float:
        return self.y + self.h

    @property
    def area(self) -> float:
        return self.w * self.h

    def contains(self, other: Room, tol: float = 0.11) -> bool:
        return (
            other.x >= self.x - tol
            and other.y >= self.y - tol
            and other.x2 <= self.x2 + tol
            and other.y2 <= self.y2 + tol
        )

    def describe(self) -> str:
        return f"{self.name.lower():<16} {self.w:.1f} x {self.h:.1f}m  {self.kind}"


class Opening(BaseModel):
    id: str
    type: OpeningType = "door"
    t0: float  # param along host wall line, 0..1
    t1: float


class Wall(BaseModel):
    id: str
    a: str  # room id (alphabetically first)
    b: str  # room id or "exterior"
    line: tuple[float, float, float, float]  # x1,y1,x2,y2 — axis-aligned
    t: float = 0.12  # thickness (m)
    openings: list[Opening] = Field(default_factory=list)

    @property
    def vertical(self) -> bool:
        return abs(self.line[0] - self.line[2]) < 1e-9

    @property
    def length(self) -> float:
        x1, y1, x2, y2 = self.line
        return abs(x2 - x1) + abs(y2 - y1)

    @property
    def coord(self) -> float:
        """The fixed axis coordinate (x for vertical walls, y for horizontal)."""
        return self.line[0] if self.vertical else self.line[1]

    def span(self) -> tuple[float, float]:
        """The varying-axis extent (lo, hi)."""
        x1, y1, x2, y2 = self.line
        return (min(y1, y2), max(y1, y2)) if self.vertical else (min(x1, x2), max(x1, x2))

    def t_to_abs(self, t: float) -> float:
        lo, hi = self.span()
        return lo + t * (hi - lo)

    def abs_to_t(self, v: float) -> float:
        lo, hi = self.span()
        return 0.0 if hi <= lo else (v - lo) / (hi - lo)

    def describe(self) -> str:
        pair = f"{self.a}/{self.b}"
        return f"{pair:<24} {self.length:.1f}m"


class Fixture(BaseModel):
    x: float
    y: float
    w: float
    h: float
    label: str = ""

    def key(self) -> tuple[float, float, float, float, str]:
        return (round(self.x, 2), round(self.y, 2), round(self.w, 2), round(self.h, 2), self.label)


class Change(BaseModel):
    """Metadata for one applied change batch — the register's hunk header."""

    id: str
    title: str
    rationale: str = ""
    rent_impact_per_week: float = 0
    flags: list[str] = Field(default_factory=list)


class Rent(BaseModel):
    currency: str = "AUD"
    baseline_per_week: float = 0
    proposed_per_week: float = 0


class PlanGeometry(BaseModel):
    schema_version: int = 2
    property: str = ""
    address: str = ""
    rooms: list[Room]
    walls: list[Wall] = Field(default_factory=list)
    fixtures: list[Fixture] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)

    def room(self, rid: str) -> Room:
        for r in self.rooms:
            if r.id == rid:
                return r
        raise KeyError(f"no room '{rid}'")

    def wall(self, wid: str) -> Wall:
        for w in self.walls:
            if w.id == wid:
                return w
        raise KeyError(f"no wall '{wid}'")

    def opening(self, oid: str) -> tuple[Wall, Opening]:
        for w in self.walls:
            for o in w.openings:
                if o.id == oid:
                    return w, o
        raise KeyError(f"no opening '{oid}'")

    def envelope(self) -> tuple[float, float, float, float]:
        env = self.meta.get("envelope")
        if env:
            return (float(env[0]), float(env[1]), float(env[2]), float(env[3]))
        xs0 = min(r.x for r in self.rooms)
        ys0 = min(r.y for r in self.rooms)
        xs1 = max(r.x2 for r in self.rooms)
        ys1 = max(r.y2 for r in self.rooms)
        return (xs0, ys0, xs1, ys1)

    def internal_area(self) -> float:
        return sum(r.area for r in self.rooms if r.z == 0 and r.fill != "grey")

    def summary_config(self) -> str:
        beds = sum(1 for r in self.rooms if r.kind == "bedroom")
        baths = sum(1 for r in self.rooms if r.kind == "wet" and "wc" not in r.name.lower())
        wcs = sum(1 for r in self.rooms if r.kind == "wet" and "wc" in r.name.lower())
        return f"{beds} bed · {baths} bath · {wcs} wc"
