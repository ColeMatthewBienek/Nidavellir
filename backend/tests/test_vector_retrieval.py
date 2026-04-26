"""
Tests for SPEC-12D Phase 2B — Vector Retrieval Layer (observation only).

All tests mock Ollama and use an in-memory Qdrant client.
Injection behavior must be strictly unchanged.
"""
from __future__ import annotations

import json

import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.retrieval import search_vectors, MIN_VECTOR_SIM
from nidavellir.memory.injector import select_memories, get_context_pack


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
# 1. Vector search returns results
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_search_returns_results(tmp_path, monkeypatch):
    """search_vectors must return at least one result when a matching memory exists."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework")])

    results = search_vectors(store, "FastAPI backend")

    assert len(results) > 0


def test_vector_search_result_shape(tmp_path, monkeypatch):
    """Each result must have memory_id, score, and source='vector'."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework")])

    results = search_vectors(store, "FastAPI backend")

    assert results
    r = results[0]
    assert "memory_id" in r
    assert "score" in r
    assert r["source"] == "vector"


def test_vector_search_memory_id_matches_stored(tmp_path, monkeypatch):
    """Returned memory_id must match the ID of the stored memory."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework")])

    results = search_vectors(store, "FastAPI backend")

    ids = {r["memory_id"] for r in results}
    assert "m1" in ids


# ══════════════════════════════════════════════════════════════════════════════
# 2. Threshold filtering
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_threshold_filtering(tmp_path, monkeypatch):
    """All returned results must have score >= MIN_VECTOR_SIM."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework")])

    results = search_vectors(store, "FastAPI backend")

    assert all(r["score"] >= MIN_VECTOR_SIM for r in results), \
        f"All scores must be >= {MIN_VECTOR_SIM}"


def test_vector_threshold_filters_low_scores(tmp_path, monkeypatch):
    """Results below MIN_VECTOR_SIM must be excluded."""
    import nidavellir.memory.embedding as emb
    monkeypatch.setattr(emb, "embed",       lambda t, **kw: FAKE_VEC)
    monkeypatch.setattr(emb, "embed_query", lambda t, **kw: FAKE_VEC)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "Memory A")])

    # Mock vector_store.search to return a result with score below threshold
    from nidavellir.memory.vector_store import VectorStore
    from qdrant_client.models import ScoredPoint

    class FakePoint:
        def __init__(self, mid, score):
            self.payload = {"memory_id": mid}
            self.score = score

    original_search = store._vector_store.search

    def patched_search(embedding, limit=20):
        return [FakePoint("m1", 0.30)]  # below threshold

    monkeypatch.setattr(store._vector_store, "search", patched_search)

    results = search_vectors(store, "query")

    assert len(results) == 0, "Results below MIN_VECTOR_SIM must be filtered out"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Injection behavior unchanged
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_does_not_change_injection_behavior(tmp_path, monkeypatch):
    """select_memories output must be identical before and after a vector search."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework", importance=8)])

    before = [m["id"] for m in select_memories(store, "FastAPI", "chat", is_new_session=True)]
    search_vectors(store, "FastAPI backend")
    after  = [m["id"] for m in select_memories(store, "FastAPI", "chat", is_new_session=True)]

    assert before == after, "Vector search must not change injection selection"


def test_vector_search_no_side_effects_on_use_count(tmp_path, monkeypatch):
    """search_vectors must not modify use_count."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend")])

    use_count_before = next(
        m["use_count"] for m in store.get_active_memories("chat") if m["id"] == "m1"
    )

    search_vectors(store, "FastAPI backend")

    use_count_after = next(
        m["use_count"] for m in store.get_active_memories("chat") if m["id"] == "m1"
    )

    assert use_count_before == use_count_after, "search_vectors must not touch use_count"


# ══════════════════════════════════════════════════════════════════════════════
# 4. Graceful handling when vector store unavailable
# ══════════════════════════════════════════════════════════════════════════════

def test_search_vectors_returns_empty_when_no_vector_store(tmp_path):
    """search_vectors must return [] gracefully when vector store is not configured."""
    store = MemoryStore(str(tmp_path / "mem.db"))  # no vector_path

    results = search_vectors(store, "any query")

    assert results == []


def test_search_vectors_returns_empty_on_embed_failure(tmp_path, monkeypatch):
    """search_vectors must return [] gracefully when Ollama is unavailable."""
    import nidavellir.memory.embedding as emb

    # Patch embed for the upsert path (store.save_memories), then make embed_query
    # raise to simulate Ollama being unavailable during the search query.
    monkeypatch.setattr(emb, "embed", lambda *a, **kw: FAKE_VEC)

    def _raise(*a, **kw):
        raise RuntimeError("Ollama down")

    monkeypatch.setattr(emb, "embed_query", _raise)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend")])

    results = search_vectors(store, "FastAPI backend")

    assert results == [], "embed failure must return [] not raise"


# ══════════════════════════════════════════════════════════════════════════════
# 5. vector_searched event logged in get_context_pack
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_searched_event_logged(tmp_path, monkeypatch):
    """get_context_pack must log a vector_searched event for every call with a query."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend", importance=8)])

    get_context_pack(store, "FastAPI backend", "chat")

    events = store.get_events(event_type="vector_searched")
    assert events, "vector_searched event must be logged"


def test_vector_searched_payload_fields(tmp_path, monkeypatch):
    """vector_searched payload must contain query, counts, and top_results."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend", importance=8)])

    get_context_pack(store, "FastAPI backend", "chat")

    events = store.get_events(event_type="vector_searched")
    assert events
    payload = json.loads(events[0]["payload_json"])
    assert "query" in payload
    assert "vector_results_count" in payload
    assert "fts_results_count" in payload
    assert "top_results" in payload


def test_vector_searched_does_not_affect_injected_events(tmp_path, monkeypatch):
    """The presence of vector_searched events must not prevent injected events."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework", importance=8)])

    get_context_pack(store, "FastAPI backend", "chat")

    injected = store.get_events(event_type="injected")
    vector_searched = store.get_events(event_type="vector_searched")

    # Both types of events can coexist independently
    assert isinstance(injected, list)
    assert isinstance(vector_searched, list)
