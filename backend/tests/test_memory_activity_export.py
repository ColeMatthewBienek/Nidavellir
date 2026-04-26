"""Tests for SPEC-12F — Memory Activity Export (JSONL)."""
from __future__ import annotations

import json
import time

import pytest
from httpx import AsyncClient, ASGITransport

from nidavellir.memory.store import MemoryStore
from nidavellir.main import app


# ── Helpers ───────────────────────────────────────────────────────────────────

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


# ══════════════════════════════════════════════════════════════════════════════
# 1. Endpoint returns application/x-ndjson
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_content_type(store):
    store.log_event(event_type="injected", event_subject="injection", payload={"q": "test"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24")
    assert r.status_code == 200
    assert "ndjson" in r.headers["content-type"] or "json" in r.headers["content-type"]


# ══════════════════════════════════════════════════════════════════════════════
# 2. Response has attachment filename
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_has_attachment_filename(store):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity")
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert ".jsonl" in cd


# ══════════════════════════════════════════════════════════════════════════════
# 3. JSONL has one valid JSON object per line
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_valid_jsonl(store):
    store.log_event(event_type="injected", event_subject="injection", payload={"q": "a"})
    store.log_event(event_type="retrieval_fallback", event_subject="retrieval", payload={"q": "b"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24")
    lines = [l for l in r.text.strip().split("\n") if l.strip()]
    assert len(lines) >= 2
    for line in lines:
        obj = json.loads(line)
        assert isinstance(obj, dict)
        assert "event_type" in obj
        assert "schema_version" in obj


# ══════════════════════════════════════════════════════════════════════════════
# 4. Events ordered oldest to newest
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_ordered_oldest_first(store):
    store.log_event(event_type="injected",         event_subject="injection", payload={"n": 1})
    time.sleep(0.05)
    store.log_event(event_type="retrieval_fallback", event_subject="retrieval", payload={"n": 2})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24")
    lines = [json.loads(l) for l in r.text.strip().split("\n") if l.strip()]
    types = [l["event_type"] for l in lines]
    assert types.index("injected") < types.index("retrieval_fallback")


# ══════════════════════════════════════════════════════════════════════════════
# 5. Payload JSON is parsed into payload
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_payload_parsed(store):
    store.log_event(event_type="injected", event_subject="injection",
                    payload={"score": 1.23, "rank": 1})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24")
    records = [json.loads(l) for l in r.text.strip().split("\n") if l.strip()]
    inj = next(x for x in records if x["event_type"] == "injected")
    assert isinstance(inj["payload"], dict)
    assert inj["payload"]["score"] == pytest.approx(1.23)


# ══════════════════════════════════════════════════════════════════════════════
# 6. Malformed payload does not break export
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_malformed_payload_no_crash(store, tmp_path):
    import sqlite3
    store.log_event(event_type="injected", event_subject="injection", payload={"x": 1})
    db_path = str(tmp_path / "mem.db")
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE memory_events SET payload_json = 'NOT JSON' WHERE event_type = 'injected'")
    conn.commit()
    conn.close()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24")
    assert r.status_code == 200
    lines = [json.loads(l) for l in r.text.strip().split("\n") if l.strip()]
    bad = next((x for x in lines if x["event_type"] == "injected"), None)
    assert bad is not None
    assert bad["payload"] is None


# ══════════════════════════════════════════════════════════════════════════════
# 7. Memory snapshot included when memory exists
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_includes_memory_snapshot(store):
    store.save_memories([_mem("mem1", "FastAPI backend")])
    store.log_event(event_type="injected", memory_id="mem1", event_subject="injection",
                    payload={"rank": 1})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24&include_snapshots=true")
    records = [json.loads(l) for l in r.text.strip().split("\n") if l.strip()]
    inj = next(x for x in records if x.get("memory_id") == "mem1")
    assert inj["memory_snapshot"] is not None
    assert inj["memory_snapshot"]["content"] == "FastAPI backend"


# ══════════════════════════════════════════════════════════════════════════════
# 8. Snapshot is null when memory missing
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_snapshot_null_when_missing(store):
    store.log_event(event_type="injected", memory_id="nonexistent", event_subject="injection",
                    payload={"rank": 1})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24&include_snapshots=true")
    records = [json.loads(l) for l in r.text.strip().split("\n") if l.strip()]
    inj = next((x for x in records if x.get("memory_id") == "nonexistent"), None)
    assert inj is not None
    assert inj["memory_snapshot"] is None


# ══════════════════════════════════════════════════════════════════════════════
# 9. Filters: event_type, hours
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_event_type_filter(store):
    store.log_event(event_type="injected",         event_subject="injection", payload={})
    store.log_event(event_type="retrieval_fallback", event_subject="retrieval", payload={})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24&event_type=injected")
    records = [json.loads(l) for l in r.text.strip().split("\n") if l.strip()]
    assert all(x["event_type"] == "injected" for x in records)
    assert len(records) >= 1


@pytest.mark.asyncio
async def test_export_activity_hours_zero_returns_all(store):
    """hours=0 means all time — no time filter applied."""
    store.log_event(event_type="injected", event_subject="injection", payload={})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=0")
    assert r.status_code == 200
    lines = [l for l in r.text.strip().split("\n") if l.strip()]
    assert len(lines) >= 1


# ══════════════════════════════════════════════════════════════════════════════
# 10. Diagnostic tags are present
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_activity_diagnostic_tags_present(store):
    store.log_event(event_type="vector_searched",   event_subject="retrieval", payload={})
    store.log_event(event_type="retrieval_fallback", event_subject="retrieval", payload={})
    store.log_event(event_type="injected",           event_subject="injection", payload={})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/memory/export/activity?hours=24")
    records = [json.loads(l) for l in r.text.strip().split("\n") if l.strip()]
    for rec in records:
        assert "diagnostic_tags" in rec
        assert isinstance(rec["diagnostic_tags"], list)

    vs = next(x for x in records if x["event_type"] == "vector_searched")
    assert "vector" in vs["diagnostic_tags"]

    fb = next(x for x in records if x["event_type"] == "retrieval_fallback")
    assert "fallback" in fb["diagnostic_tags"]

    inj = next(x for x in records if x["event_type"] == "injected")
    assert "injection" in inj["diagnostic_tags"]
