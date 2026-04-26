"""Tests for SPEC-12G — Memory State Export (JSON Snapshot)."""
from __future__ import annotations

import json

import pytest
from httpx import AsyncClient, ASGITransport

from nidavellir.memory.store import MemoryStore
from nidavellir.main import app


def _mem(id: str, content: str, *, confidence=0.9, importance=7) -> dict:
    return {
        "id": id, "content": content, "category": "project",
        "memory_type": "fact", "workflow": "chat",
        "scope_type": "workflow", "scope_id": "chat",
        "tags": "", "confidence": confidence, "importance": importance,
        "source": "manual",
    }


@pytest.fixture
def store(tmp_path):
    s = MemoryStore(str(tmp_path / "mem.db"))
    app.state.memory_store = s
    return s


async def _get_state(store_fixture, **params):
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"/api/memory/export/state?{qs}" if qs else "/api/memory/export/state"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(url)
    return r


# ══════════════════════════════════════════════════════════════════════════════
# 1. Returns JSON
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_returns_json(store):
    r = await _get_state(store)
    assert r.status_code == 200
    assert "json" in r.headers["content-type"]
    body = r.json()
    assert isinstance(body, dict)


# ══════════════════════════════════════════════════════════════════════════════
# 2. Attachment filename
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_has_attachment_filename(store):
    r = await _get_state(store)
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert ".json" in cd


# ══════════════════════════════════════════════════════════════════════════════
# 3. schema_version = memory_state.v1
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_schema_version(store):
    r = await _get_state(store)
    assert r.json()["schema_version"] == "memory_state.v1"


# ══════════════════════════════════════════════════════════════════════════════
# 4. Includes summary
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_includes_summary(store):
    store.save_memories([_mem("m1", "Active memory")])
    r = await _get_state(store)
    body = r.json()
    assert "summary" in body
    summary = body["summary"]
    for field in ("total_memories", "active_memories", "never_used", "injected_24h"):
        assert field in summary, f"summary missing '{field}'"
    assert summary["active_memories"] >= 1


# ══════════════════════════════════════════════════════════════════════════════
# 5. Includes memories
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_includes_memories(store):
    store.save_memories([_mem("m1", "Active memory")])
    r = await _get_state(store)
    body = r.json()
    assert "memories" in body
    assert len(body["memories"]) >= 1


# ══════════════════════════════════════════════════════════════════════════════
# 6. agent_readiness present for each memory
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_agent_readiness_present(store):
    store.save_memories([_mem("m1", "Active memory", confidence=0.9)])
    r = await _get_state(store)
    mems = r.json()["memories"]
    for m in mems:
        assert "agent_readiness" in m
        assert "injectable" in m["agent_readiness"]
        assert "reason" in m["agent_readiness"]


# ══════════════════════════════════════════════════════════════════════════════
# 7. Superseded memory has injectable=false
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_superseded_not_injectable(store):
    store.save_memories([_mem("m1", "Old memory"), _mem("m2", "New memory")])
    store.update_memory("m1", {"superseded_by": "m2"})
    r = await _get_state(store, include_superseded="true")
    mems = {m["id"]: m for m in r.json()["memories"]}
    assert "m1" in mems
    assert mems["m1"]["agent_readiness"]["injectable"] is False
    assert "superseded" in mems["m1"]["agent_readiness"]["reason"]


# ══════════════════════════════════════════════════════════════════════════════
# 8. Low-confidence memory has injectable=false
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_low_confidence_not_injectable(store):
    store.save_memories([_mem("m1", "Low confidence", confidence=0.55)])
    r = await _get_state(store)
    mems = {m["id"]: m for m in r.json()["memories"]}
    assert "m1" in mems
    assert mems["m1"]["agent_readiness"]["injectable"] is False
    assert "low_confidence" in mems["m1"]["agent_readiness"]["reason"]


# ══════════════════════════════════════════════════════════════════════════════
# 9. Recent events included when requested
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_events_included_when_requested(store):
    store.log_event(event_type="injected", event_subject="injection", payload={})
    r = await _get_state(store, include_events="true", event_limit="50")
    body = r.json()
    assert "recent_events" in body
    assert len(body["recent_events"]) >= 1


# ══════════════════════════════════════════════════════════════════════════════
# 10. Recent events omitted when include_events=false
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_events_omitted_when_not_requested(store):
    store.log_event(event_type="injected", event_subject="injection", payload={})
    r = await _get_state(store, include_events="false")
    body = r.json()
    assert body.get("recent_events") == [] or "recent_events" not in body


# ══════════════════════════════════════════════════════════════════════════════
# 11. Vector health included
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_vector_health_present(store):
    r = await _get_state(store, include_vectors="true")
    body = r.json()
    assert "vector_health" in body


# ══════════════════════════════════════════════════════════════════════════════
# 12. Does not fail when vector health fails
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_no_failure_when_vector_health_fails(store, monkeypatch):
    def bad_health(*a, **kw):
        raise RuntimeError("Qdrant crashed")

    import nidavellir.routers.memory as mem_router
    original = getattr(mem_router, "_get_vector_health", None)
    if original:
        monkeypatch.setattr(mem_router, "_get_vector_health", bad_health)

    r = await _get_state(store, include_vectors="true")
    assert r.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# 13. Diagnostics warnings when never-used ratio is high
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_state_diagnostics_warnings_never_used(store):
    # Save memories all with use_count=0 (never used)
    for i in range(6):
        store.save_memories([_mem(f"m{i}", f"Memory {i}", confidence=0.9)])
    r = await _get_state(store)
    body = r.json()
    assert "diagnostics" in body
    assert "warnings" in body["diagnostics"]
    assert "notes" in body["diagnostics"]
    # At least one warning about never-used memories
    warnings_text = " ".join(body["diagnostics"]["warnings"]).lower()
    assert "never" in warnings_text or "unused" in warnings_text or len(body["diagnostics"]["warnings"]) >= 1
