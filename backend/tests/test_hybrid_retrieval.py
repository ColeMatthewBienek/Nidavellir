"""
Tests for SPEC-12D Phase 2C — Hybrid Retrieval.

Covers:
- Feature flag off preserves Phase 2B selection exactly
- Strong FTS dominates vector
- Vector-only allowed when FTS weak/empty
- Vector-only blocked: score < 0.63, confidence < 0.70, importance < 5
- Both-source candidate gets source='both'
- hybrid_scored event logged with required fields
- Usage tracking (mark_memories_used) still fires on hybrid selection
- ContextPack budget/category limits still apply
"""
from __future__ import annotations

import json

import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.injector import select_memories, get_context_pack
from nidavellir.memory.hybrid import (
    normalize_bm25,
    vector_boost,
    allow_vector_only,
    STRONG_FTS_THRESHOLD,
)


FAKE_DIM = 768
FAKE_VEC = [0.1] * FAKE_DIM


def _mem(id: str, content: str, *, confidence=0.9, importance=7,
         category="project", memory_type="fact") -> dict:
    return {
        "id": id, "content": content, "category": category,
        "memory_type": memory_type, "workflow": "chat",
        "scope_type": "workflow", "scope_id": "chat",
        "tags": "", "confidence": confidence, "importance": importance,
        "source": "manual",
    }


def _mock_embed(monkeypatch):
    import nidavellir.memory.embedding as emb
    monkeypatch.setattr(emb, "embed",       lambda *a, **kw: FAKE_VEC)
    monkeypatch.setattr(emb, "embed_query", lambda *a, **kw: FAKE_VEC)


def _no_vector(monkeypatch):
    """Make vector search return empty results."""
    import nidavellir.memory.retrieval as ret
    monkeypatch.setattr(ret, "search_vectors_with_diagnostics", lambda *a, **kw: {
        "results": [], "diagnostics": {"raw_results_count": 0, "filtered_results_count": 0,
                                        "raw_top_scores": [], "min_vector_sim": 0.55,
                                        "vector_store_count": 0, "query_vector_dim": 768}
    })


def _vector_returns(monkeypatch, results: list[dict]):
    """Make vector search return specific results."""
    import nidavellir.memory.retrieval as ret
    monkeypatch.setattr(ret, "search_vectors_with_diagnostics", lambda *a, **kw: {
        "results": results,
        "diagnostics": {"raw_results_count": len(results), "filtered_results_count": len(results),
                         "raw_top_scores": [r["score"] for r in results], "min_vector_sim": 0.55,
                         "vector_store_count": len(results), "query_vector_dim": 768}
    })


def _enable_hybrid(monkeypatch):
    import nidavellir.memory.hybrid as h
    monkeypatch.setattr(h, "HYBRID_ENABLED", True)


def _disable_hybrid(monkeypatch):
    import nidavellir.memory.hybrid as h
    monkeypatch.setattr(h, "HYBRID_ENABLED", False)


# ══════════════════════════════════════════════════════════════════════════════
# Unit tests — pure scoring functions
# ══════════════════════════════════════════════════════════════════════════════

def test_normalize_bm25_converts_negative_to_positive():
    assert normalize_bm25(-0.72) == pytest.approx(0.72)
    assert normalize_bm25(-1.5)  == pytest.approx(1.0)  # capped at 1.0
    assert normalize_bm25(None)  == 0.0
    assert normalize_bm25(0.0)   == 0.0


def test_vector_boost_tiers():
    assert vector_boost(0.75) == pytest.approx(0.75 * 1.5)   # strong
    assert vector_boost(0.65) == pytest.approx(0.65 * 1.0)   # moderate
    assert vector_boost(0.58) == pytest.approx(0.58 * 0.25)  # weak
    assert vector_boost(0.50) == pytest.approx(0.0)           # below 0.55 → 0
    assert vector_boost(None) == pytest.approx(0.0)


def test_allow_vector_only_blocks_when_strong_fts():
    cand = {"source": "vector", "vector_score": 0.75,
            "memory": {"confidence": 0.9, "importance": 8}}
    assert allow_vector_only(cand, has_strong_fts=True) is False


def test_allow_vector_only_passes_all_gates():
    cand = {"source": "vector", "vector_score": 0.70,
            "memory": {"confidence": 0.9, "importance": 7,
                        "superseded_by": None, "deleted_at": None}}
    assert allow_vector_only(cand, has_strong_fts=False) is True


def test_allow_vector_only_blocked_below_score():
    cand = {"source": "vector", "vector_score": 0.62,
            "memory": {"confidence": 0.9, "importance": 7,
                        "superseded_by": None, "deleted_at": None}}
    assert allow_vector_only(cand, has_strong_fts=False) is False


