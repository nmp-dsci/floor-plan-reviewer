"""P5 rent comparables: Tavily web search → structured comps list."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from pydantic import BaseModel, Field

from plan_agent.llm import MODEL, parse_structured

log = logging.getLogger("plan-agent.comps")

TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")

COMPS_SYS = (
    "Extract rental comparables from web search results for an Australian suburb. "
    "Only include listings with an explicit weekly rent (AUD $/week) and a "
    "bedroom/bathroom configuration. Never invent listings."
)


class Comp(BaseModel):
    address: str
    config: str = Field(description="e.g. '4b/2b/1c'")
    rent_per_week: float
    source: str = Field(description="Site + access note, e.g. 'rent.com.au via Tavily'")


class CompsList(BaseModel):
    comps: list[Comp] = Field(description="Only comps with an explicit weekly rent figure")


async def run_comps(address: str, config: str) -> dict[str, Any]:
    if not TAVILY_API_KEY:
        return {"comps": [], "note": "TAVILY_API_KEY not configured"}
    suburb = address.split(",")[-1].strip() if "," in address else address
    beds = config.split(" ")[0] if config else ""
    query = f"house for rent {suburb} {beds} bedrooms weekly rent"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": TAVILY_API_KEY,
                "query": query,
                "search_depth": "basic",
                "max_results": 8,
            },
        )
    if resp.status_code != 200:
        return {"comps": [], "note": f"tavily error {resp.status_code}"}
    results = resp.json().get("results", [])
    if not results:
        return {"comps": [], "note": "no search results"}
    blob = "\n\n".join(f"{r.get('title')}\n{r.get('url')}\n{r.get('content')}" for r in results)
    result = await parse_structured(
        CompsList,
        COMPS_SYS,
        f"Search query: {query}\nTarget configuration: {config}\n\nRESULTS:\n{blob}",
        model=MODEL,
        effort="low",
    )
    return {"comps": [c.model_dump() for c in result.comps], "note": "live via Tavily"}
