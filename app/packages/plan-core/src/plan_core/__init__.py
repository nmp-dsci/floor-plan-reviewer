"""plan-core: the shape-object engine for Floor-Plan Studio.

Schema v2 geometry (rooms + first-class walls), conversion from the repo's
plan_v##.json format, diff engine + git-style register, typed operations with
validation bounce-back, compliance flag rules, and Pillow PNG export.
"""

from plan_core.convert import convert_v1
from plan_core.diff import DiffLine, diff_geometries, register_hunk
from plan_core.ops import Op, OpsResult, apply_ops, parse_ops
from plan_core.schema import Change, Fixture, Opening, PlanGeometry, Room, Wall
from plan_core.validate import validate
from plan_core.walls import derive_walls

__all__ = [
    "Change",
    "DiffLine",
    "Fixture",
    "Op",
    "Opening",
    "OpsResult",
    "PlanGeometry",
    "Room",
    "Wall",
    "apply_ops",
    "convert_v1",
    "derive_walls",
    "diff_geometries",
    "parse_ops",
    "register_hunk",
    "validate",
]