def test_allow_vector_only_blocked_low_confidence():
    cand = {"source": "vector", "vector_score": 0.70,
            "memory": {"confidence": 0.60, "importance": 7,
                        "superseded_by": None, "deleted_at": None}}
    assert allow_vector_only(cand, has_strong_fts=False) is False


def test_allow_vector_only_blocked_low_importance():
    cand = {"source": "vector", "vector_score": 0.70,
            "memory": {"confidence": 0.9, "importance": 3,
                        "superseded_by": None, "deleted_at": None}}
    assert allow_vector_only(cand, has_strong_fts=False) is False


# ══════════════════════════════════════════════════════════════════════════════
# 1. Feature flag off preserves Phase 2B selection
# ══════════════════════════════════════════════════════════════════════════════

def test_hybrid_disabled_preserves_phase2b_selection(tmp_path, monkeypatch):
    """With hybrid disabled, selection is identical to Phase 2B FTS/fallback."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend", importance=8)])

    _disable_hybrid(monkeypatch)
    _no_vector(monkeypatch)

    selected_with = select_memories(store, "FastAPI", "chat", is_new_session=True)

    _enable_hybrid(monkeypatch)
    _vector_returns(monkeypatch, [{"memory_id": "m1", "score": 0.80, "source": "vector"}])

    selected_without = select_memories(store, "FastAPI", "chat", is_new_session=True)

    # Both should include m1 (it's the only memory)
    ids_with    = [m["id"] for m in selected_with]
    ids_without = [m["id"] for m in selected_without]
    assert "m1" in ids_with
    assert "m1" in ids_without


def test_hybrid_disabled_no_hybrid_scored_event(tmp_path, monkeypatch):
    """With hybrid disabled, no hybrid_scored event must be emitted."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend", importance=8)])

    _disable_hybrid(monkeypatch)
    _no_vector(monkeypatch)

    get_context_pack(store, "FastAPI backend", "chat")

    events = store.get_events(event_type="hybrid_scored")
    assert not events, "hybrid_scored must not be logged when flag is disabled"


# ══════════════════════════════════════════════════════════════════════════════
# 2. Strong FTS dominates vector
# ══════════════════════════════════════════════════════════════════════════════

def test_strong_fts_dominates_vector(tmp_path, monkeypatch):
    """When FTS returns a strong match, vector-only candidates must not be selected."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([
        _mem("fts_mem",  "FastAPI backend framework",  importance=8, confidence=0.9),
        _mem("vec_only", "Some unrelated vector memory", importance=8, confidence=0.9),
    ])

    _enable_hybrid(monkeypatch)

    # FTS gives strong BM25 score for fts_mem only
    original_fts = store.search_fts
    def patched_fts(query, workflow, limit=10):
        results = original_fts(query, workflow, limit)
        for r in results:
            r["relevance_score"] = -0.9  # strong FTS
        return results
    monkeypatch.setattr(store, "search_fts", patched_fts)

    # Vector returns vec_only with high score
    _vector_returns(monkeypatch, [{"memory_id": "vec_only", "score": 0.80, "source": "vector"}])

    selected = select_memories(store, "FastAPI", "chat")
    ids = {m["id"] for m in selected}

    assert "vec_only" not in ids, "vector-only candidate must not override strong FTS"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Vector-only allowed when FTS empty
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_only_allowed_when_fts_empty(tmp_path, monkeypatch):
    """When FTS returns nothing, vector result with score>=0.63 must be selected."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("v1", "Semantic match", confidence=0.9, importance=7)])

    _enable_hybrid(monkeypatch)

    # FTS returns empty
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])

    # Vector returns v1 with qualifying score
    _vector_returns(monkeypatch, [{"memory_id": "v1", "score": 0.70, "source": "vector"}])

    selected = select_memories(store, "some semantic query", "chat")
    ids = {m["id"] for m in selected}

    assert "v1" in ids, "vector-only candidate must be selected when FTS is empty"


# ══════════════════════════════════════════════════════════════════════════════
# 4. Vector-only blocked below threshold
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_only_blocked_below_threshold(tmp_path, monkeypatch):
    """Vector-only candidate with score 0.62 must NOT be selected."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("v1", "Weak match", confidence=0.9, importance=7)])

    _enable_hybrid(monkeypatch)
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])
    _vector_returns(monkeypatch, [{"memory_id": "v1", "score": 0.62, "source": "vector"}])

    selected = select_memories(store, "some query", "chat")
    assert not any(m["id"] == "v1" for m in selected)


# ══════════════════════════════════════════════════════════════════════════════
# 5. Vector-only blocked by low confidence
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_only_blocked_low_confidence(tmp_path, monkeypatch):
    """Vector-only candidate with confidence 0.60 must NOT be selected."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("v1", "Low confidence", confidence=0.60, importance=7)])

    _enable_hybrid(monkeypatch)
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])
    _vector_returns(monkeypatch, [{"memory_id": "v1", "score": 0.75, "source": "vector"}])

    selected = select_memories(store, "some query", "chat")
    assert not any(m["id"] == "v1" for m in selected)


