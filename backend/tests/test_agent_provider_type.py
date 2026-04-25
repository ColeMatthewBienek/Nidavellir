"""
Tests for provider_type ClassVar on CLIAgent subclasses.
Written FIRST — run to confirm failure, then implement.
"""
from pathlib import Path


def test_base_agent_has_provider_type_classvar():
    from nidavellir.agents.base import CLIAgent
    assert hasattr(CLIAgent, "provider_type")
    assert CLIAgent.provider_type == "unknown"


def test_claude_agent_provider_type():
    from nidavellir.agents.claude_agent import ClaudeAgent
    assert ClaudeAgent.provider_type == "claude"


def test_codex_agent_provider_type():
    from nidavellir.agents.codex_agent import CodexAgent
    assert CodexAgent.provider_type == "codex"


def test_gemini_agent_provider_type():
    from nidavellir.agents.gemini_agent import GeminiAgent
    assert GeminiAgent.provider_type == "gemini"


def test_ollama_cli_agent_provider_type():
    from nidavellir.agents.ollama_cli_agent import OllamaCliAgent
    assert OllamaCliAgent.provider_type == "ollama"


def test_provider_type_accessible_on_instance():
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"))
    assert agent.provider_type == "claude"


def test_provider_type_matches_registry():
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    from nidavellir.agents.claude_agent import ClaudeAgent
    from nidavellir.agents.codex_agent import CodexAgent
    from nidavellir.agents.gemini_agent import GeminiAgent
    from nidavellir.agents.ollama_cli_agent import OllamaCliAgent

    for cls in [ClaudeAgent, CodexAgent, GeminiAgent, OllamaCliAgent]:
        assert cls.provider_type in PROVIDER_REGISTRY, \
            f"{cls.__name__}.provider_type={cls.provider_type!r} not in registry"
