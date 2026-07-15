"""Claude Agent SDK wrapper — every LLM call runs on the operator's Claude subscription.

All Floor-Plan Studio LLM calls go through the Claude Agent SDK (``claude-agent-sdk``),
authenticated by ``CLAUDE_CODE_OAUTH_TOKEN`` (from ``claude setup-token``) — no paid API
key. Each call runs tool-free and single-turn with a JSON-schema ``output_format``, so one
call yields one validated Pydantic model. ``AGENT_MODE=echo`` runs LLM-free; a missing
token while ``AGENT_MODE=llm`` raises a clear error.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import Any, TypeVar

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query
from pydantic import BaseModel

MODEL = os.environ.get("PLAN_AGENT_MODEL", "claude-opus-4-8")
VISION_MODEL = os.environ.get("VISION_MODEL", "claude-opus-4-8")
AGENT_MODE = os.environ.get("AGENT_MODE", "llm")  # llm | echo

T = TypeVar("T", bound=BaseModel)


def auth_configured() -> bool:
    """True when a subscription token is available for the Agent SDK."""
    return bool(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"))


def _require_auth() -> None:
    if not auth_configured():
        raise RuntimeError(
            "CLAUDE_CODE_OAUTH_TOKEN is not set. Floor-Plan Studio runs on your Claude "
            "subscription via the Agent SDK — generate a token with `claude setup-token` "
            "and export it (keep ANTHROPIC_API_KEY unset), or run with AGENT_MODE=echo."
        )


def _relax_schema(node: Any) -> Any:
    """Rewrite a Pydantic JSON schema so the Agent SDK's strict Ajv validator and Anthropic
    structured outputs accept it: drop the (OpenAPI) ``discriminator`` keyword, turn ``oneOf``
    into ``anyOf``, and mark every object's properties required with ``additionalProperties``
    false. Mutates and returns ``node``. Verified against the ``Op`` discriminated union."""
    if isinstance(node, dict):
        node.pop("discriminator", None)
        if "oneOf" in node:
            node["anyOf"] = node.pop("oneOf")
        if node.get("type") == "object" and "properties" in node:
            node["additionalProperties"] = False
            node["required"] = list(node["properties"].keys())
        for value in node.values():
            _relax_schema(value)
    elif isinstance(node, list):
        for item in node:
            _relax_schema(item)
    return node


async def _stream(text: str, image: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    """A one-message prompt stream carrying an image block plus the text (vision path)."""
    yield {
        "type": "user",
        "message": {"role": "user", "content": [image, {"type": "text", "text": text}]},
    }


async def parse_structured(
    output_type: type[T],
    system: str,
    text: str,
    *,
    image: dict[str, Any] | None = None,
    model: str = MODEL,
    effort: str = "high",
) -> T:
    """One tool-free, single-turn Agent-SDK call → a validated Pydantic model.

    ``image`` (optional) is an Anthropic image content block, e.g.
    ``{"type": "image", "source": {"type": "base64", "media_type": ..., "data": ...}}``.
    """
    _require_auth()
    options = ClaudeAgentOptions(
        model=model,
        system_prompt=system,
        allowed_tools=[],  # no filesystem / bash — pure structured extraction
        max_turns=1,
        effort=effort,  # type: ignore[arg-type]  # low|medium|high|xhigh|max
        setting_sources=[],  # hermetic: don't load project CLAUDE.md / settings
        output_format={
            "type": "json_schema",
            "schema": _relax_schema(output_type.model_json_schema()),
        },
    )
    prompt: Any = text if image is None else _stream(text, image)

    result: ResultMessage | None = None
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, ResultMessage):
            result = message

    if result is None:
        raise ValueError(f"{output_type.__name__}: agent returned no result message")
    if result.structured_output is None:
        raise ValueError(
            f"{output_type.__name__}: no structured output "
            f"(is_error={result.is_error}, stop_reason={result.stop_reason}, "
            f"errors={result.errors}, text={(result.result or '')[:200]!r})"
        )
    return output_type.model_validate(result.structured_output)
