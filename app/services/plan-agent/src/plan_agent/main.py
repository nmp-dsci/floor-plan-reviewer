"""Floor-Plan Studio plan-agent service."""

import logging
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from plan_agent.agent import run_ops_agent
from plan_agent.comps import run_comps
from plan_agent.ingest import run_ingest
from plan_agent.llm import AGENT_MODE, MODEL, VISION_MODEL, auth_configured

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="floor-plan-studio plan-agent")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "mode": AGENT_MODE,
        "model": MODEL,
        "vision_model": VISION_MODEL,
        "auth": auth_configured(),
    }


class ApplyIn(BaseModel):
    geometry: dict[str, Any]
    comments: list[dict[str, Any]]
    context: dict[str, Any] = Field(default_factory=dict)


@app.post("/apply")
async def apply(body: ApplyIn) -> dict[str, Any]:
    try:
        return await run_ops_agent(body.geometry, body.comments, body.context)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class IngestIn(BaseModel):
    image_b64: str
    media_type: str = "image/png"
    address: str = ""


@app.post("/ingest")
async def ingest(body: IngestIn) -> dict[str, Any]:
    return await run_ingest(body.image_b64, body.media_type, body.address)


class CompsIn(BaseModel):
    address: str
    config: str = ""


@app.post("/comps")
async def comps(body: CompsIn) -> dict[str, Any]:
    return await run_comps(body.address, body.config)
