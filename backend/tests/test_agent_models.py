"""
Tests for AgentModelDef and list_agent_models().
Written FIRST. Run pytest to confirm failure. Then implement.
"""
import pytest
from unittest.mock import patch, MagicMock


# ── AgentModelDef shape ───────────────────────────────────────────────────────

def test_agent_model_def_has_required_fields():
    from nidavellir.agents.models import AgentModelDef
    m = AgentModelDef(
        id="claude:claude-sonnet-4-6",
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        display_name="Claude Sonnet 4.6",
        description="Balanced model.",
        cost_tier="subscription",
        available=True,
    )
    assert m.id == "claude:claude-sonnet-4-6"
    assert m.provider_id == "claude"
    assert m.model_id == "claude-sonnet-4-6"
    assert m.display_name == "Claude Sonnet 4.6"
    assert m.description == "Balanced model."
    assert m.cost_tier == "subscription"
    assert m.available is True


def test_agent_model_def_id_format():
    from nidavellir.agents.models import AgentModelDef
    m = AgentModelDef(
        id="ollama:qwen3.6:27b",
        provider_id="ollama",
        model_id="qwen3.6:27b",
        display_name="Qwen 3.6 27B",
        description="Local model.",
        cost_tier="local",
        available=True,
    )
    assert m.id.startswith(m.provider_id + ":")


# ── Claude model definitions ──────────────────────────────────────────────────

def test_claude_models_present():
    from nidavellir.agents.models import CLAUDE_MODELS
    model_ids = [m.model_id for m in CLAUDE_MODELS]
    assert any("opus" in mid for mid in model_ids), "No opus model defined"
    assert any("sonnet" in mid for mid in model_ids), "No sonnet model defined"
    assert any("haiku" in mid for mid in model_ids), "No haiku model defined"


def test_claude_models_have_correct_provider_id():
    from nidavellir.agents.models import CLAUDE_MODELS
    for m in CLAUDE_MODELS:
        assert m.provider_id == "claude", f"{m.model_id} has wrong provider_id"


def test_claude_models_have_subscription_cost_tier():
    from nidavellir.agents.models import CLAUDE_MODELS
    for m in CLAUDE_MODELS:
        assert m.cost_tier == "subscription", f"{m.model_id} has wrong cost_tier"


def test_claude_model_ids_follow_convention():
    from nidavellir.agents.models import CLAUDE_MODELS
    for m in CLAUDE_MODELS:
        assert m.id == f"claude:{m.model_id}", f"{m.id} doesn't match convention"


# ── Codex model definitions ───────────────────────────────────────────────────

def test_codex_models_present():
    from nidavellir.agents.models import CODEX_MODELS
    assert len(CODEX_MODELS) >= 2, "Expected at least 2 codex models"


def test_codex_models_have_correct_provider_id():
    from nidavellir.agents.models import CODEX_MODELS
    for m in CODEX_MODELS:
        assert m.provider_id == "codex", f"{m.model_id} has wrong provider_id"


def test_codex_model_ids_follow_convention():
    from nidavellir.agents.models import CODEX_MODELS
    for m in CODEX_MODELS:
        assert m.id == f"codex:{m.model_id}", f"{m.id} doesn't match convention"


def test_codex_gpt_55_model_present_first():
    from nidavellir.agents.models import CODEX_MODELS
    assert CODEX_MODELS[0].id == "codex:gpt-5.5"
    assert CODEX_MODELS[0].model_id == "gpt-5.5"
    assert CODEX_MODELS[0].display_name == "GPT-5.5"


# ── Ollama list parsing ───────────────────────────────────────────────────────

SAMPLE_OLLAMA_OUTPUT = """\
NAME                       ID              SIZE      MODIFIED
qwen3.6:27b                a50eda8ed977    17 GB     44 hours ago
nomic-embed-text:latest    0a109f422b47    274 MB    4 days ago
"""


def test_parse_ollama_list_returns_model_names():
    from nidavellir.agents.models import _parse_ollama_list
    models = _parse_ollama_list(SAMPLE_OLLAMA_OUTPUT)
    assert "qwen3.6:27b" in models


def test_parse_ollama_list_excludes_embed_models():
    from nidavellir.agents.models import _parse_ollama_list
    models = _parse_ollama_list(SAMPLE_OLLAMA_OUTPUT)
    assert not any("embed" in m for m in models), "Embed models should be excluded"
    assert "nomic-embed-text:latest" not in models


def test_parse_ollama_list_handles_empty_output():
    from nidavellir.agents.models import _parse_ollama_list
    assert _parse_ollama_list("") == []
    assert _parse_ollama_list("NAME  ID  SIZE  MODIFIED") == []


def test_parse_ollama_list_handles_header_only():
    from nidavellir.agents.models import _parse_ollama_list
    header_only = "NAME                       ID              SIZE      MODIFIED"
    assert _parse_ollama_list(header_only) == []


