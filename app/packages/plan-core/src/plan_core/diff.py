"""Object diff between two geometries + git-style register hunk generation.

Identity is by stable id (rooms) / stable key (openings, fixtures). Wall lines
that merely churn because an endpoint room was added/removed are suppressed —
the room line already tells that story.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from plan_core.dims import clear_describe
from plan_core.schema import Change, PlanGeometry, Wall


class DiffLine(BaseModel):
    op: Literal["add", "remove", "modify"]
    obj: Literal["room", "opening", "fixture"]
    id: str
    before: str = ""  # printable description pre-change (remove/modify)
    after: str = ""  # printable description post-change (add/modify)


def _opening_key(w: Wall, t0: float, t1: float, typ: str) -> str:
    c = round((t0 + t1) / 2 * w.length + (w.coord * 7.13), 1)
    return f"{w.a}|{w.b}|{typ}|{c}"


def _opening_desc(w: Wall, t0: float, t1: float, typ: str) -> str:
    span = (t1 - t0) * w.length
    pair = f"{w.a}↔{w.b}"
    return f"{pair:<24} {span:.1f}m  {typ}"


def diff_geometries(a: PlanGeometry, b: PlanGeometry) -> list[DiffLine]:
    lines: list[DiffLine] = []

    ra = {r.id: r for r in a.rooms}
    rb = {r.id: r for r in b.rooms}
    for rid in sorted(ra.keys() - rb.keys()):
        lines.append(
            DiffLine(op="remove", obj="room", id=rid, before=clear_describe(ra[rid], a.walls))
        )
    for rid in sorted(rb.keys() - ra.keys()):
        lines.append(DiffLine(op="add", obj="room", id=rid, after=clear_describe(rb[rid], b.walls)))
    for rid in sorted(ra.keys() & rb.keys()):
        x, y = ra[rid], rb[rid]
        geom_changed = abs(x.x - y.x) + abs(x.y - y.y) + abs(x.w - y.w) + abs(x.h - y.h) > 0.05
        if geom_changed or x.name != y.name or x.kind != y.kind or x.fill != y.fill:
            lines.append(
                DiffLine(
                    op="modify",
                    obj="room",
                    id=rid,
                    before=clear_describe(x, a.walls),
                    after=clear_describe(y, b.walls),
                )
            )

    def openings_map(g: PlanGeometry) -> dict[str, str]:
        out: dict[str, str] = {}
        for w in g.walls:
            for o in w.openings:
                out[_opening_key(w, o.t0, o.t1, o.type)] = _opening_desc(w, o.t0, o.t1, o.type)
        return out

    oa, ob = openings_map(a), openings_map(b)
    churned = (ra.keys() - rb.keys()) | (rb.keys() - ra.keys())

    def touches_churn(key: str) -> bool:
        wa, wb = key.split("|")[:2]
        return wa in churned or wb in churned

    for k in sorted(oa.keys() - ob.keys()):
        if not touches_churn(k):
            lines.append(DiffLine(op="remove", obj="opening", id=k, before=oa[k]))
    for k in sorted(ob.keys() - oa.keys()):
        if not touches_churn(k):
            lines.append(DiffLine(op="add", obj="opening", id=k, after=ob[k]))

    fa = {f.id: f for f in a.fixtures}
    fb = {f.id: f for f in b.fixtures}
    for fid in sorted(fa.keys() - fb.keys()):
        lines.append(DiffLine(op="remove", obj="fixture", id=fid, before=fa[fid].describe()))
    for fid in sorted(fb.keys() - fa.keys()):
        lines.append(DiffLine(op="add", obj="fixture", id=fid, after=fb[fid].describe()))
    for fid in sorted(fa.keys() & fb.keys()):
        fx, fy = fa[fid], fb[fid]
        moved = abs(fx.x - fy.x) + abs(fx.y - fy.y) + abs(fx.w - fy.w) + abs(fx.h - fy.h) > 0.05
        if moved or fx.label != fy.label:
            lines.append(
                DiffLine(
                    op="modify", obj="fixture", id=fid, before=fx.describe(), after=fy.describe()
                )
            )

    return lines


def register_hunk(change: Change, lines: list[DiffLine]) -> dict[str, object]:
    """One git-style hunk: header from change metadata, +/- body from the diff."""
    body: list[dict[str, str]] = []
    for line in lines:
        if line.op in ("remove", "modify") and line.before:
            body.append({"op": "remove", "text": f"{line.obj:<8} {line.before}"})
        if line.op in ("add", "modify") and line.after:
            body.append({"op": "add", "text": f"{line.obj:<8} {line.after}"})
    impact = (
        f"+${change.rent_impact_per_week:.0f}/wk"
        if change.rent_impact_per_week >= 0
        else f"-${abs(change.rent_impact_per_week):.0f}/wk"
    )
    return {
        "id": change.id,
        "title": change.title,
        "impact": impact,
        "rationale": change.rationale,
        "flags": change.flags,
        "author": change.author,
        "lines": body,
    }


class VersionRegister(BaseModel):
    hunks: list[dict[str, object]] = Field(default_factory=list)
