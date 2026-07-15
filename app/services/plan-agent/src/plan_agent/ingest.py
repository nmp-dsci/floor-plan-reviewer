"""P4 vision ingestion: floor-plan image → schema-v2 geometry draft (Claude multimodal, per D5)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from plan_core import convert_v1, validate
from pydantic import BaseModel, Field

from plan_agent.llm import VISION_MODEL, parse_structured

log = logging.getLogger("plan-agent.ingest")


class DraftLevel(BaseModel):
    id: str = Field(description="Stable slug, e.g. 'level-1', 'level-2', 'garage'")
    name: str = Field(description="Human label shown on the tab, e.g. 'Level 1', 'Garage'")


class DraftRoom(BaseModel):
    name: str = Field(description="Room label as printed, e.g. 'BED 1', 'KITCHEN/DINING'")
    dims: str = Field(default="", description="Printed dimensions label if any, e.g. '3.4 x 4.4m'")
    x: float
    y: float
    w: float
    h: float
    fill: Literal["white", "grey"] = Field(
        default="white", description="'grey' for non-habitable: garage, balcony, porch, store"
    )
    level: str = Field(
        default="level-1",
        description="id of the level/structure this room belongs to (matches a DraftLevel id)",
    )


class DraftOpening(BaseModel):
    x: float
    y: float
    w: float
    h: float
    level: str = Field(default="level-1", description="level id this opening's wall belongs to")


class DraftPlan(BaseModel):
    address: str = ""
    levels: list[DraftLevel] = Field(
        default_factory=list,
        description="Every distinct plan block: storeys AND detached structures, in reading order",
    )
    rooms: list[DraftRoom]
    openings: list[DraftOpening] = Field(
        default_factory=list,
        description="Door/opening punch rectangles straddling the wall they pierce",
    )
    notes: list[str] = Field(default_factory=list, description="Uncertainties for the reviewer")


INSTRUCTIONS = """You convert a residential listing floor-plan image into structured geometry.

A single image may contain SEVERAL distinct plan blocks: multiple storeys (GROUND FLOOR, FIRST
FLOOR, …) and/or a DETACHED structure drawn separately on the same sheet (e.g. a detached garage,
studio, or carport off to one side). Model each such block as its own LEVEL.

Levels:
- Emit one entry in `levels` per block, in reading order (top-left first). Give each a stable id
  ('level-1', 'level-2', 'garage', 'studio', …) and a human name ('Level 1', 'Garage', …). Use the
  block's own printed heading when it names one (e.g. a detached garage block → id 'garage').
- A plan with a single building is just ONE level: `levels` = [{id:'level-1', name:'Level 1'}].
- Tag every room and opening with the `level` id of the block it sits in.

Coordinate system: metres. CRITICAL — each level has its OWN local origin at the top-left of THAT
block (its top-left room is near 0,0). Do NOT offset a detached block or an upper storey by its
position on the sheet; lay every level out as if it were the only thing on the page. Levels never
share or connect coordinates.

Within each level:
- Model every room as an axis-aligned rectangle. Use the printed room dimensions to establish
  scale, then keep all rooms on that level consistent with that scale; leave a ~0.1m gap between
  adjacent rooms (it renders as the wall).
- Include every labelled space (bedrooms, kitchen, bath, wc, laundry, halls, robes, garage,
  balcony, porch, store). Mark non-habitable zones (garage/balcony/porch/store) as fill "grey".
- For each visible door or wall opening add a small punch rectangle (~0.3m thick across the
  wall, as wide as the opening) straddling the wall line it pierces, tagged with the same level.
- List anything you were unsure about in notes. Be precise with the printed dims labels.
"""


async def run_ingest(image_b64: str, media_type: str, address: str) -> dict[str, Any]:
    draft = await parse_structured(
        DraftPlan,
        INSTRUCTIONS,
        f"Extract the floor plan geometry. Address (if known): {address or 'unknown'}.",
        image={
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": image_b64},
        },
        model=VISION_MODEL,
        effort="medium",
    )
    v1 = {
        "version": 0,
        "property": address or "uploaded-plan",
        "address": draft.address or address,
        "levels": [lvl.model_dump() for lvl in draft.levels],
        "rooms": [r.model_dump() for r in draft.rooms],
        "openings": [o.model_dump() for o in draft.openings],
    }
    geo = convert_v1(v1)
    errors, warnings = validate(geo)
    return {
        "geometry": geo.model_dump(),
        "draft_v1": v1,
        "notes": draft.notes,
        "errors": errors,
        "warnings": warnings,
    }
