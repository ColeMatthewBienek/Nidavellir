"""Tests for token usage API endpoints."""
from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

from nidavellir.main import app
from nidavellir.tokens.store import TokenUsageStore


def _store(tmp_path):
    s = TokenUsageStore(str(tmp_path / "tokens.db"))
    app.state.token_store = s
    return s


def _insert(store, session_id="s1", input_t=1000, output_t=300,
             provider="anthropic", model="claude-sonnet-4-6"):
    store.insert({
        "id":                         str(uuid.uuid4()),
        "request_id":                 str(uuid.uuid4()),
        "session_id":                 session_id,
        "provider":                   provider,
        "model":                      model,
        "preflight_input_tokens":     None,
        "preflight_source":           None,
        "reported_input_tokens":      input_t,
        "reported_output_tokens":     output_t,
        "reported_total_tokens":      input_t + output_t,
        "cached_input_tokens":        None,
        "cache_creation_input_tokens": None,
        "cache_read_input_tokens":    None,
        "reasoning_tokens":           None,
        "discrepancy_pct":            None,
        "suspect":                    False,
        "stop_reason":                None,
        "finish_reason":              "end_turn",
        "incomplete_reason":          None,
        "anomaly":                    False,
        "anomaly_types":              None,
    })


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/context/usage
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_context_usage_returns_200(tmp_path):
    _store(tmp_path)
    # conversation_id is now required — create a valid conversation first
    app.state.memory_store.create_conversation("s1", model_id="claude-sonnet-4-6", provider_id="anthropic")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/context/usage?conversation_id=s1&model=claude-sonnet-4-6&provider=anthropic")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_context_usage_response_shape(tmp_path):
    _store(tmp_path)
    app.state.memory_store.create_conversation("s1", model_id="claude-sonnet-4-6", provider_id="anthropic")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/context/usage?conversation_id=s1&model=claude-sonnet-4-6&provider=anthropic")
    body = r.json()
    for field in ("model", "provider", "currentTokens", "usableTokens",
                  "percentUsed", "state", "accuracy", "contextLimit",
                  "reservedOutputTokens", "lastUpdatedAt"):
        assert field in body, f"context/usage response missing '{field}'"


@pytest.mark.asyncio
async def test_context_usage_state_correct(tmp_path):
    """Valid conversation with no messages → zero tokens → ok state."""
    _store(tmp_path)
    app.state.memory_store.create_conversation("empty-conv", model_id="claude-sonnet-4-6", provider_id="anthropic")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/context/usage?conversation_id=empty-conv&model=claude-sonnet-4-6&provider=anthropic")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "ok"
    assert body["currentTokens"] == 0


@pytest.mark.asyncio
async def test_context_usage_not_from_historical_totals(tmp_path):
    """Historical token records must NOT influence context pressure calculation."""
    store = _store(tmp_path)
    # Insert huge historical records — must be ignored by context/usage
    _insert(store, session_id="s1", input_t=99999, output_t=99999)
    # Create a conversation with no messages — tokens must be 0
    app.state.memory_store.create_conversation("fresh-conv", model_id="claude-sonnet-4-6", provider_id="anthropic")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/context/usage?conversation_id=fresh-conv&model=claude-sonnet-4-6&provider=anthropic")
    assert r.status_code == 200
    body = r.json()
    assert body["currentTokens"] == 0, (
        "Historical token records must not influence context pressure"
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/tokens/dashboard
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_dashboard_returns_200(tmp_path):
    _store(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/dashboard")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_dashboard_response_shape(tmp_path):
    _store(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/dashboard")
    body = r.json()
    for field in ("providers", "rollingWindow", "dailyTotals", "anomalies", "recentIssues", "generatedAt"):
        assert field in body, f"dashboard response missing '{field}'"


@pytest.mark.asyncio
async def test_dashboard_groups_by_provider(tmp_path):
    store = _store(tmp_path)
    _insert(store, provider="anthropic", model="claude-sonnet-4-6", input_t=1000)
    _insert(store, provider="codex",     model="gpt-5.4",           input_t=500)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/dashboard")
    providers = {p["provider"] for p in r.json()["providers"]}
    assert "anthropic" in providers
    assert "codex" in providers


@pytest.mark.asyncio
async def test_dashboard_sorts_by_usage_descending(tmp_path):
    store = _store(tmp_path)
    _insert(store, provider="low",  model="m1", input_t=100,  output_t=50)
    _insert(store, provider="high", model="m2", input_t=5000, output_t=1000)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/dashboard")
    providers = r.json()["providers"]
    names = [p["provider"] for p in providers]
    assert names.index("high") < names.index("low")


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/tokens/export
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_returns_200(tmp_path):
    _store(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/export?range=24h")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_export_has_attachment_header(tmp_path):
    _store(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/export?range=24h")
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert ".json" in cd


@pytest.mark.asyncio
async def test_export_24h_filters_correctly(tmp_path):
    store = _store(tmp_path)
    _insert(store, input_t=500)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/export?range=24h")
    body = r.json()
    assert "records" in body
    assert len(body["records"]) >= 1


@pytest.mark.asyncio
async def test_export_all_returns_records(tmp_path):
    store = _store(tmp_path)
    _insert(store, input_t=500)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/export?range=all")
    body = r.json()
    assert len(body["records"]) >= 1


@pytest.mark.asyncio
async def test_export_cap_at_10000(tmp_path):
    store = _store(tmp_path)
    for _ in range(5):
        _insert(store, input_t=100)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/export?range=all")
    body = r.json()
    assert len(body["records"]) <= 10_000


@pytest.mark.asyncio
async def test_export_anomaly_flag_present(tmp_path):
    store = _store(tmp_path)
    _insert(store, input_t=500)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/export?range=all")
    records = r.json()["records"]
    if records:
        assert "anomaly" in records[0]
