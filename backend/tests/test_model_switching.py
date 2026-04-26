"""
Tests for model_id flowing through the full pipeline:
  make_agent → agent.model_id → agent.cmd → subprocess

Also covers CLI connectivity smoke tests (skipped when binary absent).

Write FIRST. Run pytest to confirm failure. Then implement.
"""
import shutil
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── model_id stored on agent ──────────────────────────────────────────────────

def test_base_agent_stores_model_id():
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"), model_id="claude-sonnet-4-6")
    assert agent.model_id == "claude-sonnet-4-6"


def test_base_agent_model_id_defaults_to_none():
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"))
    assert agent.model_id is None


# ── ClaudeAgent.cmd includes --model when set ─────────────────────────────────

def test_claude_cmd_includes_model_flag_when_set():
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"), model_id="claude-opus-4-5")
    cmd = agent.cmd
    assert "--model" in cmd
    idx = cmd.index("--model")
    assert cmd[idx + 1] == "claude-opus-4-5"


def test_claude_cmd_has_no_model_flag_when_not_set():
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"))
    assert "--model" not in agent.cmd


def test_claude_cmd_model_flag_respects_all_three_tiers():
    from nidavellir.agents.claude_agent import ClaudeAgent
    for model in ["claude-opus-4-5", "claude-sonnet-4-6", "claude-haiku-4-5"]:
        agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"), model_id=model)
        cmd = agent.cmd
        assert "--model" in cmd
        assert cmd[cmd.index("--model") + 1] == model


def test_claude_cmd_includes_dangerously_skip_permissions():
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"), model_id="claude-sonnet-4-6")
    assert "--dangerously-skip-permissions" in agent.cmd


# ── CodexAgent.cmd uses exec subcommand with -m flag ─────────────────────────

def test_codex_cmd_uses_exec_subcommand():
    from nidavellir.agents.codex_agent import CodexAgent
    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"), model_id="o4-mini")
    assert "exec" in agent.cmd


def test_codex_cmd_includes_model_flag():
    from nidavellir.agents.codex_agent import CodexAgent
    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"), model_id="gpt-5.4")
    cmd = agent.cmd
    assert "-m" in cmd
    assert cmd[cmd.index("-m") + 1] == "gpt-5.4"


def test_codex_cmd_mini_model():
    from nidavellir.agents.codex_agent import CodexAgent
    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"), model_id="gpt-5.4-mini")
    cmd = agent.cmd
    assert cmd[cmd.index("-m") + 1] == "gpt-5.4-mini"


def test_codex_cmd_default_model_when_none():
    from nidavellir.agents.codex_agent import CodexAgent, DEFAULT_CODEX_MODEL
    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))
    cmd = agent.cmd
    assert cmd[cmd.index("-m") + 1] == DEFAULT_CODEX_MODEL


# ── make_agent forwards model_id ─────────────────────────────────────────────

def test_make_agent_forwards_model_id_to_claude():
    from nidavellir.agents.registry import make_agent
    from nidavellir.agents.claude_agent import ClaudeAgent
    agent = make_agent("claude", slot_id=0, workdir=Path("/tmp"), model_id="claude-haiku-4-5")
    assert isinstance(agent, ClaudeAgent)
    assert agent.model_id == "claude-haiku-4-5"


def test_make_agent_forwards_model_id_to_codex():
    from nidavellir.agents.registry import make_agent
    from nidavellir.agents.codex_agent import CodexAgent
    agent = make_agent("codex", slot_id=0, workdir=Path("/tmp"), model_id="gpt-5.4")
    assert isinstance(agent, CodexAgent)
    assert agent.model_id == "gpt-5.4"


def test_make_agent_model_id_none_by_default():
    from nidavellir.agents.registry import make_agent
    agent = make_agent("claude", slot_id=0, workdir=Path("/tmp"))
    assert agent.model_id is None


# ── Connectivity smoke tests (skipped when binary absent) ─────────────────────

@pytest.mark.skipif(not shutil.which("claude"), reason="claude CLI not on PATH")
def test_claude_cli_responds_to_version():
    """Claude CLI is installed and responsive."""
    result = subprocess.run(
        ["claude", "--version"],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0
    assert len(result.stdout.strip()) > 0


@pytest.mark.skipif(not shutil.which("codex"), reason="codex CLI not on PATH")
def test_codex_cli_responds_to_version():
    """Codex CLI is installed and responsive."""
    result = subprocess.run(
        ["codex", "--version"],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0


@pytest.mark.skipif(not shutil.which("ollama"), reason="ollama not on PATH")
def test_ollama_cli_responds_to_list():
    """Ollama is installed and can list models."""
    result = subprocess.run(
        ["ollama", "list"],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0


@pytest.mark.skipif(not shutil.which("claude"), reason="claude CLI not on PATH")
def test_models_endpoint_marks_claude_available():
    """GET /api/agents/models reports claude models as available when binary exists."""
    from fastapi.testclient import TestClient
    from nidavellir.main import app
    client = TestClient(app)
    resp = client.get("/api/agents/models")
    assert resp.status_code == 200
    claude_models = [m for m in resp.json()["models"] if m["provider_id"] == "claude"]
    assert len(claude_models) >= 3
    assert all(m["available"] for m in claude_models)


@pytest.mark.skipif(not shutil.which("codex"), reason="codex CLI not on PATH")
def test_models_endpoint_marks_codex_available():
    """GET /api/agents/models reports codex models as available when binary exists."""
    from fastapi.testclient import TestClient
    from nidavellir.main import app
    client = TestClient(app)
    resp = client.get("/api/agents/models")
    codex_models = [m for m in resp.json()["models"] if m["provider_id"] == "codex"]
    assert len(codex_models) >= 2
    assert all(m["available"] for m in codex_models)


def test_all_available_models_have_working_binaries():
    """Every model marked available=True must have its provider binary on PATH."""
    from nidavellir.agents.models import list_agent_models
    for m in list_agent_models():
        if m.available:
            binary = "claude" if m.provider_id == "claude" else m.provider_id
            assert shutil.which(binary) is not None, \
                f"Model {m.id} marked available but binary '{binary}' not found"
