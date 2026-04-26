"""
Tests for SPEC-12D Phase 2B BUGFIX — vector match failure diagnostics.

Verifies:
- VectorStore.count() reports stored points
- Ingestion and retrieval use the same path (same store instance)
- Threshold filtering exposes raw scores even when all filtered out
- Missing memory_id in payload is logged, not silently discarded
- Probe and health endpoints exist and return correct shape
- MIN_VECTOR_SIM is 0.55 (lowered for observation phase)
"""
from __future__ import annotations

import json

import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.retrieval import MIN_VECTOR_SIM, search_vectors_with_diagnostics


FAKE_DIM = 768
FAKE_VEC = [0.1] * FAKE_DIM


def _mem(id: str, content: str, *, confidence=0.9, importance=7) -> dict:
    return {
        "id": id, "content": content, "category": "project",
        "memory_type": "fact", "workflow": "chat",
        "scope_type": "workflow", "scope_id": "chat",
        "tags": "", "confidence": confidence, "importance": importance,
        "source": "manual",
    }


def _mock_embed(monkeypatch):
    import nidavellir.memory.embedding as emb
    monkeypatch.setattr(emb, "embed",       lambda *a, **kw: FAKE_VEC)
    monkeypatch.setattr(emb, "embed_query", lambda *a, **kw: FAKE_VEC)


# ══════════════════════════════════════════════════════════════════════════════
# 0. Threshold is lowered to 0.55
# ══════════════════════════════════════════════════════════════════════════════

def test_min_vector_sim_is_0_55():
    """MIN_VECTOR_SIM must be 0.55 for Phase 2B observation."""
    assert MIN_VECTOR_SIM == 0.55, f"Expected MIN_VECTOR_SIM=0.55, got {MIN_VECTOR_SIM}"


# ══════════════════════════════════════════════════════════════════════════════
# 1. VectorStore.count() reports points
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_store_count_reports_points(tmp_path, monkeypatch):
    """VectorStore.count() must reflect the number of upserted memories."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    assert store.vector_store.count() == 0, "empty store must report 0"

    store.save_memories([_mem("m1", "FastAPI backend")])
    assert store.vector_store.count() == 1, "after one save, count must be 1"

    store.save_memories([_mem("m2", "Python web services")])
    assert store.vector_store.count() == 2


# ══════════════════════════════════════════════════════════════════════════════
# 2. Same Qdrant path for ingestion and retrieval
# ══════════════════════════════════════════════════════════════════════════════

def test_ingestion_and_retrieval_share_vector_path(tmp_path, monkeypatch):
    """Ingestion and retrieval must use the same VectorStore instance."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework")])

    diag = search_vectors_with_diagnostics(store, "FastAPI backend")

    assert diag["diagnostics"]["vector_store_count"] == 1
    assert diag["diagnostics"]["raw_results_count"] > 0, \
        "raw_results_count must be > 0 when a memory is stored and queried with same vector"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Threshold filtering exposes raw scores
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_search_logs_raw_scores_even_when_all_filtered(tmp_path, monkeypatch):
    """Diagnostics must expose raw scores even when all results are below threshold."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "Some memory")])

    from nidavellir.memory.vector_store import VectorStore

    class FakePoint:
        def __init__(self, mid, score):
            self.payload = {"memory_id": mid}
            self.score = score

    monkeypatch.setattr(store._vector_store, "search", lambda *a, **kw: [FakePoint("m1", 0.30)])

    diag = search_vectors_with_diagnostics(store, "any query")

    assert diag["diagnostics"]["raw_results_count"] == 1
    assert diag["diagnostics"]["filtered_results_count"] == 0
    assert len(diag["diagnostics"]["raw_top_scores"]) == 1
    assert diag["diagnostics"]["raw_top_scores"][0] == pytest.approx(0.30, abs=0.01)
    assert diag["results"] == []


def test_diagnostics_contain_required_fields(tmp_path, monkeypatch):
    """search_vectors_with_diagnostics must return all required diagnostic fields."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend")])

    diag = search_vectors_with_diagnostics(store, "FastAPI backend")

    required = {
        "query", "raw_results_count", "filtered_results_count",
        "raw_top_scores", "min_vector_sim", "vector_store_count", "query_vector_dim",
    }
    missing = required - set(diag["diagnostics"].keys())
    assert not missing, f"Diagnostics missing fields: {missing}"


