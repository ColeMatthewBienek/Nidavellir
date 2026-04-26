"""
Tests for SPEC-12H — Bad Hybrid Pick Detector.

Verifies:
- No warning for strong valid vector picks
- Warning for borderline (0.63–0.67) vector score
- High warning for below-gate vector score
- High warning for low-confidence selected memory
- Medium warning for low-importance vector-only memory
- Event logged when warnings exist
- No event logged when no warnings exist
- quality/events API includes bad_hybrid_pick_candidate
- Activity export includes bad_hybrid_pick_candidate
"""
from __future__ import annotations

import json

import pytest
from httpx import AsyncClient, ASGITransport

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.hybrid_quality import detect_bad_hybrid_picks
from nidavellir.memory.injector import get_context_pack
from nidavellir.main import app


# ── Helpers ───────────────────────────────────────────────────────────────────

def _selected(id="m1", source="vector", vector_score=0.75,
              confidence=0.90, importance=7, hybrid_score=2.5,
              category="project", memory_type="fact") -> dict:
    """Build a memory dict as the hybrid path would return it."""
    return {
        "id": id, "content": f"Content of {id}",
        "category": category, "memory_type": memory_type,
        "workflow": "chat", "scope_type": "workflow", "scope_id": "chat",
        "confidence": confidence, "importance": importance,
        "use_count": 0, "created_at": "2026-04-26T00:00:00",
        "superseded_by": None, "deleted_at": None,
        "_retrieval_source": source,
        "_vector_score": vector_score,
        "_hybrid_score": hybrid_score,
    }


def _enable_hybrid(monkeypatch):
    import nidavellir.memory.hybrid as h
    monkeypatch.setattr(h, "HYBRID_ENABLED", True)


def _vector_returns(monkeypatch, results):
    import nidavellir.memory.retrieval as ret
    monkeypatch.setattr(ret, "search_vectors_with_diagnostics", lambda *a, **kw: {
        "results": results,
        "diagnostics": {"raw_results_count": len(results), "filtered_results_count": len(results),
                        "raw_top_scores": [r["score"] for r in results], "min_vector_sim": 0.55,
                        "vector_store_count": len(results), "query_vector_dim": 768},
    })


def _mem(id: str, content: str, *, confidence=0.9, importance=7) -> dict:
    return {
        "id": id, "content": content, "category": "project",
        "memory_type": "fact", "workflow": "chat",
        "scope_type": "workflow", "scope_id": "chat",
        "tags": "", "confidence": confidence, "importance": importance,
        "source": "manual",
    }


# ══════════════════════════════════════════════════════════════════════════════
# 1. No warning for strong valid vector pick
# ══════════════════════════════════════════════════════════════════════════════

def test_no_warning_for_strong_valid_vector_pick():
    selected = [_selected(vector_score=0.72, confidence=0.90, importance=8)]
    warnings = detect_bad_hybrid_picks(selected, "How should I structure a FastAPI service?")
    assert warnings == [], f"Expected no warnings but got: {warnings}"


# ══════════════════════════════════════════════════════════════════════════════
# 2. Warning for borderline vector pick (0.63 <= score < 0.67)
# ══════════════════════════════════════════════════════════════════════════════

def test_warning_for_borderline_vector_pick():
    selected = [_selected(vector_score=0.64, confidence=0.90, importance=8)]
    warnings = detect_bad_hybrid_picks(selected, "some query")
    assert len(warnings) >= 1
    reasons = {w["reason"] for w in warnings}
    assert "vector_only_borderline_score" in reasons
    borderline = next(w for w in warnings if w["reason"] == "vector_only_borderline_score")
    assert borderline["severity"] == "medium"


# ══════════════════════════════════════════════════════════════════════════════
# 3. High warning for vector below gate (< 0.63)
# ══════════════════════════════════════════════════════════════════════════════

def test_high_warning_for_vector_below_gate():
    selected = [_selected(vector_score=0.59, confidence=0.90, importance=8)]
    warnings = detect_bad_hybrid_picks(selected, "some query")
    assert len(warnings) >= 1
    reasons = {w["reason"] for w in warnings}
    assert "vector_only_below_gate" in reasons
    below = next(w for w in warnings if w["reason"] == "vector_only_below_gate")
    assert below["severity"] == "high"


# ══════════════════════════════════════════════════════════════════════════════
# 4. High warning for low-confidence selected memory
# ══════════════════════════════════════════════════════════════════════════════

def test_high_warning_for_low_confidence_selected():
    selected = [_selected(confidence=0.60, vector_score=0.75, importance=7)]
    warnings = detect_bad_hybrid_picks(selected, "some query")
    reasons = {w["reason"] for w in warnings}
    assert "selected_low_confidence_memory" in reasons
    w = next(w for w in warnings if w["reason"] == "selected_low_confidence_memory")
    assert w["severity"] == "high"


# ══════════════════════════════════════════════════════════════════════════════
# 5. Medium warning for low-importance vector-only memory
# ══════════════════════════════════════════════════════════════════════════════