# ── _get_ollama_models (subprocess mock) ──────────────────────────────────────

def test_get_ollama_models_calls_ollama_list():
    from nidavellir.agents import models as models_module
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = SAMPLE_OLLAMA_OUTPUT
    with patch("subprocess.run", return_value=mock_result) as mock_run:
        models_module._get_ollama_models()
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert "ollama" in args
        assert "list" in args


def test_get_ollama_models_returns_empty_on_failure():
    from nidavellir.agents.models import _get_ollama_models
    with patch("subprocess.run", side_effect=FileNotFoundError):
        assert _get_ollama_models() == []


def test_get_ollama_models_returns_empty_on_nonzero_exit():
    from nidavellir.agents.models import _get_ollama_models
    mock_result = MagicMock()
    mock_result.returncode = 1
    mock_result.stdout = ""
    with patch("subprocess.run", return_value=mock_result):
        assert _get_ollama_models() == []


# ── list_agent_models() ───────────────────────────────────────────────────────

def test_list_agent_models_returns_list():
    from nidavellir.agents.models import list_agent_models
    result = list_agent_models()
    assert isinstance(result, list)


def test_list_agent_models_includes_claude_models():
    from nidavellir.agents.models import list_agent_models
    result = list_agent_models()
    claude_models = [m for m in result if m.provider_id == "claude"]
    assert len(claude_models) >= 3, "Expected at least 3 Claude models"


def test_list_agent_models_includes_codex_models():
    from nidavellir.agents.models import list_agent_models
    result = list_agent_models()
    codex_models = [m for m in result if m.provider_id == "codex"]
    assert len(codex_models) >= 2, "Expected at least 2 Codex models"


def test_claude_models_available_when_binary_exists():
    from nidavellir.agents.models import list_agent_models
    with patch("shutil.which", side_effect=lambda b: "/usr/bin/claude" if b == "claude" else None):
        result = list_agent_models()
        claude_models = [m for m in result if m.provider_id == "claude"]
        assert all(m.available for m in claude_models)


def test_claude_models_unavailable_when_binary_missing():
    from nidavellir.agents.models import list_agent_models
    with patch("shutil.which", return_value=None):
        result = list_agent_models()
        claude_models = [m for m in result if m.provider_id == "claude"]
        assert all(not m.available for m in claude_models)


def test_ollama_models_included_when_binary_exists():
    from nidavellir.agents.models import list_agent_models
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = SAMPLE_OLLAMA_OUTPUT
    with patch("shutil.which", return_value="/usr/bin/ollama"), \
         patch("subprocess.run", return_value=mock_result):
        result = list_agent_models()
        ollama_models = [m for m in result if m.provider_id == "ollama"]
        assert len(ollama_models) >= 1
        assert any("qwen" in m.model_id for m in ollama_models)


def test_ollama_models_excluded_when_binary_missing():
    from nidavellir.agents.models import list_agent_models
    with patch("shutil.which", return_value=None):
        result = list_agent_models()
        ollama_models = [m for m in result if m.provider_id == "ollama"]
        assert ollama_models == []


def test_all_model_ids_are_unique():
    from nidavellir.agents.models import list_agent_models
    result = list_agent_models()
    ids = [m.id for m in result]
    assert len(ids) == len(set(ids)), "Duplicate model IDs found"


# ── /api/agents/models endpoint ───────────────────────────────────────────────

def test_models_endpoint_returns_models_list():
    from fastapi.testclient import TestClient
    from nidavellir.main import app
    client = TestClient(app)
    resp = client.get("/api/agents/models")
    assert resp.status_code == 200
    data = resp.json()
    assert "models" in data
    assert isinstance(data["models"], list)


def test_models_endpoint_has_claude_and_codex():
    from fastapi.testclient import TestClient
    from nidavellir.main import app
    client = TestClient(app)
    resp = client.get("/api/agents/models")
    provider_ids = {m["provider_id"] for m in resp.json()["models"]}
    assert "claude" in provider_ids
    assert "codex" in provider_ids


def test_models_endpoint_model_has_required_fields():
    from fastapi.testclient import TestClient
    from nidavellir.main import app
    client = TestClient(app)
    resp = client.get("/api/agents/models")
    model = resp.json()["models"][0]
    for field in ["id", "provider_id", "model_id", "display_name", "description", "cost_tier", "available"]:
        assert field in model, f"Missing field: {field}"


def test_models_endpoint_available_is_bool():
    from fastapi.testclient import TestClient
    from nidavellir.main import app
    client = TestClient(app)
    resp = client.get("/api/agents/models")
    for m in resp.json()["models"]:
        assert isinstance(m["available"], bool), f"{m['id']} available is not bool"
