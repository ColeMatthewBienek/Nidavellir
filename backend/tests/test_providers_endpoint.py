"""
Tests for GET /api/agents/providers enhanced response shape.
Written FIRST — run to confirm failure, then implement.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from nidavellir.main import app
    return TestClient(app)


def test_providers_endpoint_returns_list(client):
    resp = client.get("/api/agents/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert "providers" in data
    assert isinstance(data["providers"], list)


def test_providers_endpoint_has_all_four(client):
    resp = client.get("/api/agents/providers")
    ids = {p["id"] for p in resp.json()["providers"]}
    assert ids == {"claude", "codex", "gemini", "ollama"}


def test_provider_has_required_fields(client):
    resp = client.get("/api/agents/providers")
    provider = next(p for p in resp.json()["providers"] if p["id"] == "claude")

    required = [
        "id", "display_name", "description", "available", "roles",
        "supports_session_resume", "supports_interrupt", "streams_incrementally",
        "supports_file_context", "supports_image_input", "supports_bash_execution",
        "supports_file_write", "supports_worktree_isolation", "emits_tool_use_blocks",
        "cost_tier", "requires_network", "latency_tier",
        "supports_parallel_slots", "max_concurrent_slots", "output_format",
    ]
    for field in required:
        assert field in provider, f"Missing field: {field}"


def test_available_field_is_bool(client):
    resp = client.get("/api/agents/providers")
    for p in resp.json()["providers"]:
        assert isinstance(p["available"], bool), f"{p['id']} available is not bool"


def test_roles_field_is_list(client):
    resp = client.get("/api/agents/providers")
    for p in resp.json()["providers"]:
        assert isinstance(p["roles"], list), f"{p['id']} roles is not list"


def test_no_legacy_available_dict(client):
    """Old endpoint returned {providers: [...], available: {...}}.
    New endpoint must NOT have top-level 'available' key."""
    resp = client.get("/api/agents/providers")
    assert "available" not in resp.json()


def test_ollama_cost_tier_is_local(client):
    resp = client.get("/api/agents/providers")
    ollama = next(p for p in resp.json()["providers"] if p["id"] == "ollama")
    assert ollama["cost_tier"] == "local"
    assert ollama["requires_network"] is False
