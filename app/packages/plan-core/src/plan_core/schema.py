"""Schema v2: the plan as a typed shape object. All coordinates in metres, axis-aligned."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

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


DEFAULT_LEVEL = "level-1"


def level_name(level_id: str) -> str:
    """Human label for a level id: 'level-1' → 'Level 1', 'garage' → 'Garage'."""
    return level_id.replace("-", " ").replace("_", " ").title()


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
    level: str = DEFAULT_LEVEL  # storey/structure this room belongs to; own coord origin

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


def fixture_slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "unit"


class Fixture(BaseModel):
    """Thin-line joinery: cabinetry, benches, robes. `id` is stable (`fx:<slug>-<n>`);
    geometries stored before ids existed get deterministic ids backfilled on read."""

    id: str = ""
    x: float
    y: float
    w: float
    h: float
    label: str = ""
    level: str = DEFAULT_LEVEL

    def describe(self) -> str:
        name = (self.label or "fixture").lower()
        return f"{name:<16} {self.w:.1f} x {self.h:.1f}m at ({self.x:.1f},{self.y:.1f})"


class Change(BaseModel):
    """Metadata for one applied change batch — the register's hunk header."""

    id: str
    title: str
    rationale: str = ""
    rent_impact_per_week: float = 0
    flags: list[str] = Field(default_factory=list)
    author: Literal["agent", "human"] = "agent"


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

    @model_validator(mode="after")
    def _backfill_fixture_ids(self) -> PlanGeometry:
        """Deterministic ids for pre-id geometries: fx:<label-slug>-<k> by occurrence
        order, so the same stored JSON always reads back with the same ids."""
        taken = {f.id for f in self.fixtures if f.id}
        counts: dict[str, int] = {}
        for f in self.fixtures:
            if f.id:
                continue
            slug = fixture_slug(f.label)
            counts[slug] = counts.get(slug, 0) + 1
            fid = f"fx:{slug}-{counts[slug]}"
            while fid in taken:
                counts[slug] += 1
                fid = f"fx:{slug}-{counts[slug]}"
            f.id = fid
            taken.add(fid)
        return self

    def room(self, rid: str) -> Room:
        for r in self.rooms:
            if r.id == rid:
                return r
        raise KeyError(f"no room '{rid}'")

    def fixture(self, fid: str) -> Fixture:
        for f in self.fixtures:
            if f.id == fid:
                return f
        raise KeyError(f"no fixture '{fid}'")

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

    # ---- levels (storeys / detached structures; each has its own coord origin) ----

    def level_ids(self) -> list[str]:
        """Ordered level ids: from meta['levels'] if present, else first-seen room order."""
        meta_levels = self.meta.get("levels")
        if meta_levels:
            return [str(lvl["id"]) for lvl in meta_levels]
        seen: list[str] = []
        for r in self.rooms:
            if r.level not in seen:
                seen.append(r.level)
        return seen or [DEFAULT_LEVEL]

    def levels(self) -> list[dict[str, str]]:
        """Ordered [{id, name}] for the tab strip — derived when meta is absent."""
        meta_levels = self.meta.get("levels")
        if meta_levels:
            return [
                {"id": str(lvl["id"]), "name": str(lvl.get("name") or level_name(lvl["id"]))}
                for lvl in meta_levels
            ]
        return [{"id": lid, "name": level_name(lid)} for lid in self.level_ids()]

    def rooms_on(self, level_id: str) -> list[Room]:
        return [r for r in self.rooms if r.level == level_id]

    def envelope(self) -> tuple[float, float, float, float]:
        env = self.meta.get("envelope")
        if env:
            return (float(env[0]), float(env[1]), float(env[2]), float(env[3]))
        xs0 = min(r.x for r in self.rooms)
        ys0 = min(r.y for r in self.rooms)
        xs1 = max(r.x2 for r in self.rooms)
        ys1 = max(r.y2 for r in self.rooms)
        return (xs0, ys0, xs1, ys1)

    def envelope_for(self, level_id: str) -> tuple[float, float, float, float]:
        """Pinned footprint of one level: meta['envelopes'][id], falling back to the
        legacy single meta['envelope'] (single-level plans) or that level's room bbox."""
        envelopes = self.meta.get("envelopes") or {}
        env = envelopes.get(level_id)
        if env:
            return (float(env[0]), float(env[1]), float(env[2]), float(env[3]))
        ids = self.level_ids()
        if len(ids) == 1 and self.meta.get("envelope"):
            return self.envelope()
        rooms = self.rooms_on(level_id)
        if not rooms:
            return (0.0, 0.0, 0.0, 0.0)  # roomless level: degenerate, never the whole plan
        return (
            min(r.x for r in rooms),
            min(r.y for r in rooms),
            max(r.x2 for r in rooms),
            max(r.y2 for r in rooms),
        )

    def internal_area(self) -> float:
        """Habitable internal area: z=0 rooms, excluding grey (non-habitable) space."""
        return sum(r.area for r in self.rooms if r.z == 0 and r.fill != "grey")

    def laid_out_area(self) -> float:
        """Every z=0 room, habitable or not — the interior actually assigned to rooms."""
        return sum(r.area for r in self.rooms if r.z == 0)

    def total_area(self) -> float:
        """External footprint in m² — summed per level so a detached garage doesn't
        inflate the figure with the empty gap between structures."""
        total = 0.0
        for lid in self.level_ids():
            x0, y0, x1, y1 = self.envelope_for(lid)
            total += (x1 - x0) * (y1 - y0)
        return total

    def summary_config(self) -> str:
        beds = sum(1 for r in self.rooms if r.kind == "bedroom")
        baths = sum(1 for r in self.rooms if r.kind == "wet" and "wc" not in r.name.lower())
        wcs = sum(1 for r in self.rooms if r.kind == "wet" and "wc" in r.name.lower())
        return f"{beds} bed · {baths} bath · {wcs} wc"
