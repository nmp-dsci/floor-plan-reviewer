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
