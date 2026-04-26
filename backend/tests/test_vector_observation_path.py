"""
Tests for SPEC-12D Phase 2B Fix — vector observation end-to-end visibility.

Verifies:
- search_vectors is called from the context retrieval path
- vector_searched event is logged on success
- vector_search_failed is logged on failure (not silently swallowed)
- vector observation does not affect memory selection
- quality_events API returns vector_searched events
"""
from __future__ import annotations

import json

import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.injector import get_context_pack, select_memories


FAKE_DIM = 768
FAKE_VEC = [0.1] * FAKE_DIM
FAKE_RESULT = [{"memory_id": "m1", "score": 0.91, "source": "vector"}]


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
# 1. vector observation is called from context path
# ══════════════════════════════════════════════════════════════════════════════

def test_search_vectors_called_from_get_context_pack(tmp_path, monkeypatch):
    """search_vectors must be called exactly once per get_context_pack call."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework")])

    call_log: list[str] = []

    def tracking_search(s, query, limit=20):
        call_log.append(query)
        return FAKE_RESULT

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", tracking_search)

    get_context_pack(store, "FastAPI backend", "chat")

    assert len(call_log) == 1, "search_vectors must be called exactly once"
    assert call_log[0] == "FastAPI backend"


def test_vector_observation_runs_on_empty_memory_store(tmp_path, monkeypatch):
    """Vector observation must run even when no memories match (empty results)."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", lambda *a, **kw: [])

    get_context_pack(store, "any query", "chat")

    events = store.get_events(event_type="vector_searched")
    assert events, "vector_searched must be logged even with 0 results"


def test_vector_observation_skipped_on_empty_query(tmp_path, monkeypatch):
    """Vector observation must not run when query is empty."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")

    call_log: list[str] = []

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", lambda *a, **kw: call_log.append("x") or [])

    get_context_pack(store, "", "chat")

    assert not call_log, "search_vectors must not be called for empty queries"


# ══════════════════════════════════════════════════════════════════════════════
# 2. vector_searched event is logged on success
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_searched_event_logged(tmp_path, monkeypatch):
    """get_context_pack must log a vector_searched event on successful search."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework", importance=8)])

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", lambda *a, **kw: FAKE_RESULT)

    get_context_pack(store, "FastAPI backend", "chat")

    events = store.get_events(event_type="vector_searched")
    assert events, "vector_searched event must be logged"


def test_vector_searched_payload_fields(tmp_path, monkeypatch):
    """vector_searched payload must contain query, vector_results_count, top_results."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework", importance=8)])

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", lambda *a, **kw: FAKE_RESULT)

    get_context_pack(store, "FastAPI backend", "chat")

    events = store.get_events(event_type="vector_searched")
    assert events
    payload = json.loads(events[0]["payload_json"])
    assert "query" in payload
    assert "vector_results_count" in payload
    assert "top_results" in payload
    assert payload["vector_results_count"] == len(FAKE_RESULT)


# ══════════════════════════════════════════════════════════════════════════════
# 3. vector failure logs vector_search_failed (not silently swallowed)
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_failure_logs_vector_search_failed(tmp_path, monkeypatch):
    """When search_vectors raises, vector_search_failed must be logged (not silent)."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework", importance=8)])

    def exploding_search(*a, **kw):
        raise RuntimeError("Qdrant connection refused")

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", exploding_search)

    get_context_pack(store, "FastAPI backend", "chat")  # must not raise

    failed = store.get_events(event_type="vector_search_failed")
    assert failed, "vector_search_failed event must be logged on exception"

    payload = json.loads(failed[0]["payload_json"])
    assert "error" in payload
    assert "query" in payload


def test_vector_failure_does_not_log_vector_searched(tmp_path, monkeypatch):
    """When search fails, vector_searched must NOT be logged (use vector_search_failed)."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("down")))

    get_context_pack(store, "any query", "chat")

    searched = store.get_events(event_type="vector_searched")
    assert not searched, "vector_searched must NOT be logged when search fails"


def test_context_pack_does_not_raise_on_vector_failure(tmp_path, monkeypatch):
    """A failing vector search must not propagate an exception to the caller."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("down")))

    try:
        get_context_pack(store, "any query", "chat")
    except Exception as exc:
        pytest.fail(f"get_context_pack must not raise, but got: {exc}")


# ══════════════════════════════════════════════════════════════════════════════
# 4. vector search does not affect selected memories
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_search_does_not_affect_selected_memories(tmp_path, monkeypatch):
    """Memory selection must be identical regardless of vector search outcome."""
    _mock_embed(monkeypatch)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend framework", importance=8)])

    selected_before = [m["id"] for m in select_memories(store, "FastAPI", "chat", is_new_session=True)]

    import nidavellir.memory.retrieval as ret_mod
    monkeypatch.setattr(ret_mod, "search_vectors", lambda *a, **kw: FAKE_RESULT)

    selected_after = [m["id"] for m in select_memories(store, "FastAPI", "chat", is_new_session=True)]

    assert selected_before == selected_after, "Vector search must not change selection"


# ══════════════════════════════════════════════════════════════════════════════
# 5. quality_events API returns vector events
# ══════════════════════════════════════════════════════════════════════════════

def test_quality_events_includes_vector_searched(tmp_path):
    """quality_events must return vector_searched events."""
    store = MemoryStore(str(tmp_path / "mem.db"))

    store.log_event(
        event_type="vector_searched",
        event_subject="retrieval",
        payload={"query": "test", "vector_results_count": 1, "top_results": []},
    )

    events = store.quality_events("chat")
    types = {e["event_type"] for e in events}
    assert "vector_searched" in types, "quality_events must include vector_searched"


def test_quality_events_includes_vector_search_failed(tmp_path):
    """quality_events must return vector_search_failed events."""
    store = MemoryStore(str(tmp_path / "mem.db"))

    store.log_event(
        event_type="vector_search_failed",
        event_subject="retrieval",
        payload={"query": "test", "error": "connection refused"},
    )

    events = store.quality_events("chat")
    types = {e["event_type"] for e in events}
    assert "vector_search_failed" in types, "quality_events must include vector_search_failed"


def test_quality_events_includes_retrieval_fallback(tmp_path):
    """quality_events must still return retrieval_fallback after fix."""
    store = MemoryStore(str(tmp_path / "mem.db"))

    store.log_event(
        event_type="retrieval_fallback",
        event_subject="retrieval",
        payload={"query": "", "reason": "fallback_recency"},
    )

    events = store.quality_events("chat")
    types = {e["event_type"] for e in events}
    assert "retrieval_fallback" in types
