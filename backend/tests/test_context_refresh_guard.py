"""Tests for context refresh identity guard.

Spec: context-refresh-conversation-id-patch.md

TDD — all tests written before implementation.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient, ASGITransport

from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.tokens.store import TokenUsageStore


def _setup(tmp_path):
    app.state.memory_store = MemoryStore(str(tmp_path / "mem.db"))
    app.state.token_store  = TokenUsageStore(str(tmp_path / "tok.db"))


# ── Backend Test 1 — empty conversation_id returns 400 ───────────────────────

@pytest.mark.asyncio
async def test_empty_conversation_id_returns_400(tmp_path):
    _setup(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/context/usage?conversation_id=&model=claude-sonnet-4-6&provider=claude")
    assert r.status_code == 400
    body = r.json()
    assert body.get("error") == "conversation_id_required"


# ── Backend Test 2 — missing conversation_id returns 400 ─────────────────────

@pytest.mark.asyncio
async def test_missing_conversation_id_returns_400(tmp_path):
    _setup(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/context/usage?model=claude-sonnet-4-6&provider=claude")
    assert r.status_code == 400
    body = r.json()
    assert body.get("error") == "conversation_id_required"


# ── Backend Test 3 — unknown conversation_id returns 404 ─────────────────────

@pytest.mark.asyncio
async def test_unknown_conversation_id_returns_404(tmp_path):
    _setup(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(
            "/api/context/usage"
            "?conversation_id=does-not-exist-abc-123"
            "&model=claude-sonnet-4-6&provider=claude"
        )
    assert r.status_code == 404
    body = r.json()
    assert body.get("error") == "conversation_not_found"
    assert body.get("conversation_id") == "does-not-exist-abc-123"


# ── Backend Test 4 — valid empty conversation returns 200 with zero tokens ────

@pytest.mark.asyncio
async def test_valid_empty_conversation_returns_200(tmp_path):
    _setup(tmp_path)
    store = app.state.memory_store
    cid = "valid-conv-no-messages"
    store.create_conversation(cid, model_id="claude-sonnet-4-6", provider_id="claude")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(
            f"/api/context/usage"
            f"?conversation_id={cid}&model=claude-sonnet-4-6&provider=claude"
        )
    assert r.status_code == 200
    body = r.json()
    assert "currentTokens" in body
    assert body["currentTokens"] >= 0


# ── WS Test 1 — context_update includes conversation_id ──────────────────────

def test_build_context_update_includes_conversation_id():
    """_build_context_update must produce a payload with non-empty conversation_id."""
    from nidavellir.routers.ws import _build_context_update

    msg = _build_context_update(conversation_id="conv-abc", model="claude-sonnet-4-6", provider="claude")
    assert msg["type"] == "context_update"
    assert msg["conversation_id"] == "conv-abc"
    assert msg["model"] == "claude-sonnet-4-6"
    assert msg["provider"] == "claude"


# ── WS Test 2 — context_update suppressed when conversation_id is None ───────

def test_build_context_update_suppressed_when_no_conversation_id():
    """_build_context_update must return None when conversation_id is missing."""
    from nidavellir.routers.ws import _build_context_update

    result = _build_context_update(conversation_id=None, model="claude-sonnet-4-6", provider="claude")
    assert result is None, "Must return None when conversation_id is missing"
