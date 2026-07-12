"""P4 vision ingestion: floor-plan image → schema-v2 geometry draft (Claude multimodal, per D5)."""

from __future__ import annotations

import base64
import logging
import os
from typing import Any, Literal

from plan_core import convert_v1, validate
from pydantic import BaseModel, Field
from pydantic_ai import Agent, BinaryContent

log = logging.getLogger("plan-agent.ingest")

VISION_MODEL = os.environ.get("VISION_MODEL", "anthropic:claude-opus-4-8")


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


class DraftOpening(BaseModel):
    x: float
    y: float
    w: float
    h: float


class DraftPlan(BaseModel):
    address: str = ""
    rooms: list[DraftRoom]
    openings: list[DraftOpening] = Field(
        default_factory=list,
        description="Door/opening punch rectangles straddling the wall they pierce",
    )
    notes: list[str] = Field(default_factory=list, description="Uncertainties for the reviewer")


INSTRUCTIONS = """You convert a residential listing floor-plan image into structured geometry.

Coordinate system: metres, origin at the top-left of the building, x to the right, y downward.
- Model every room as an axis-aligned rectangle. Use the printed room dimensions to establish
  scale, then keep all rooms consistent with that scale; leave a ~0.1m gap between adjacent
  rooms (it renders as the wall).
- Include every labelled space (bedrooms, kitchen, bath, wc, laundry, halls, robes, garage,
  balcony, porch). Mark non-habitable zones (garage/balcony/porch/store) as fill "grey".
- For each visible door or wall opening add a small punch rectangle (~0.3m thick across the
  wall, as wide as the opening) straddling the wall line it pierces.
- List anything you were unsure about in notes. Be precise with the printed dims labels.
"""

_agent: Agent[None, DraftPlan] | None = None


def get_agent() -> Agent[None, DraftPlan]:
    global _agent
    if _agent is None:
        _agent = Agent(VISION_MODEL, output_type=DraftPlan, instructions=INSTRUCTIONS, retries=1)
    return _agent


async def run_ingest(image_b64: str, media_type: str, address: str) -> dict[str, Any]:
    agent = get_agent()
    run = await agent.run(
        [
            f"Extract the floor plan geometry. Address (if known): {address or 'unknown'}.",
            BinaryContent(data=base64.b64decode(image_b64), media_type=media_type),
        ]
    )
    draft = run.output
    v1 = {
        "version": 0,
        "property": address or "uploaded-plan",
        "address": draft.address or address,
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