# ══════════════════════════════════════════════════════════════════════════════
# 4. Missing memory_id in payload is handled
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_payload_missing_memory_id_is_skipped(tmp_path, monkeypatch):
    """Results without memory_id in payload must be skipped gracefully."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "Some content")])

    class BadPoint:
        def __init__(self):
            self.payload = {}   # no memory_id
            self.score = 0.80   # above threshold

    monkeypatch.setattr(store._vector_store, "search", lambda *a, **kw: [BadPoint()])

    diag = search_vectors_with_diagnostics(store, "some query")

    # The bad result must be excluded from filtered results
    assert diag["results"] == [], "results with no memory_id must be excluded"
    # But raw count must still show it was found
    assert diag["diagnostics"]["raw_results_count"] == 1


# ══════════════════════════════════════════════════════════════════════════════
# 5. Probe endpoint returns joined memory content
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_vector_probe_endpoint_returns_memory_content(tmp_path, monkeypatch):
    """GET /api/memory/vector/probe must join vector hits back to SQLite content."""
    from httpx import AsyncClient, ASGITransport
    from nidavellir.main import app

    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework")])
    app.state.memory_store = store

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/memory/vector/probe?q=FastAPI backend")

    assert resp.status_code == 200
    body = resp.json()
    assert "query" in body
    assert "diagnostics" in body
    assert "results" in body


# ══════════════════════════════════════════════════════════════════════════════
# 6. Health endpoint returns count and status
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_vector_health_endpoint_returns_points_count(tmp_path, monkeypatch):
    """GET /api/memory/vector/health must report enabled, points_count, ready."""
    from httpx import AsyncClient, ASGITransport
    from nidavellir.main import app

    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend")])
    app.state.memory_store = store

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/memory/vector/health")

    assert resp.status_code == 200
    body = resp.json()
    for field in ("enabled", "points_count", "ready", "collection_name", "embedding_model"):
        assert field in body, f"health response missing '{field}'"
    assert body["enabled"] is True
    assert body["ready"] is True
    assert body["points_count"] == 1


@pytest.mark.asyncio
async def test_vector_health_endpoint_disabled_when_no_vector_store(tmp_path):
    """Health endpoint must report enabled=False when no vector_path configured."""
    from httpx import AsyncClient, ASGITransport
    from nidavellir.main import app

    store = MemoryStore(str(tmp_path / "mem.db"))  # no vector_path
    app.state.memory_store = store

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/memory/vector/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["ready"] is False


# ══════════════════════════════════════════════════════════════════════════════
# 7. _observe_vectors logs rich diagnostics in vector_searched payload
# ══════════════════════════════════════════════════════════════════════════════

def test_observe_vectors_logs_rich_diagnostics(tmp_path, monkeypatch):
    """vector_searched payload must include raw_results_count, raw_top_scores."""
    _mock_embed(monkeypatch)

    from nidavellir.memory.injector import get_context_pack

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend", importance=8)])

    import nidavellir.memory.retrieval as ret_mod

    def rich_diag(*a, **kw):
        return {
            "results":     [{"memory_id": "m1", "score": 0.72, "source": "vector"}],
            "diagnostics": {
                "query":                  "FastAPI backend",
                "raw_results_count":      2,
                "filtered_results_count": 1,
                "raw_top_scores":         [0.72, 0.61],
                "min_vector_sim":         0.55,
                "vector_store_count":     1,
                "query_vector_dim":       768,
            },
        }

    monkeypatch.setattr(ret_mod, "search_vectors_with_diagnostics", rich_diag)

    get_context_pack(store, "FastAPI backend", "chat")

    events = store.get_events(event_type="vector_searched")
    assert events
    payload = json.loads(events[0]["payload_json"])
    assert "raw_results_count" in payload
    assert "raw_top_scores" in payload
    assert "min_vector_sim" in payload
    assert "vector_store_count" in payload
    assert "query_vector_dim" in payload
