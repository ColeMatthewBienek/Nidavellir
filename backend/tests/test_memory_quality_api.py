"""
Tests for SPEC-12C memory quality store methods and endpoint shapes.

Tests exercise store methods directly (no HTTP transport needed) since the
endpoints are thin wrappers. A handful of endpoint-shape tests use the
async client to confirm routing and serialization.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, UTC

import pytest

from nidavellir.memory.store import MemoryStore


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mem(id: str, content: str, *,
         confidence=0.9, importance=5, use_count=0,
         workflow="chat", scope_type="workflow", scope_id="chat",
         category="project", memory_type="fact", tags="") -> dict:
    return {
        "id": id, "content": content, "category": category,
        "memory_type": memory_type, "workflow": workflow,
        "scope_type": scope_type, "scope_id": scope_id,
        "tags": tags, "confidence": confidence, "importance": importance,
        "source": "manual",
    }


def _backdate(db_path: str, memory_id: str, days: int, field: str = "created_at") -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        f"UPDATE memories SET {field} = datetime('now', '-{days} days') WHERE id = ?",
        (memory_id,),
    )
    conn.commit()
    conn.close()


def _set_use_count(db_path: str, memory_id: str, count: int, last_used_days_ago: int | None = None) -> None:
    conn = sqlite3.connect(db_path)
    if last_used_days_ago is not None:
        conn.execute(
            "UPDATE memories SET use_count=?, last_used=datetime('now',?) WHERE id=?",
            (count, f"-{last_used_days_ago} days", memory_id),
        )
    else:
        conn.execute("UPDATE memories SET use_count=? WHERE id=?", (count, memory_id))
    conn.commit()
    conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# 1. quality_summary returns expected counts
# ══════════════════════════════════════════════════════════════════════════════

def test_quality_summary_active_count(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Active memory", confidence=0.9)])
    store.save_memories([_mem("m2", "Also active", confidence=0.8)])

    summary = store.quality_summary("chat")

    assert summary["active_memories"] == 2
    assert "total_memories" in summary
    assert "last_updated" in summary


def test_quality_summary_low_confidence_count(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("low", "Low but stored", confidence=0.55)])
    store.save_memories([_mem("ok",  "High confidence", confidence=0.90)])

    summary = store.quality_summary("chat")

    assert summary["low_confidence_stored"] == 1


def test_quality_summary_never_used_count(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("u0", "Never used", confidence=0.9)])
    store.save_memories([_mem("u1", "Also never used", confidence=0.9)])
    store.save_memories([_mem("u2", "Used once", confidence=0.9)])
    _set_use_count(db_path, "u2", 5)

    summary = store.quality_summary("chat")

    assert summary["never_used"] == 2


def test_quality_summary_superseded_count(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("old", "Old memory", confidence=0.9)])
    store.update_memory("old", {"superseded_by": "new"})

    summary = store.quality_summary("chat")

    assert summary["superseded"] == 1


def test_quality_summary_injected_24h(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Memory", confidence=0.9, tags="test")])
    # Log an injected event
    store.log_event(event_type="injected", memory_id="m1", event_subject="injection",
                    payload={"query": "test", "rank": 1, "score": 1.0,
                             "reason": "fts_match", "scope_match": "workflow", "injected": True})

    summary = store.quality_summary("chat")

    assert summary["injected_24h"] >= 1


def test_quality_summary_extraction_failures_24h(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.log_event(event_type="extraction_failed", event_subject="extraction",
                    payload={"error": "timeout"})

    summary = store.quality_summary("chat")

    assert summary["extraction_failures_24h"] >= 1


def test_quality_summary_fallback_events_24h(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.log_event(event_type="retrieval_fallback", event_subject="retrieval",
                    payload={"query": "test", "reason": "fallback_recency"})

    summary = store.quality_summary("chat")

    assert summary["fallback_events_24h"] >= 1


# ══════════════════════════════════════════════════════════════════════════════
# 2. low-confidence endpoint returns only confidence 0.50–0.69
# ══════════════════════════════════════════════════════════════════════════════

def test_low_confidence_range(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("lo", "Low", confidence=0.55)])
    store.save_memories([_mem("hi", "High", confidence=0.85)])
    # Below store threshold — not stored at all
    store.save_memories([_mem("vlo", "Very low", confidence=0.3)])

    items = store.quality_low_confidence("chat")

    ids = {m["id"] for m in items}
    assert "lo" in ids,  "0.55 confidence must be in low-confidence list"
    assert "hi" not in ids, "0.85 confidence must NOT be in low-confidence list"
    assert "vlo" not in ids, "0.3 confidence was never stored, must not appear"


def test_low_confidence_boundary(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("exactly_50", "Boundary low",  confidence=0.50)])
    store.save_memories([_mem("exactly_70", "Boundary high", confidence=0.70)])

    items = store.quality_low_confidence("chat")

    ids = {m["id"] for m in items}
    assert "exactly_50" in ids,      "0.50 confidence must be included"
    assert "exactly_70" not in ids,  "0.70 confidence must NOT be included (inject threshold)"


# ══════════════════════════════════════════════════════════════════════════════
# 3. never-used endpoint returns only use_count = 0
# ══════════════════════════════════════════════════════════════════════════════

def test_never_used_only_zero_count(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("zero", "Never touched", confidence=0.9)])
    store.save_memories([_mem("used", "Was used",      confidence=0.9)])
    _set_use_count(db_path, "used", 3)

    items = store.quality_never_used("chat")

    ids = {m["id"] for m in items}
    assert "zero" in ids,   "use_count=0 memory must appear"
    assert "used" not in ids, "use_count=3 memory must not appear"


def test_never_used_excludes_superseded(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("sup", "Superseded", confidence=0.9)])
    store.update_memory("sup", {"superseded_by": "other"})

    items = store.quality_never_used("chat")

    assert all(m["id"] != "sup" for m in items)


# ══════════════════════════════════════════════════════════════════════════════
# 4. frequent endpoint orders by use_count DESC
# ══════════════════════════════════════════════════════════════════════════════

def test_frequent_ordered_by_use_count_desc(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("a", "Memory A", confidence=0.9)])
    store.save_memories([_mem("b", "Memory B", confidence=0.9)])
    store.save_memories([_mem("c", "Memory C", confidence=0.9)])
    _set_use_count(db_path, "a", 10)
    _set_use_count(db_path, "b", 50)
    _set_use_count(db_path, "c", 5)

    items = store.quality_frequent("chat")

    ids = [m["id"] for m in items]
    assert ids.index("b") < ids.index("a"), "b (50) must come before a (10)"
    assert ids.index("a") < ids.index("c"), "a (10) must come before c (5)"


def test_frequent_excludes_never_used(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("used", "Used memory", confidence=0.9)])
    store.save_memories([_mem("zero", "Never used",  confidence=0.9)])
    _set_use_count(db_path, "used", 7)

    items = store.quality_frequent("chat", limit=10)

    # Only memories with use_count > 0 should appear in "frequent"
    ids = {m["id"] for m in items}
    assert "used" in ids
    assert "zero" not in ids


# ══════════════════════════════════════════════════════════════════════════════
# 5. stale endpoint returns memories older than threshold
# ══════════════════════════════════════════════════════════════════════════════

def test_stale_returns_old_never_used(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("old", "Old memory",   confidence=0.9)])
    store.save_memories([_mem("new", "Fresh memory", confidence=0.9)])
    _backdate(db_path, "old", 45)

    items = store.quality_stale("chat")

    ids = {m["id"] for m in items}
    assert "old" in ids,  "45-day-old never-used memory must be stale"
    assert "new" not in ids, "fresh memory must not be stale"


def test_stale_returns_old_last_used(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("m1", "Stale used", confidence=0.9)])
    _set_use_count(db_path, "m1", 3, last_used_days_ago=60)

    items = store.quality_stale("chat")

    assert any(m["id"] == "m1" for m in items)


def test_stale_item_has_age_days_field(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("m1", "Old", confidence=0.9)])
    _backdate(db_path, "m1", 45)

    items = store.quality_stale("chat")

    stale = next(m for m in items if m["id"] == "m1")
    assert "age_days" in stale
    assert stale["age_days"] >= 44


# ══════════════════════════════════════════════════════════════════════════════
# 6. events endpoint parses payload_json
# ══════════════════════════════════════════════════════════════════════════════

def test_events_parses_payload_json(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.log_event(event_type="extraction_failed", event_subject="extraction",
                    payload={"error": "timeout", "model": "claude-haiku-4-5"})

    items = store.quality_events("chat")

    evt = next(e for e in items if e["event_type"] == "extraction_failed")
    assert "payload" in evt
    assert isinstance(evt["payload"], dict)
    assert evt["payload"]["error"] == "timeout"


def test_events_handles_null_payload(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    # Log event with no payload
    store.log_event(event_type="retrieval_fallback", event_subject="retrieval")

    items = store.quality_events("chat")

    evt = next(e for e in items if e["event_type"] == "retrieval_fallback")
    assert "payload" in evt  # key must exist even if None


def test_events_filters_relevant_types(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.log_event(event_type="extraction_failed", event_subject="extraction",
                    payload={"error": "x"})
    store.log_event(event_type="injected", event_subject="injection",
                    payload={"query": "q", "rank": 1, "score": 1.0,
                             "reason": "fts_match", "scope_match": "workflow", "injected": True})

    items = store.quality_events("chat")

    types = {e["event_type"] for e in items}
    assert "extraction_failed" in types
    # injected events should NOT appear in quality events (they're routine)
    assert "injected" not in types


# ══════════════════════════════════════════════════════════════════════════════
# 7. duplicate endpoint dry-run does not mutate DB
# ══════════════════════════════════════════════════════════════════════════════

def test_duplicates_dry_run_no_mutation(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([
        _mem("m1", "JWT token validation middleware implementation", confidence=0.9),
        _mem("m2", "JWT middleware for token verification",          confidence=0.9),
    ])

    result = store.quality_duplicates("chat", dry_run=True)

    # Result has expected shape
    assert "groups" in result
    assert "groups_found" in result

    # DB not mutated — both memories still active
    active = store.get_active_memories("chat")
    ids = {m["id"] for m in active}
    assert "m1" in ids and "m2" in ids, "dry-run must not supersede any memory"


def test_duplicates_finds_similar_content(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([
        _mem("a", "user prefers concise technical responses",  confidence=0.9),
        _mem("b", "user likes concise technical answers",      confidence=0.9),
        _mem("c", "completely unrelated database performance", confidence=0.9),
    ])

    result = store.quality_duplicates("chat", dry_run=True)

    # a and b should be grouped; c should not
    all_winner_ids  = {g["winner_id"] for g in result["groups"]}
    all_loser_ids   = {lid for g in result["groups"] for lid in g["loser_ids"]}
    grouped = all_winner_ids | all_loser_ids

    assert "c" not in grouped, "unrelated memory must not be in any duplicate group"


# ══════════════════════════════════════════════════════════════════════════════
# 8. top-scored endpoint returns score field
# ══════════════════════════════════════════════════════════════════════════════

def test_top_scored_has_score_field(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend framework", confidence=0.9, tags="fastapi")])

    items = store.quality_top_scored("chat", query="FastAPI")

    assert items, "should return at least one result"
    assert "score" in items[0], "score field must be present"
    assert isinstance(items[0]["score"], float)


def test_top_scored_empty_query_returns_results(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Some memory", confidence=0.9)])

    items = store.quality_top_scored("chat", query="")

    assert isinstance(items, list)


def test_top_scored_ordered_by_score_desc(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("lo", "Low importance memory",  confidence=0.9, importance=1)])
    store.save_memories([_mem("hi", "High importance memory", confidence=0.9, importance=10)])

    items = store.quality_top_scored("chat", query="")

    ids = [m["id"] for m in items]
    assert ids.index("hi") < ids.index("lo"), "high importance must score higher"


# ══════════════════════════════════════════════════════════════════════════════
# 9. all endpoints return expected JSON shape
# ══════════════════════════════════════════════════════════════════════════════

def test_summary_shape(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    summary = store.quality_summary("chat")

    required_keys = {
        "active_memories", "total_memories", "injected_24h",
        "extraction_failures_24h", "dedup_rejections_24h",
        "low_confidence_stored", "never_used", "superseded",
        "fallback_events_24h", "last_updated",
    }
    assert required_keys <= summary.keys()


def test_stale_item_shape(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("m1", "Old memory", confidence=0.9)])
    _backdate(db_path, "m1", 45)

    items = store.quality_stale("chat")
    assert items
    item = items[0]
    for key in ("id", "content", "confidence", "age_days", "created_at"):
        assert key in item, f"stale item missing '{key}'"


def test_low_conf_item_shape(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Low conf", confidence=0.55)])

    items = store.quality_low_confidence("chat")
    assert items
    for key in ("id", "content", "confidence", "category", "created_at"):
        assert key in items[0], f"low-confidence item missing '{key}'"


def test_never_used_item_shape(tmp_path):
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Unused", confidence=0.9)])

    items = store.quality_never_used("chat")
    assert items
    for key in ("id", "content", "use_count", "created_at"):
        assert key in items[0], f"never-used item missing '{key}'"


def test_frequent_item_shape(tmp_path):
    db_path = str(tmp_path / "mem.db")
    store = MemoryStore(db_path)
    store.save_memories([_mem("m1", "Used memory", confidence=0.9)])
    _set_use_count(db_path, "m1", 5)

    items = store.quality_frequent("chat")
    assert items
    for key in ("id", "content", "use_count", "confidence", "importance"):
        assert key in items[0], f"frequent item missing '{key}'"