def test_medium_warning_for_low_importance_vector():
    selected = [_selected(source="vector", vector_score=0.75, importance=3, confidence=0.9)]
    warnings = detect_bad_hybrid_picks(selected, "some query")
    reasons = {w["reason"] for w in warnings}
    assert "selected_low_importance_memory" in reasons
    w = next(w for w in warnings if w["reason"] == "selected_low_importance_memory")
    assert w["severity"] == "medium"


# ══════════════════════════════════════════════════════════════════════════════
# 6. Warning payload contains required fields
# ══════════════════════════════════════════════════════════════════════════════

def test_warning_has_required_fields():
    selected = [_selected(vector_score=0.64, confidence=0.90, importance=8)]
    warnings = detect_bad_hybrid_picks(selected, "my query")
    assert warnings
    w = warnings[0]
    for field in ("memory_id", "reason", "severity", "source", "vector_score", "hybrid_score", "query"):
        assert field in w, f"Warning missing field '{field}'"


# ══════════════════════════════════════════════════════════════════════════════
# 7. FTS source — no vector-score warnings
# ══════════════════════════════════════════════════════════════════════════════

def test_fts_source_does_not_trigger_vector_warnings():
    selected = [_selected(source="fts", vector_score=None, confidence=0.9, importance=8)]
    warnings = detect_bad_hybrid_picks(selected, "some query")
    vector_warnings = [w for w in warnings
                       if w["reason"] in ("vector_only_borderline_score", "vector_only_below_gate")]
    assert not vector_warnings, "FTS-source memory must not trigger vector score warnings"


# ══════════════════════════════════════════════════════════════════════════════
# 8. Event logged when warnings exist (integration)
# ══════════════════════════════════════════════════════════════════════════════

def test_event_logged_when_warning_exists(tmp_path, monkeypatch):
    """get_context_pack must log bad_hybrid_pick_candidate when detector fires."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    # Save a borderline-score memory
    store.save_memories([_mem("m1", "Borderline memory", confidence=0.9, importance=8)])

    _enable_hybrid(monkeypatch)
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])
    _vector_returns(monkeypatch, [{"memory_id": "m1", "score": 0.64, "source": "vector"}])

    get_context_pack(store, "some query", "chat")

    events = store.get_events(event_type="bad_hybrid_pick_candidate")
    assert events, "bad_hybrid_pick_candidate event must be logged for borderline pick"
    payload = json.loads(events[0]["payload_json"])
    assert "reason" in payload
    assert "severity" in payload
    assert "query" in payload


# ══════════════════════════════════════════════════════════════════════════════
# 9. No event logged when no warnings exist
# ══════════════════════════════════════════════════════════════════════════════

def test_no_event_when_no_warnings(tmp_path, monkeypatch):
    """No bad_hybrid_pick_candidate event when selection is clean."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Strong memory", confidence=0.9, importance=8)])

    _enable_hybrid(monkeypatch)
    monkeypatch.setattr(store, "search_fts", lambda *a, **kw: [])
    _vector_returns(monkeypatch, [{"memory_id": "m1", "score": 0.75, "source": "vector"}])

    get_context_pack(store, "some query", "chat")

    events = store.get_events(event_type="bad_hybrid_pick_candidate")
    assert not events, "No bad_hybrid_pick_candidate must be logged for a clean strong pick"


# ══════════════════════════════════════════════════════════════════════════════
# 10. quality/events API includes bad_hybrid_pick_candidate
# ══════════════════════════════════════════════════════════════════════════════

def test_quality_events_api_includes_bad_hybrid_pick(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.log_event(
        event_type="bad_hybrid_pick_candidate",
        event_subject="retrieval",
        memory_id="m1",
        payload={"query": "test", "reason": "vector_only_borderline_score", "severity": "medium"},
    )
    app.state.memory_store = store

    import asyncio
    async def _get():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.get("/api/memory/quality/events")
    r = asyncio.get_event_loop().run_until_complete(_get())
    assert r.status_code == 200
    types = {e["event_type"] for e in r.json()["items"]}
    assert "bad_hybrid_pick_candidate" in types


# ══════════════════════════════════════════════════════════════════════════════
# 11. Activity export includes bad_hybrid_pick_candidate
# ══════════════════════════════════════════════════════════════════════════════

def test_activity_export_includes_bad_hybrid_pick(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.log_event(
        event_type="bad_hybrid_pick_candidate",
        event_subject="retrieval",
        memory_id="m1",
        payload={"query": "test", "reason": "vector_only_borderline_score", "severity": "medium"},
    )
    app.state.memory_store = store

    import asyncio
    async def _get():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.get("/api/memory/export/activity?hours=0")
    r = asyncio.get_event_loop().run_until_complete(_get())
    assert r.status_code == 200
    records = [json.loads(l) for l in r.text.strip().split("\n") if l.strip()]
    types = {x["event_type"] for x in records}
    assert "bad_hybrid_pick_candidate" in types
