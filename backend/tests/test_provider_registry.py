"""
Tests for ProviderManifest and PROVIDER_REGISTRY.
Written FIRST — run pytest to confirm they fail, then implement.
"""
import pytest
from pathlib import Path


def test_registry_contains_all_four_providers():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    assert set(PROVIDER_REGISTRY.keys()) == {"claude", "codex", "gemini", "ollama"}


def test_valid_providers_matches_registry_keys():
    from nidavellir.agents.registry import PROVIDER_REGISTRY, VALID_PROVIDERS
    assert set(VALID_PROVIDERS) == set(PROVIDER_REGISTRY.keys())


def test_manifest_has_required_fields():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    m = PROVIDER_REGISTRY["claude"]
    assert m.id == "claude"
    assert m.display_name == "Claude Code"
    assert m.binary == "claude"
    assert m.agent_class is not None
    assert isinstance(m.roles, list)
    assert len(m.roles) > 0


def test_all_manifests_have_roles():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    for pid, m in PROVIDER_REGISTRY.items():
        assert isinstance(m.roles, list), f"{pid} missing roles"
        assert len(m.roles) > 0, f"{pid} has empty roles"


def test_claude_has_planner_and_em_reviewer_roles():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    roles = PROVIDER_REGISTRY["claude"].roles
    assert "planner" in roles
    assert "em_reviewer" in roles
    assert "executor" in roles
    assert "chat" in roles


def test_ollama_does_not_have_planner_role():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    roles = PROVIDER_REGISTRY["ollama"].roles
    assert "planner" not in roles
    assert "em_reviewer" not in roles
    assert "executor" in roles
    assert "chat" in roles


def test_codex_roles():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    roles = PROVIDER_REGISTRY["codex"].roles
    assert "executor" in roles
    assert "chat" in roles
    assert "planner" not in roles


def test_gemini_roles():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    roles = PROVIDER_REGISTRY["gemini"].roles
    assert "executor" in roles
    assert "chat" in roles
    assert "qa_reviewer" in roles


def test_make_agent_returns_correct_type():
    from nidavellir.agents.registry import make_agent
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = make_agent("claude", slot_id=0, workdir=Path("/tmp"))
    assert isinstance(agent, ClaudeAgent)


def test_make_agent_raises_on_unknown_provider():
    from nidavellir.agents.registry import make_agent
    with pytest.raises(ValueError, match="Unknown provider"):
        make_agent("gpt4", slot_id=0, workdir=Path("/tmp"))


def test_manifest_is_available_uses_binary():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    import shutil
    m = PROVIDER_REGISTRY["ollama"]
    expected = shutil.which(m.binary) is not None
    assert m.is_available() == expected


def test_capability_flags_types():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    m = PROVIDER_REGISTRY["claude"]
    assert isinstance(m.supports_session_resume, bool)
    assert isinstance(m.supports_interrupt, bool)
    assert isinstance(m.streams_incrementally, bool)
    assert isinstance(m.supports_multiline_input, bool)
    assert isinstance(m.supports_file_context, bool)
    assert isinstance(m.supports_image_input, bool)
    assert isinstance(m.supports_bash_execution, bool)
    assert isinstance(m.supports_file_write, bool)
    assert isinstance(m.supports_worktree_isolation, bool)
    assert isinstance(m.emits_tool_use_blocks, bool)
    assert isinstance(m.requires_network, bool)
    assert isinstance(m.supports_parallel_slots, bool)
    assert isinstance(m.extra_flags, list)
    assert isinstance(m.supports_mediated_tool_approval, bool)
    assert m.default_dangerousness in {"restricted", "ask", "trusted", "free_rein"}
    assert isinstance(m.supports_live_steering, bool)
    assert isinstance(m.supports_queued_steering, bool)
    assert isinstance(m.supports_redirect_steering, bool)
    assert isinstance(m.steering_label, str)


def test_claude_capability_flags():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    m = PROVIDER_REGISTRY["claude"]
    assert m.supports_session_resume is True
    assert m.supports_interrupt is True
    assert m.streams_incrementally is True
    assert m.supports_file_context is True
    assert m.supports_image_input is True
    assert m.supports_bash_execution is True
    assert m.supports_file_write is True
    assert m.supports_worktree_isolation is True
    assert m.emits_tool_use_blocks is True
    assert m.requires_network is True
    assert m.supports_parallel_slots is True
    assert m.default_dangerousness == "restricted"
    assert "--dangerously-skip-permissions" in m.free_rein_flags
    assert "--tools" in m.restricted_flags
    assert m.supports_mediated_tool_approval is False
    assert m.supports_live_steering is False
    assert m.supports_queued_steering is True
    assert m.supports_redirect_steering is True
    assert m.steering_label == "Queue note"


def test_codex_current_transport_uses_queued_steering_not_live():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    m = PROVIDER_REGISTRY["codex"]
    assert m.supports_live_steering is False
    assert m.supports_queued_steering is True
    assert m.supports_redirect_steering is True
    assert m.steering_label == "Queue note"


def test_ollama_capability_flags():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    m = PROVIDER_REGISTRY["ollama"]
    assert m.supports_session_resume is False
    assert m.supports_image_input is False
    assert m.supports_bash_execution is False
    assert m.supports_worktree_isolation is False
    assert m.emits_tool_use_blocks is False
    assert m.requires_network is False
    assert m.supports_parallel_slots is False
    assert m.extra_flags == []


def test_cost_tier_values():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    assert PROVIDER_REGISTRY["claude"].cost_tier == "subscription"
    assert PROVIDER_REGISTRY["codex"].cost_tier == "subscription"
    assert PROVIDER_REGISTRY["gemini"].cost_tier == "subscription"
    assert PROVIDER_REGISTRY["ollama"].cost_tier == "local"


def test_latency_tier_values():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    assert PROVIDER_REGISTRY["ollama"].latency_tier == "low"
    assert PROVIDER_REGISTRY["claude"].latency_tier in ("medium", "high")


def test_output_format_values():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    valid = {"ansi_rich", "ansi_simple", "markdown", "plain"}
    for pid, m in PROVIDER_REGISTRY.items():
        assert m.output_format in valid, f"{pid} has invalid output_format: {m.output_format}"


def test_max_concurrent_slots_types():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    for pid, m in PROVIDER_REGISTRY.items():
        assert m.max_concurrent_slots is None or isinstance(m.max_concurrent_slots, int), \
            f"{pid} max_concurrent_slots invalid"


def test_ollama_max_concurrent_slots_is_one():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    assert PROVIDER_REGISTRY["ollama"].max_concurrent_slots == 1


def test_description_is_nonempty():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    for pid, m in PROVIDER_REGISTRY.items():
        assert m.description, f"{pid} missing description"
