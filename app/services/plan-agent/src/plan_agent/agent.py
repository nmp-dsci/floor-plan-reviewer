"""The ops loop: comments + geometry → typed plan-core operations, validated with bounce-back.

Model is config-swappable per spec decision D5: DeepSeek (`deepseek:deepseek-chat`)
is the cost default; any pydantic-ai model string works (e.g. `anthropic:claude-opus-4-8`).
The agent NEVER edits pixels or SVG — it emits plan-core ops that are applied and
validated here; validator errors are fed back for up to 2 retries.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from plan_core import Op, PlanGeometry, apply_ops, parse_ops, validate
from plan_core.compliance import flags_for
from pydantic import BaseModel, Field
from pydantic_ai import Agent

log = logging.getLogger("plan-agent")

MODEL = os.environ.get("PLAN_AGENT_MODEL", "deepseek:deepseek-chat")
AGENT_MODE = os.environ.get("AGENT_MODE", "llm")  # llm | echo


class ProposedChange(BaseModel):
    title: str = Field(description="Short imperative title, e.g. 'Store → study nook'")
    rationale: str = Field(description="1-2 sentences: why this raises/holds weekly rent")
    rent_impact_per_week: float = Field(
        description="Estimated AUD $/week uplift for this change (0 if cosmetic)"
    )
    flags: list[str] = Field(
        default_factory=list, description="NSW compliance/advisory flags, max 3"
    )


class OpsPlan(BaseModel):
    change: ProposedChange
    ops: list[Op] = Field(description="Typed geometry operations implementing ALL the comments")


SYSTEM = """You are the geometry editor of Floor-Plan Studio, an app that reworks Australian
residential floor plans to maximise weekly rent WITHOUT changing the external building envelope.

You receive the current plan (rooms + walls + openings, coordinates in metres, y grows downward)
and a batch of owner comments, each targeting specific rooms and/or wall chunks. Implement every
comment using ONLY the typed operations available. Rules:
- Never move or resize anything outside the existing envelope; the validator will reject it.
- Wall ids look like `w:room-a|room-b:0`; `t0/t1` are fractions (0..1) along the wall span.
- To remove a wall section or open two rooms to each other use remove_wall_chunk or add_opening
  (type "door" ~0.9m, "window", or "open" for wide openings).
- To repurpose a room (e.g. store → study) use set_kind with a new name/kind and fill "white"
  for habitable use; use split_room / merge_rooms for layout surgery; keep every room ≥ 0.7m.
- Fixtures (cabinetry, benches, robes — thin-line joinery) have stable ids like
  `fx:island-bench-1`: use add_fixture / modify_fixture / remove_fixture with fixture_id.
- Prefer the smallest set of ops that satisfies the comments. Estimate the weekly rent impact
  honestly — small cosmetic changes are $0-10; new habitable rooms more.
"""


def _describe_geometry(geo: PlanGeometry) -> str:
    lines = ["ROOMS (id · name · kind · rect x,y,w,h in m):"]
    for r in geo.rooms:
        nested = " (nested)" if r.z else ""
        lines.append(
            f"- {r.id} · {r.name} · {r.kind} · ({r.x:.2f},{r.y:.2f},{r.w:.2f},{r.h:.2f})"
            f" · fill={r.fill}{nested}"
        )
    lines.append("\nWALLS (id · between · length · openings):")
    for w in geo.walls:
        ops = ", ".join(f"{o.id}:{o.type}@{o.t0:.2f}-{o.t1:.2f}" for o in w.openings) or "none"
        lines.append(f"- {w.id} · {w.a}↔{w.b} · {w.length:.2f}m · {ops}")
    if geo.fixtures:
        lines.append("\nFIXTURES (id · rect · label):")
        for f in geo.fixtures:
            lines.append(f"- {f.id} · ({f.x:.2f},{f.y:.2f},{f.w:.2f},{f.h:.2f}) · {f.label or '-'}")
    return "\n".join(lines)


def _describe_comments(comments: list[dict[str, Any]]) -> str:
    lines = ["OWNER COMMENTS:"]
    for i, c in enumerate(comments, 1):
        targets = ", ".join(
            f"{t['type']}:{t['id']}"
            + (f" chunk t={t['t0']:.2f}-{t['t1']:.2f}" if t.get("t0") is not None else "")
            for t in c.get("targets", [])
        )
        lines.append(f'{i}. "{c["text"]}"  [targets: {targets or "whole plan"}]')
    return "\n".join(lines)


_agent: Agent[None, OpsPlan] | None = None


def get_agent() -> Agent[None, OpsPlan]:
    global _agent
    if _agent is None:
        _agent = Agent(MODEL, output_type=OpsPlan, instructions=SYSTEM, retries=2)
    return _agent


def _echo_plan(comments: list[dict[str, Any]]) -> OpsPlan:
    text = "; ".join(c["text"] for c in comments)[:120] or "no-op"
    return OpsPlan(
        change=ProposedChange(
            title=f"[echo] {text}",
            rationale="Echo mode: no LLM configured; version bumped without geometry edits.",
            rent_impact_per_week=0,
            flags=[],
        ),
        ops=[],
    )


async def run_ops_agent(
    geometry: dict[str, Any], comments: list[dict[str, Any]], context: dict[str, Any]
) -> dict[str, Any]:
    geo = PlanGeometry(**geometry)

    if AGENT_MODE == "echo":
        plan = _echo_plan(comments)
        result = apply_ops(geo, plan.ops)
        return _package(geo, result.geometry, plan, result.warnings, context)

    prompt = (
        f"PROPERTY: {context.get('address') or geo.address or geo.property}\n"
        f"Current rent: ${context.get('current_rent', '?')}/wk"
        f" (baseline ${context.get('baseline_per_week', '?')}/wk)\n\n"
        f"{_describe_geometry(geo)}\n\n{_describe_comments(comments)}\n\n"
        "Return the ops plan."
    )

    agent = get_agent()
    feedback = ""
    last_errors: list[str] = []
    for attempt in range(3):
        run = await agent.run(prompt + feedback)
        plan = run.output
        try:
            ops = parse_ops([op.model_dump() for op in plan.ops])
        except Exception as exc:  # noqa: BLE001 — malformed ops go back to the model
            feedback = f"\n\nYour previous ops failed to parse: {exc}. Fix and return again."
            continue
        result = apply_ops(geo, ops)
        errors, _warnings = validate(result.geometry)
        if not errors:
            return _package(geo, result.geometry, plan, result.warnings, context)
        last_errors = errors
        log.warning("attempt %d rejected by validator: %s", attempt + 1, errors[:3])
        feedback = (
            "\n\nThe validator REJECTED your previous ops:\n- "
            + "\n- ".join(errors[:5])
            + "\nAdjust the operations and return a corrected plan."
        )
    raise ValueError("validator rejected agent ops after retries: " + "; ".join(last_errors[:4]))


def _package(
    before: PlanGeometry,
    after: PlanGeometry,
    plan: OpsPlan,
    warnings: list[str],
    context: dict[str, Any],
) -> dict[str, Any]:
    rule_flags = flags_for(before, after, list(plan.ops))
    flags = list(dict.fromkeys([*plan.change.flags, *rule_flags]))[:5]
    return {
        "geometry": after.model_dump(),
        "change": {
            "id": context.get("next_change_id", "c99"),
            "title": plan.change.title,
            "rationale": plan.change.rationale,
            "rent_impact_per_week": plan.change.rent_impact_per_week,
            "flags": flags,
        },
        "ops": [op.model_dump() for op in plan.ops],
        "warnings": warnings,
    }
