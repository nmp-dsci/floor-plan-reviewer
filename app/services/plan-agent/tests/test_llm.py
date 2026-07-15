"""Unit tests for the Agent-SDK LLM wrapper — pure logic, no token or subprocess."""

import json

import pytest

from plan_agent.agent import OpsPlan
from plan_agent.llm import _relax_schema, _require_auth, auth_configured


def _walk(node):
    yield node
    if isinstance(node, dict):
        yield from (n for v in node.values() for n in _walk(v))
    elif isinstance(node, list):
        yield from (n for x in node for n in _walk(x))


def test_relax_schema_makes_op_union_strict_safe():
    """The Op discriminated union must come out Ajv-strict + Anthropic-strict safe."""
    schema = _relax_schema(OpsPlan.model_json_schema())
    blob = json.dumps(schema)
    assert "discriminator" not in blob  # Ajv strict rejects this keyword
    assert '"oneOf"' not in blob  # rewritten to anyOf
    assert '"anyOf"' in blob  # the Op union survives as anyOf
    for node in _walk(schema):
        if isinstance(node, dict) and node.get("type") == "object" and "properties" in node:
            assert node["additionalProperties"] is False
            assert set(node["required"]) == set(node["properties"])


def test_auth_configured(monkeypatch):
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    assert auth_configured() is False
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-example")
    assert auth_configured() is True


def test_require_auth_raises_without_token(monkeypatch):
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="CLAUDE_CODE_OAUTH_TOKEN"):
        _require_auth()