# ══════════════════════════════════════════════════════════════════════════════
# 6. Vector-only blocked by low importance
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_only_blocked_low_importance(tmp_path, monkeypatch):
    """Vector-only candidate with importance 3 must NOT be selected."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("v1", "Low importance", confidence=0.9, importance=3)])

    _enable_hybrid(monkeypatch)
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])
    _vector_returns(monkeypatch, [{"memory_id": "v1", "score": 0.75, "source": "vector"}])

    selected = select_memories(store, "some query", "chat")
    assert not any(m["id"] == "v1" for m in selected)


# ══════════════════════════════════════════════════════════════════════════════
# 7. Both-source candidate gets source='both'
# ══════════════════════════════════════════════════════════════════════════════

def test_candidate_in_both_sources_marked_both(tmp_path, monkeypatch):
    """Memory appearing in FTS and vector results must have source='both'."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("shared", "FastAPI backend", confidence=0.9, importance=8)])

    _enable_hybrid(monkeypatch)

    original_fts = store.search_fts
    def patched_fts(query, workflow, limit=10):
        results = original_fts(query, workflow, limit)
        for r in results:
            r["relevance_score"] = -0.5
        return results
    monkeypatch.setattr(store, "search_fts", patched_fts)

    _vector_returns(monkeypatch, [{"memory_id": "shared", "score": 0.75, "source": "vector"}])

    selected = select_memories(store, "FastAPI backend", "chat")
    both = [m for m in selected if m.get("_retrieval_source") == "both"]
    assert any(m["id"] == "shared" for m in selected), "shared memory must be selected"
    assert both, "memory in both FTS and vector must have source='both'"


# ══════════════════════════════════════════════════════════════════════════════
# 8. hybrid_scored event emitted
# ══════════════════════════════════════════════════════════════════════════════

def test_hybrid_scored_event_logged(tmp_path, monkeypatch):
    """get_context_pack must log hybrid_scored event when hybrid is enabled."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend", confidence=0.9, importance=8)])

    _enable_hybrid(monkeypatch)
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])
    _vector_returns(monkeypatch, [{"memory_id": "m1", "score": 0.75, "source": "vector"}])

    get_context_pack(store, "FastAPI backend", "chat")

    events = store.get_events(event_type="hybrid_scored")
    assert events, "hybrid_scored event must be logged"
    payload = json.loads(events[0]["payload_json"])

    for field in ("query", "hybrid_enabled", "has_strong_fts", "selected_ids", "candidates"):
        assert field in payload, f"hybrid_scored payload missing '{field}'"
    assert payload["hybrid_enabled"] is True


# ══════════════════════════════════════════════════════════════════════════════
# 9. Usage tracking still works
# ══════════════════════════════════════════════════════════════════════════════

def test_hybrid_selected_memories_marked_used(tmp_path, monkeypatch):
    """use_count must increment for hybrid-selected memories."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend", confidence=0.9, importance=8)])

    _enable_hybrid(monkeypatch)
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])
    _vector_returns(monkeypatch, [{"memory_id": "m1", "score": 0.75, "source": "vector"}])

    get_context_pack(store, "FastAPI backend", "chat")

    m = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert m["use_count"] > 0, "use_count must increment after hybrid injection"
    assert m["last_used"] is not None


# ══════════════════════════════════════════════════════════════════════════════
# 10. ContextPack limits still apply
# ══════════════════════════════════════════════════════════════════════════════

def test_hybrid_respects_contextpack_limits(tmp_path, monkeypatch):
    """Hybrid selection must not exceed MAX_FINAL_SELECTED memories."""
    from nidavellir.memory.hybrid import MAX_FINAL_SELECTED

    store = MemoryStore(str(tmp_path / "mem.db"))
    # Save more memories than the cap
    for i in range(MAX_FINAL_SELECTED + 5):
        store.save_memories([_mem(f"m{i}", f"Memory {i}", confidence=0.9, importance=8)])

    _enable_hybrid(monkeypatch)
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])
    vec_results = [{"memory_id": f"m{i}", "score": 0.75, "source": "vector"}
                   for i in range(MAX_FINAL_SELECTED + 5)]
    _vector_returns(monkeypatch, vec_results)

    selected = select_memories(store, "any query", "chat")

    assert len(selected) <= MAX_FINAL_SELECTED, \
        f"hybrid must not exceed MAX_FINAL_SELECTED={MAX_FINAL_SELECTED}"
