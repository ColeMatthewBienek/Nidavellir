"""
Tests for SPEC-12A Phase 1 Completion:
  - WAL mode enabled on store init
  - FTS quality threshold (score > FTS_SCORE_THRESHOLD → fallback)
  - Score minimum filter (final_score < MIN_SCORE_THRESHOLD → excluded)
  - Retrieval logging on fallback (already covered, extended here)
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.injector import get_context_pack


def _mem(id: str, content: str, *, confidence=0.9, importance=5, tags="",
         workflow="chat", scope_type="workflow", scope_id="chat") -> dict:
    return {
        "id":          id,
        "content":     content,
        "category":    "project",
        "memory_type": "fact",
        "workflow":    workflow,
        "scope_type":  scope_type,
        "scope_id":    scope_id,
        "tags":        tags,
        "confidence":  confidence,
        "importance":  importance,
        "source":      "manual",
    }


# ══════════════════════════════════════════════════════════════════════════════
# 1. WAL mode
# ══════════════════════════════════════════════════════════════════════════════

def test_wal_mode_enabled(tmp_path):
    """MemoryStore must enable WAL journal mode on initialization."""
    db_path = tmp_path / "mem.db"
    MemoryStore(str(db_path))

    conn = sqlite3.connect(str(db_path))
    row = conn.execute("PRAGMA journal_mode").fetchone()
    conn.close()

    assert row[0] == "wal", f"Expected WAL journal mode, got: {row[0]}"


def test_wal_synchronous_set_per_connection(tmp_path):
    """MemoryStore must set synchronous=NORMAL on each managed connection.
    SQLite < 3.41 does not persist synchronous to the file; verify via a store operation."""
    db_path = tmp_path / "mem.db"
    store = MemoryStore(str(db_path))

    # Use the internal _conn context manager to check the pragma value
    with store._conn() as conn:
        row = conn.execute("PRAGMA synchronous").fetchone()
        assert row[0] == 1, f"Expected synchronous=NORMAL (1) on MemoryStore connections, got: {row[0]}"


# ══════════════════════════════════════════════════════════════════════════════
# 2. FTS quality threshold
# ══════════════════════════════════════════════════════════════════════════════

def test_fts_used_when_relevance_above_quality_threshold(tmp_path, monkeypatch):
    """FTS results are used when best score <= FTS_SCORE_THRESHOLD (-0.2)."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("fts_good", "FastAPI backend framework", confidence=0.9, tags="fastapi")])
    store.save_memories([_mem("recency",  "Unrelated recent memory",  confidence=0.9, importance=10)])

    original_search = store.search_fts

    def patched_search(query, workflow, limit=10):
        results = original_search(query, workflow, limit)
        # Simulate a high-quality FTS hit (score well below -0.2)
        for r in results:
            r["relevance_score"] = -0.8
        return results

    monkeypatch.setattr(store, "search_fts", patched_search)

    pack = get_context_pack(store, "FastAPI backend", "chat")
    ids = {m["id"] for m in pack.memories}

    assert "fts_good" in ids,   "High-quality FTS result must be used"
    assert "recency" not in ids, "Recency memory must not be mixed in when FTS qualifies"


def test_fallback_when_fts_below_quality_threshold(tmp_path, monkeypatch):
    """FTS results are discarded and recency fallback used when best score > FTS_SCORE_THRESHOLD."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("fts_weak", "Some weakly matching content", confidence=0.9, importance=2)])
    store.save_memories([_mem("recency",  "High importance recent fact",  confidence=0.9, importance=10)])

    original_search = store.search_fts

    def patched_search(query, workflow, limit=10):
        results = original_search(query, workflow, limit)
        # Simulate a low-quality FTS hit (score above -0.2)
        for r in results:
            r["relevance_score"] = -0.05
        return results

    monkeypatch.setattr(store, "search_fts", patched_search)

    pack = get_context_pack(store, "Some weakly matching content", "chat")
    ids = {m["id"] for m in pack.memories}

    assert "recency" in ids, "Recency fallback must be used when FTS quality is below threshold"


def test_fallback_logged_when_fts_below_quality_threshold(tmp_path, monkeypatch):
    """retrieval_fallback event logged when FTS quality threshold not met."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Some content", confidence=0.9)])

    original_search = store.search_fts

    def patched_search(query, workflow, limit=10):
        results = original_search(query, workflow, limit)
        for r in results:
            r["relevance_score"] = -0.05  # below quality threshold
        return results

    monkeypatch.setattr(store, "search_fts", patched_search)

    get_context_pack(store, "Some content", "chat")

    events = store.get_events(event_type="retrieval_fallback")
    assert events, "retrieval_fallback event must be logged when FTS quality threshold not met"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Score minimum filter
# ══════════════════════════════════════════════════════════════════════════════

def test_score_threshold_excludes_very_old_low_importance_memories(tmp_path):
    """Memories that score below MIN_SCORE_THRESHOLD must be excluded from context pack."""
    db_path = tmp_path / "mem.db"
    store = MemoryStore(str(db_path))

    # Memory: global scope (no scope boost), importance=1, memory_type='task' (half-life 7 days)
    # A 1000-day-old task with importance=1 and no scope match scores ≈ 0.1 < 0.2
    store.save_memories([{
        "id":          "old_task",
        "content":     "Ancient low-importance task",
        "category":    "task",
        "memory_type": "task",
        "workflow":    "chat",
        "scope_type":  "global",
        "scope_id":    "global",
        "tags":        "",
        "confidence":  0.9,
        "importance":  1,
        "source":      "manual",
    }])

    # Backdate to 1000 days ago via direct SQL
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "UPDATE memories SET created_at = datetime('now', '-1000 days') WHERE id = 'old_task'"
    )
    conn.commit()
    conn.close()

    # Also save a normal memory to ensure pack isn't trivially empty
    store.save_memories([_mem("normal", "Normal recent memory", confidence=0.9)])

    pack = get_context_pack(store, "", "chat")  # empty query → recency fallback
    ids = {m["id"] for m in pack.memories}

    assert "old_task" not in ids, "1000-day-old task with importance=1 must score below threshold and be excluded"
    assert "normal" in ids,       "normal recent memory must still be included"


def test_score_threshold_constant_exists():
    """MIN_SCORE_THRESHOLD must be defined in injector module."""
    import nidavellir.memory.injector as inj
    assert hasattr(inj, "MIN_SCORE_THRESHOLD"), "MIN_SCORE_THRESHOLD must be a module-level constant"
    assert inj.MIN_SCORE_THRESHOLD == 0.2


def test_fts_score_threshold_constant_exists():
    """FTS_SCORE_THRESHOLD must be defined in injector module."""
    import nidavellir.memory.injector as inj
    assert hasattr(inj, "FTS_SCORE_THRESHOLD"), "FTS_SCORE_THRESHOLD must be a module-level constant"
    assert inj.FTS_SCORE_THRESHOLD == -0.2
