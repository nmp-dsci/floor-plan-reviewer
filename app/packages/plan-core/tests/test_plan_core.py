"""plan-core test suite — run against the real 231-peats-ferry-rd plan files."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from plan_core import (
    Change,
    apply_ops,
    convert_v1,
    diff_geometries,
    parse_ops,
    register_hunk,
    validate,
)
from plan_core.compliance import flags_for
from plan_core.export import render_png

REPO = Path(__file__).resolve().parents[4]
PROPERTY = REPO / "231-peats-ferry-rd"


def load(version: str):
    return convert_v1(json.loads((PROPERTY / f"plan_{version}.json").read_text()))


@pytest.fixture(scope="module")
def v03():
    return load("v03")


@pytest.fixture(scope="module")
def v02():
    return load("v02")


def test_convert_v03_rooms_and_walls(v03) -> None:
    assert len(v03.rooms) == 25
    assert len(v03.walls) > 40
    assert v03.meta["unmapped_openings"] <= 2
    mapped = sum(len(w.openings) for w in v03.walls)
    assert mapped >= 20
    bed5 = v03.room("bed-5")
    assert bed5.kind == "bedroom"
    assert v03.room("store").fill == "grey"


def test_validate_seeds(v02, v03) -> None:
    for geo in (v02, v03):
        errors, _warnings = validate(geo)
        assert errors == [], errors


def test_diff_v02_to_v03(v02, v03) -> None:
    lines = diff_geometries(v02, v03)
    removed = {line.id for line in lines if line.op == "remove" and line.obj == "room"}
    added = {line.id for line in lines if line.op == "add" and line.obj == "room"}
    assert "lounge" in removed
    assert "bed-5" in added
    assert any(line.obj == "fixture" and line.op == "add" for line in lines)


def test_set_kind_and_register(v03) -> None:
    ops = parse_ops(
        [{"op": "set_kind", "room_id": "store", "name": "STUDY", "kind": "room", "fill": "white"}]
    )
    result = apply_ops(v03, ops)
    errors, _ = validate(result.geometry)
    assert errors == []
    lines = diff_geometries(v03, result.geometry)
    mods = [line for line in lines if line.op == "modify" and line.id == "store"]
    assert mods and "study" in mods[0].after
    hunk = register_hunk(Change(id="c08", title="Store → study", rent_impact_per_week=10), lines)
    ops_texts = [(entry["op"], entry["text"]) for entry in hunk["lines"]]  # type: ignore[index]
    assert ("remove", ops_texts[0][1]) == ops_texts[0] and "store" in ops_texts[0][1]
    assert any(op == "add" and "study" in text for op, text in ops_texts)


def test_split_room_and_envelope(v03) -> None:
    bed4 = v03.room("bed-4")
    cut = bed4.y + bed4.h / 2
    result = apply_ops(
        v03,
        parse_ops(
            [
                {
                    "op": "split_room",
                    "room_id": "bed-4",
                    "axis": "y",
                    "at": cut,
                    "new_name": "NOOK",
                    "side": "high",
                }
            ]
        ),
    )
    errors, _ = validate(result.geometry)
    assert errors == []
    assert any(r.id == "nook" for r in result.geometry.rooms)

    bad = apply_ops(
        v03,
        parse_ops(
            [{"op": "resize_room", "room_id": "bed-4", "x": -3.0, "y": 0.0, "w": 3.0, "h": 4.6}]
        ),
    )
    errors, _ = validate(bad.geometry)
    assert any("envelope" in e for e in errors)


def test_wall_chunk_and_openings(v03) -> None:
    wall = next(w for w in v03.walls if {w.a, w.b} == {"kitchen-dining", "living"} and w.length > 2)
    result = apply_ops(
        v03,
        parse_ops([{"op": "remove_wall_chunk", "wall_id": wall.id, "t0": 0.05, "t1": 0.25}]),
    )
    errors, _ = validate(result.geometry)
    assert errors == []
    lines = diff_geometries(v03, result.geometry)
    assert any(line.obj == "opening" and line.op == "add" for line in lines)


def test_add_opening_after_room_move_lands_on_new_wall(v03) -> None:
    # swap ensuite <-> walk-in-robe (a room move renames the walls), then add a door on a
    # wall that only exists AFTER the move — it must still land (regression: deferred openings)
    e = v03.room("ensuite")
    w = v03.room("walk-in-robe")
    swap = parse_ops(
        [
            {"op": "resize_room", "room_id": "ensuite", "x": e.x, "y": w.y, "w": e.w, "h": e.h},
            {
                "op": "resize_room",
                "room_id": "walk-in-robe",
                "x": w.x,
                "y": w.y + e.h,
                "w": w.w,
                "h": w.h,
            },
        ]
    )
    post = apply_ops(v03, swap).geometry
    new_walls = {wl.id for wl in post.walls} - {wl.id for wl in v03.walls}
    target = next(wid for wid in new_walls if "ensuite" in wid)
    assert not any(wl.id == target for wl in v03.walls)  # not present before the move
    batch = apply_ops(
        v03,
        swap
        + parse_ops(
            [{"op": "add_opening", "wall_id": target, "t0": 0.4, "t1": 0.6, "type": "door"}]
        ),
    )
    placed = next(wl for wl in batch.geometry.walls if wl.id == target)
    assert any(o.type == "door" for o in placed.openings), (target, placed.openings)
    assert not any("not found" in x for x in batch.warnings)
    assert validate(batch.geometry)[0] == []


def test_compliance_flags(v03) -> None:
    ops = parse_ops(
        [
            {
                "op": "set_kind",
                "room_id": "store",
                "name": "BED 6",
                "kind": "bedroom",
                "fill": "white",
            }
        ]
    )
    result = apply_ops(v03, ops)
    flags = flags_for(v03, result.geometry, ops)
    assert any("habitable" in f.lower() for f in flags)
    assert any("change of use" in f.lower() for f in flags)


def test_export_png(v03, tmp_path) -> None:
    out = render_png(v03, tmp_path / "v03.png", "Proposed plan (v03)", "parity check")
    assert out.exists() and out.stat().st_size > 10_000


def test_fixture_ids_backfilled_deterministically(v03) -> None:
    assert v03.fixtures, "seed plan should carry fixtures"
    assert all(f.id.startswith("fx:") for f in v03.fixtures)
    assert len({f.id for f in v03.fixtures}) == len(v03.fixtures)
    # same JSON read twice → same ids
    again = load("v03")
    assert [f.id for f in again.fixtures] == [f.id for f in v03.fixtures]


def test_modify_and_remove_fixture_by_id(v03) -> None:
    fx = v03.fixtures[0]
    result = apply_ops(
        v03,
        parse_ops(
            [
                {"op": "modify_fixture", "fixture_id": fx.id, "w": fx.w + 0.6, "label": "BENCH XL"},
                {
                    "op": "add_fixture",
                    "x": fx.x,
                    "y": fx.y + 2,
                    "w": 1.0,
                    "h": 0.5,
                    "label": "desk",
                },
            ]
        ),
    )
    assert result.warnings == []
    changed = result.geometry.fixture(fx.id)
    assert abs(changed.w - (fx.w + 0.6)) < 1e-6 and changed.label == "BENCH XL"
    added = next(f for f in result.geometry.fixtures if f.label == "desk")
    assert added.id.startswith("fx:desk-")
    lines = diff_geometries(v03, result.geometry)
    assert any(line.obj == "fixture" and line.op == "modify" and line.id == fx.id for line in lines)
    assert any(line.obj == "fixture" and line.op == "add" for line in lines)

    removed = apply_ops(
        result.geometry, parse_ops([{"op": "remove_fixture", "fixture_id": added.id}])
    )
    assert removed.warnings == []
    assert all(f.id != added.id for f in removed.geometry.fixtures)

    missing = apply_ops(v03, parse_ops([{"op": "remove_fixture", "fixture_id": "fx:nope-9"}]))
    assert any("not found" in w for w in missing.warnings)


def test_add_room_creates_valid_room() -> None:
    from plan_core import PlanGeometry, Room

    # kitchen fills the left; free space on the right becomes a butler's pantry
    base = PlanGeometry(
        rooms=[Room(id="kitchen", name="KITCHEN", kind="kitchen", x=0, y=0, w=4.0, h=5.0)],
        meta={"envelope": [0.0, 0.0, 9.0, 5.0]},
    )
    result = apply_ops(
        base,
        parse_ops(
            [
                {
                    "op": "add_room",
                    "name": "BUTLERS PANTRY",
                    "kind": "storage",
                    "x": 5.0,
                    "y": 0.0,
                    "w": 4.0,
                    "h": 5.0,
                }
            ]
        ),
    )
    errors, _ = validate(result.geometry)
    assert errors == [], errors
    made = next(r for r in result.geometry.rooms if "butlers" in r.id)
    assert made.kind == "storage" and abs(made.w - 4.0) < 1e-6
    lines = diff_geometries(base, result.geometry)
    assert any(line.obj == "room" and line.op == "add" and "butlers" in line.id for line in lines)


def test_op_targeting_missing_object_is_skipped_not_crash(v03) -> None:
    # a resize op referencing an uncommitted preview id must warn, never raise
    result = apply_ops(
        v03,
        parse_ops([{"op": "resize_room", "room_id": "pv-room1", "x": 0, "y": 0, "w": 3, "h": 3}]),
    )
    assert any("pv-room1" in w and "not found" in w for w in result.warnings), result.warnings
    errors, _ = validate(result.geometry)
    assert errors == []  # untouched geometry stays valid


def test_footprint_change_is_rejected() -> None:
    from plan_core import PlanGeometry, Room

    room = Room(id="hall", name="HALL", kind="circulation", x=0, y=0, w=10.0, h=8.0)
    # envelope 1.2 m wider than the rooms fill → footprint shrank → rejected
    shrunk = PlanGeometry(rooms=[room], meta={"envelope": [0.0, 0.0, 11.2, 8.0]})
    errors, _ = validate(shrunk)
    assert any("footprint width" in e for e in errors), errors
    # matching envelope → no footprint error
    ok = PlanGeometry(rooms=[room], meta={"envelope": [0.0, 0.0, 10.0, 8.0]})
    assert not any("footprint" in e for e in validate(ok)[0])


def test_clear_dimensions(v03) -> None:
    from plan_core import clear_dims_label, clear_internal_area, clear_size

    # every room's clear size is positive and strictly smaller than its rect
    for r in v03.rooms:
        cw, ch = clear_size(r, v03.walls)
        assert 0 < cw <= r.w + 1e-9 and 0 < ch <= r.h + 1e-9, (r.id, cw, ch)
    # clear area < rect area, both positive
    assert 0 < clear_internal_area(v03) < v03.internal_area()
    # pinned example from the app-seed geometry: bed-3 3.00x3.00 rect → 2.85x2.92 clear
    import json
    from pathlib import Path

    seed = Path(__file__).resolve().parents[3] / "seed" / "plan_v03.json"
    geo = convert_v1(json.loads(seed.read_text()))
    bed3 = geo.room("bed-3")
    cw, ch = clear_size(bed3, geo.walls)
    assert abs(cw - 2.85) < 0.02 and abs(ch - 2.92) < 0.02, (cw, ch)
    assert clear_dims_label(bed3, geo.walls).endswith("m")


def _two_level_draft() -> dict:
    """A house + a detached garage, each drawn in its OWN local origin (both near 0,0)."""
    return {
        "address": "9 Test St",
        "levels": [{"id": "level-1", "name": "Level 1"}, {"id": "garage", "name": "Garage"}],
        "rooms": [
            {"name": "LOUNGE", "x": 0, "y": 0, "w": 4, "h": 4, "level": "level-1"},
            {"name": "BED 1", "x": 4.1, "y": 0, "w": 3.5, "h": 4, "level": "level-1"},
            {"name": "BATH", "x": 0, "y": 4.1, "w": 3, "h": 2.5, "level": "level-1"},
            # garage block: coords deliberately overlap the house's coordinate range
            {"name": "GARAGE", "x": 0, "y": 0, "w": 6, "h": 6, "fill": "grey", "level": "garage"},
            {
                "name": "STORAGE",
                "x": 0,
                "y": 6.1,
                "w": 5,
                "h": 2,
                "fill": "grey",
                "level": "garage",
            },
        ],
    }


def test_multilevel_convert_isolates_levels() -> None:
    geo = convert_v1(_two_level_draft())
    assert [lvl["id"] for lvl in geo.levels()] == ["level-1", "garage"]
    assert set(geo.meta["envelopes"]) == {"level-1", "garage"}
    # every room carries its level; walls never bridge two levels
    house = {r.id for r in geo.rooms_on("level-1")}
    gar = {r.id for r in geo.rooms_on("garage")}
    assert house and gar
    for w in geo.walls:
        assert not ({w.a, w.b} & house and {w.a, w.b} & gar), (w.a, w.b)
    # overlapping coordinate ranges on different levels must NOT flag as overlaps
    errors, _ = validate(geo)
    assert errors == [], errors
    # footprint is summed per level (both structures counted), not one shared bbox
    per_level = sum(
        (e[2] - e[0]) * (e[3] - e[1]) for e in (geo.envelope_for(lid) for lid in geo.level_ids())
    )
    assert abs(geo.total_area() - per_level) < 1e-6
    assert geo.total_area() > 90


def test_convert_heals_sliver_overlaps() -> None:
    # two rooms drawn 0.1 m into each other — a vision rounding artefact, not a real clash
    draft = {
        "rooms": [
            {"name": "A", "x": 0, "y": 0, "w": 4, "h": 4},
            {"name": "B", "x": 3.9, "y": 0, "w": 4, "h": 4},
        ]
    }
    geo = convert_v1(draft)
    errors, _ = validate(geo)
    assert not any("overlap" in e for e in errors), errors


def test_heal_does_not_cross_levels() -> None:
    # a garage drawn in its own origin overlaps the house's coords by a sliver;
    # cross-level healing would falsely shrink it — per-level scoping must not.
    draft = {
        "levels": [{"id": "level-1"}, {"id": "garage"}],
        "rooms": [
            {"name": "LOUNGE", "x": 0, "y": 0, "w": 4, "h": 4, "level": "level-1"},
            {"name": "GARAGE", "x": 3.9, "y": 0, "w": 4, "h": 4, "level": "garage"},
        ],
    }
    geo = convert_v1(draft)
    assert geo.room("garage").w == 4  # untouched — different level, not a real overlap


def test_phantom_level_dropped_and_area_not_inflated() -> None:
    # the draft declares an upper storey but tags no room to it — that phantom level
    # must not become a tab nor inflate the summed per-level footprint.
    draft = {
        "levels": [
            {"id": "level-1", "name": "Level 1"},
            {"id": "level-2", "name": "Level 2"},  # phantom: no rooms
        ],
        "rooms": [
            {"name": "LOUNGE", "x": 0, "y": 0, "w": 4, "h": 4, "level": "level-1"},
            {"name": "BED 1", "x": 4.1, "y": 0, "w": 3, "h": 4, "level": "level-1"},
        ],
    }
    geo = convert_v1(draft)
    assert [lvl["id"] for lvl in geo.levels()] == ["level-1"]
    assert geo.level_ids() == ["level-1"]
    assert "level-2" not in geo.meta["envelopes"]
    x0, y0, x1, y1 = geo.envelope_for("level-1")
    assert abs(geo.total_area() - (x1 - x0) * (y1 - y0)) < 1e-6


def test_envelope_for_roomless_level_is_degenerate() -> None:
    from plan_core import PlanGeometry, Room

    # a roomless level in a multi-level plan must return a zero bbox, never the whole plan
    geo = PlanGeometry(
        rooms=[
            Room(id="a", name="A", x=0, y=0, w=4, h=4, level="level-1"),
            Room(id="b", name="B", x=0, y=0, w=6, h=6, level="garage"),
        ],
        meta={"levels": [{"id": "level-1"}, {"id": "garage"}, {"id": "phantom"}]},
    )
    assert geo.envelope_for("phantom") == (0.0, 0.0, 0.0, 0.0)
    assert abs(geo.total_area() - (16 + 36)) < 1e-6


def test_modest_overlap_warns_gross_overlap_errors() -> None:
    from plan_core import PlanGeometry, Room

    # 0.5 m penetration (below GROSS) → warning, never a blocking error
    modest = PlanGeometry(
        rooms=[
            Room(id="a", name="A", x=0, y=0, w=4, h=4),
            Room(id="b", name="B", x=3.5, y=0, w=4, h=4),
        ],
    )
    errors, warnings = validate(modest)
    assert not any("overlap" in e for e in errors)
    assert any("overlap" in w for w in warnings)
    # rooms genuinely stacked (2 m penetration) → error
    gross = PlanGeometry(
        rooms=[
            Room(id="a", name="A", x=0, y=0, w=4, h=4),
            Room(id="b", name="B", x=2, y=0, w=4, h=4),
        ],
    )
    assert any("overlap" in e for e in validate(gross)[0])


def test_add_room_lands_on_requested_level() -> None:
    geo = convert_v1(_two_level_draft())
    # free strip inside the garage envelope (beside STORAGE), on the garage level
    result = apply_ops(
        geo,
        parse_ops(
            [
                {
                    "op": "add_room",
                    "name": "WORKSHOP",
                    "x": 5.05,
                    "y": 6.1,
                    "w": 0.9,
                    "h": 1.9,
                    "level": "garage",
                }
            ]
        ),
    )
    made = next(r for r in result.geometry.rooms if "workshop" in r.id)
    assert made.level == "garage"
    assert validate(result.geometry)[0] == []


def test_change_author_defaults_to_agent_and_lands_in_hunk(v03) -> None:
    lines = diff_geometries(v03, v03)
    agent_hunk = register_hunk(Change(id="c01", title="agent change"), lines)
    human_hunk = register_hunk(Change(id="c02", title="manual edit", author="human"), lines)
    assert agent_hunk["author"] == "agent"
    assert human_hunk["author"] == "human"
