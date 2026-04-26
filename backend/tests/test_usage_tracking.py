"""
Tests for SPEC-12E+: usage tracking correctness and deterministic selection.

Verifies:
- mark_memories_used() increments use_count exactly once per call
- last_used is populated after marking
- select_memories() is pure (no side effects on its own)
- get_context_prefix() marks memories as used after selection
- "Never Used" count decreases after a session
- Deterministic selection: higher importance wins
- Vector results do not override a strong FTS match (guardrail test)
"""
from __future__ import annotations

import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.injector import select_memories, get_context_prefix


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mem(id: str, content: str, *, confidence=0.9, importance=5,
         workflow="chat", category="project") -> dict:
    return {
        "id": id, "content": content, "category": category,
        "memory_type": "fact", "workflow": workflow,
        "scope_type": "workflow", "scope_id": workflow,
        "tags": "", "confidence": confidence, "importance": importance,
        "source": "manual",
    }


# ══════════════════════════════════════════════════════════════════════════════
# 1. mark_memories_used() correctness
# ══════════════════════════════════════════════════════════════════════════════

def test_mark_memories_used_increments_use_count(tmp_path):
    """use_count must go from 0 → 1 after a single mark call."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Some memory")])

    before = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert before["use_count"] == 0

    store.mark_memories_used(["m1"])

    after = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert after["use_count"] == 1


def test_mark_memories_used_populates_last_used(tmp_path):
    """last_used must be non-null after marking."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Some memory")])

    before = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert before["last_used"] is None

    store.mark_memories_used(["m1"])

    after = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert after["last_used"] is not None


def test_mark_memories_used_increments_multiple(tmp_path):
    """Multiple IDs must each be incremented exactly once per call."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("a", "A"), _mem("b", "B")])

    store.mark_memories_used(["a", "b"])

    mems = {m["id"]: m for m in store.get_active_memories("chat")}
    assert mems["a"]["use_count"] == 1
    assert mems["b"]["use_count"] == 1


def test_mark_memories_used_deduplicates_ids(tmp_path):
    """Passing the same ID twice must increment use_count by 1, not 2."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Dedup test")])

    store.mark_memories_used(["m1", "m1"])

    after = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert after["use_count"] == 1


def test_mark_memories_used_empty_list_is_noop(tmp_path):
    """Empty list must not raise or modify anything."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Safe")])

    store.mark_memories_used([])  # must not raise

    m = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert m["use_count"] == 0


# ══════════════════════════════════════════════════════════════════════════════
# 2. select_memories() — pure function, no side effects
# ══════════════════════════════════════════════════════════════════════════════

def test_select_memories_returns_list(tmp_path):
    """select_memories() must return a list."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend", confidence=0.9)])

    result = select_memories(store, query="FastAPI", workflow="chat", is_new_session=True)

    assert isinstance(result, list)


def test_select_memories_no_side_effects_on_use_count(tmp_path):
    """Calling select_memories() must NOT increment use_count."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend", confidence=0.9)])

    select_memories(store, query="FastAPI", workflow="chat", is_new_session=True)

    m = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert m["use_count"] == 0, "select_memories must not update use_count"


def test_select_memories_no_side_effects_on_events(tmp_path):
    """Calling select_memories() must NOT write any memory events."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Some content", confidence=0.9)])

    events_before = store.get_events()
    select_memories(store, query="some content", workflow="chat", is_new_session=True)
    events_after = store.get_events()

    assert len(events_after) == len(events_before), \
        "select_memories must not write any events"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Deterministic selection (from SPEC-12E+)
# ══════════════════════════════════════════════════════════════════════════════

def test_deterministic_selection(tmp_path):
    """High importance memory selected; low importance excluded on new session."""
    store = MemoryStore(str(tmp_path / "mem.db"))

    id1 = store.save_memory({
        "content": "User prefers concise responses",
        "confidence": 0.9,
        "importance": 8,
        "memory_type": "preference",
        "workflow": "chat",
    })

    id2 = store.save_memory({
        "content": "User likes long explanations",
        "confidence": 0.9,
        "importance": 2,
        "memory_type": "preference",
        "workflow": "chat",
    })

    selected = select_memories(
        store=store,
        query="Explain REST APIs",
        workflow="chat",
        is_new_session=True,
    )

    ids = [m["id"] for m in selected]

    assert id1 in ids,   "high-importance memory must be selected"
    assert id2 not in ids, "low-importance memory must be excluded on new session"


# ══════════════════════════════════════════════════════════════════════════════
# 4. get_context_prefix() marks memories used after selection
# ══════════════════════════════════════════════════════════════════════════════

def test_get_context_prefix_marks_memories_used(tmp_path):
    """After get_context_prefix(), selected memories must have use_count > 0."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend framework", confidence=0.9, importance=7)])

    get_context_prefix(store, query="FastAPI backend", workflow="chat")

    m = next(m for m in store.get_active_memories("chat") if m["id"] == "m1")
    assert m["use_count"] > 0, "use_count must increment after injection"
    assert m["last_used"] is not None, "last_used must be set after injection"


def test_never_used_decreases_after_session(tmp_path):
    """quality_summary never_used count must drop after a get_context_prefix call."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend framework", confidence=0.9, importance=7)])

    before = store.quality_summary("chat")
    assert before["never_used"] == 1

    get_context_prefix(store, query="FastAPI backend", workflow="chat")

    after = store.quality_summary("chat")
    assert after["never_used"] == 0, "never_used must decrease after memory is injected"


def test_top_injected_shows_after_session(tmp_path):
    """quality_frequent must return the memory after injection."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI backend framework", confidence=0.9, importance=7)])

    get_context_prefix(store, query="FastAPI backend", workflow="chat")

    frequent = store.quality_frequent("chat")
    ids = {m["id"] for m in frequent}
    assert "m1" in ids, "injected memory must appear in quality_frequent"


# ══════════════════════════════════════════════════════════════════════════════
# 5. Vector guardrail (future-proof test, SPEC-12E+ §5)
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_results_do_not_override_strong_fts(tmp_path, monkeypatch):
    """When FTS has a strong match, vector candidates must not appear in selection."""
    store = MemoryStore(str(tmp_path / "mem.db"))

    # FTS-matchable memory (high importance, will match query)
    store.save_memories([_mem("fts_mem", "FastAPI backend framework usage", confidence=0.9, importance=8)])
    # Irrelevant memory (would only come from a vector search)
    store.save_memories([_mem("vec_mem", "Unrelated quantum physics notes", confidence=0.9, importance=9)])

    # Force FTS to return a qualifying result (score <= FTS_SCORE_THRESHOLD)
    original_search = store.search_fts

    def patched_fts(query, workflow, limit=10):
        results = original_search(query, workflow, limit)
        for r in results:
            r["relevance_score"] = -0.8  # strong FTS match
        return results

    monkeypatch.setattr(store, "search_fts", patched_fts)

    selected = select_memories(store, query="FastAPI backend", workflow="chat", is_new_session=True)
    ids = {m["id"] for m in selected}

    assert "fts_mem" in ids,   "strong FTS match must be selected"
    assert "vec_mem" not in ids, "vector-only candidate must not appear when FTS is strong"
