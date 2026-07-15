"""Geometry validation — the bounce-back the agent gets when an edit is unsafe.

Errors block a version; warnings ride along. The envelope check enforces the
project's core invariant: the external footprint recorded at conversion time
can never grow. Everything runs PER LEVEL — a detached garage and the house each
have their own coordinate origin and pinned footprint, so an overlap or envelope
breach on one level is never measured against another.
"""

from __future__ import annotations

from itertools import combinations

from plan_core.schema import PlanGeometry

ENVELOPE_TOL = 0.06
OVERLAP_TOL = 0.05
# Rooms tile with small imprecisions; a modest overlap is a drawing artefact the
# renderer tolerates (a slightly thicker wall), reported as a warning. Only a gross
# overlap — rooms genuinely stacked — is a blocking error.
GROSS_OVERLAP = 1.0
MIN_ROOM = 0.7
MIN_NESTED = 0.45
# The overall footprint (bounding box of z=0 rooms) must keep the pinned envelope's
# width and length — the external boundary can neither grow NOR shrink. Catches an
# agent quietly restretching the plan (e.g. garage 10.8 m → 12.0 m).
FOOTPRINT_TOL = 0.12


def _pinned_envelope(geo: PlanGeometry, level_id: str) -> tuple[float, float, float, float] | None:
    """The immutable footprint recorded for a level, or None if never pinned."""
    envelopes = geo.meta.get("envelopes") or {}
    env = envelopes.get(level_id)
    if not env and len(geo.level_ids()) == 1:
        env = geo.meta.get("envelope")
    if not env:
        return None
    return (float(env[0]), float(env[1]), float(env[2]), float(env[3]))


def validate(geo: PlanGeometry) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    ids = [r.id for r in geo.rooms]
    for dup in {i for i in ids if ids.count(i) > 1}:
        errors.append(f"duplicate room id '{dup}'")

    for level_id in geo.level_ids():
        rooms = geo.rooms_on(level_id)
        if not rooms:
            continue
        ex0, ey0, ex1, ey1 = geo.envelope_for(level_id)
        pinned = _pinned_envelope(geo, level_id)

        # footprint width/length must match the pinned envelope (immutable boundary)
        z0_rooms = [r for r in rooms if r.z == 0]
        if z0_rooms and pinned is not None:
            px0, py0, px1, py1 = pinned
            bx0 = min(r.x for r in z0_rooms)
            by0 = min(r.y for r in z0_rooms)
            bx1 = max(r.x2 for r in z0_rooms)
            by1 = max(r.y2 for r in z0_rooms)
            if abs((bx1 - bx0) - (px1 - px0)) > FOOTPRINT_TOL:
                errors.append(
                    f"footprint width changed to {bx1 - bx0:.2f}m "
                    f"(envelope is {px1 - px0:.2f}m) — the external boundary is immutable"
                )
            if abs((by1 - by0) - (py1 - py0)) > FOOTPRINT_TOL:
                errors.append(
                    f"footprint length changed to {by1 - by0:.2f}m "
                    f"(envelope is {py1 - py0:.2f}m) — the external boundary is immutable"
                )

        for r in rooms:
            if r.w <= 0 or r.h <= 0:
                errors.append(f"room '{r.id}' has non-positive size")
                continue
            min_side = MIN_NESTED if (r.z or r.kind == "storage") else MIN_ROOM
            if min(r.w, r.h) < min_side:
                errors.append(f"room '{r.id}' too small ({r.w:.2f} x {r.h:.2f}m, min {min_side}m)")
            if (
                r.x < ex0 - ENVELOPE_TOL
                or r.y < ey0 - ENVELOPE_TOL
                or r.x2 > ex1 + ENVELOPE_TOL
                or r.y2 > ey1 + ENVELOPE_TOL
            ):
                errors.append(
                    f"room '{r.id}' breaks the building envelope "
                    "— the external footprint is immutable"
                )

        z0 = [r for r in rooms if r.z == 0]
        for a, b in combinations(z0, 2):
            ox = min(a.x2, b.x2) - max(a.x, b.x)
            oy = min(a.y2, b.y2) - max(a.y, b.y)
            if ox > OVERLAP_TOL and oy > OVERLAP_TOL:
                penetration = min(ox, oy)
                msg = f"rooms '{a.id}' and '{b.id}' overlap ({ox:.2f} x {oy:.2f}m)"
                if penetration > GROSS_OVERLAP:
                    errors.append(msg)
                else:
                    warnings.append(msg)

        for nr in (r for r in rooms if r.z != 0):
            if not any(p.contains(nr) for p in z0):
                errors.append(f"nested room '{nr.id}' is not inside any z=0 room on its level")

    for w in geo.walls:
        for o in w.openings:
            if not (0 <= o.t0 < o.t1 <= 1.000001):
                errors.append(f"opening '{o.id}' on '{w.id}' has invalid span {o.t0}-{o.t1}")

    # connectivity: every habitable room should have at least one door/open
    connected = set()
    for w in geo.walls:
        if w.openings and any(o.type in ("door", "open") for o in w.openings):
            connected.add(w.a)
            connected.add(w.b)
    for r in geo.rooms:
        if r.z == 0 and r.fill != "grey" and r.id not in connected:
            warnings.append(f"room '{r.id}' has no door — check circulation")

    return errors, warnings
