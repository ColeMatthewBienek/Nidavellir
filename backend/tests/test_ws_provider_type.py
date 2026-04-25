"""
Tests that provider_type is a ClassVar on agents, not a monkey-patched instance attribute.
Written FIRST — run to confirm failure, then implement.
"""
from pathlib import Path


def test_get_or_start_agent_sets_no_provider_type_attribute():
    """provider_type is a ClassVar, not monkey-patched onto the instance __dict__."""
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"))
    assert "_provider_type" not in agent.__dict__
    assert agent.provider_type == "claude"


def test_swap_global_agent_uses_classvar():
    """provider_type is readable via ClassVar without any instance-level assignment."""
    from nidavellir.agents.codex_agent import CodexAgent
    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))
    assert agent.provider_type == "codex"
    assert "_provider_type" not in agent.__dict__
