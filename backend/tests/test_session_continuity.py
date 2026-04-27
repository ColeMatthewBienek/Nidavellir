"""Tests for session continuity — SPEC: session-continuity-revised-strict.md

TDD sequence:
  RED  → all tests fail before any implementation
  GREEN → minimal implementation makes them pass

Tests cover:
  1. DB migration adds continuity columns without destroying existing data
  2. switch_session() creates child session with correct parent_id
  3. Old session is frozen after switch
  4. Snapshot captures message content
  5. Continue mode injects seed into child session
  6. Seed expires after 8 turns
  7. Clean mode produces no seed
  8. New session has zero context tokens (no carryover)
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from nidavellir.memory.store import MemoryStore


def _store(tmp_path: Path) -> MemoryStore:
    return MemoryStore(str(tmp_path / "mem.db"))


def _conv(store: MemoryStore, *, messages: int = 0) -> str:
    cid = str(uuid.uuid4())
    store.create_conversation(cid, workflow="chat", model_id="claude-sonnet-4-6", provider_id="claude")
    for i in range(messages):
        role = "user" if i % 2 == 0 else "agent"
        store.append_message(cid, str(uuid.uuid4()), role, f"Message {i}")
    return cid


# ── Test 1: migration adds continuity columns safely ──────────────────────────

def test_migration_adds_continuity_columns(tmp_path):
    """MemoryStore must add parent_id, status, continuity_mode to conversations."""
    store = _store(tmp_path)
    import sqlite3
    conn = sqlite3.connect(str(tmp_path / "mem.db"))
    cols = {row[1] for row in conn.execute("PRAGMA table_info(conversations)").fetchall()}
    conn.close()
    assert "parent_id" in cols, "conversations must have parent_id column"
    assert "status" in cols, "conversations must have status column"
    assert "continuity_mode" in cols, "conversations must have continuity_mode column"


def test_migration_preserves_existing_conversation(tmp_path):
    """Migration must not drop or corrupt existing conversation rows."""
    store = _store(tmp_path)
    cid = _conv(store, messages=2)
    # Re-open store (triggers migration path)
    store2 = MemoryStore(str(tmp_path / "mem.db"))
    msgs = store2.get_conversation_messages(cid)
    assert len(msgs) == 2


# ── Test 2: switch_session creates child with parent_id ──────────────────────

def test_switch_session_creates_child_session(tmp_path):
    """switch_session must create a new conversation with parent_id = old id."""
    from nidavellir.sessions.continuity import switch_session

    store = _store(tmp_path)
    old_id = _conv(store, messages=4)

    new_id = switch_session(store, old_id, new_provider="codex", new_model="gpt-5.4", mode="clean")

    assert new_id != old_id
    conv = store.get_conversation(new_id)
    assert conv["parent_id"] == old_id


def test_switch_session_returns_new_conversation_id(tmp_path):
    """switch_session must return a valid non-empty string."""
    from nidavellir.sessions.continuity import switch_session

    store = _store(tmp_path)
    old_id = _conv(store, messages=2)
    new_id = switch_session(store, old_id, new_provider="claude", new_model="claude-opus-4", mode="clean")
    assert isinstance(new_id, str) and len(new_id) > 0


# ── Test 3: old session is frozen after switch ────────────────────────────────

def test_old_session_frozen_after_switch(tmp_path):
    """switch_session must set old conversation status to 'frozen'."""
    from nidavellir.sessions.continuity import switch_session

    store = _store(tmp_path)
    old_id = _conv(store, messages=3)

    switch_session(store, old_id, new_provider="codex", new_model="gpt-5.4", mode="clean")

    old_conv = store.get_conversation(old_id)
    assert old_conv["status"] == "frozen"


# ── Test 4: snapshot captures message content ─────────────────────────────────

def test_snapshot_captures_message_count(tmp_path):
    """create_snapshot must record the number of messages in the conversation."""
    from nidavellir.sessions.snapshot import create_snapshot

    store = _store(tmp_path)
    cid = _conv(store, messages=6)

    snap = create_snapshot(store, cid)

    assert snap["message_count"] == 6
    assert snap["conversation_id"] == cid


def test_snapshot_contains_text_summary(tmp_path):
    """create_snapshot must produce a non-empty text summary."""
    from nidavellir.sessions.snapshot import create_snapshot

    store = _store(tmp_path)
    cid = str(uuid.uuid4())
    store.create_conversation(cid)
    store.append_message(cid, str(uuid.uuid4()), "user", "Explain JWT authentication.")
    store.append_message(cid, str(uuid.uuid4()), "agent", "JWT tokens are stateless credentials.")

    snap = create_snapshot(store, cid)

    assert isinstance(snap["summary"], str) and len(snap["summary"]) > 0


# ── Test 5: Continue mode injects seed ───────────────────────────────────────

def test_continue_mode_stores_seed_on_child(tmp_path):
    """switch_session with mode='continue' must store seed text on the child session."""
    from nidavellir.sessions.continuity import switch_session

    store = _store(tmp_path)
    old_id = str(uuid.uuid4())
    store.create_conversation(old_id)
    store.append_message(old_id, str(uuid.uuid4()), "user", "Tell me about async Python.")
    store.append_message(old_id, str(uuid.uuid4()), "agent", "asyncio provides cooperative multitasking.")

    new_id = switch_session(store, old_id, new_provider="codex", new_model="gpt-5.4", mode="continue")

    child = store.get_conversation(new_id)
    assert child.get("seed_text") is not None and len(child["seed_text"]) > 0


def test_clean_mode_has_no_seed(tmp_path):
    """switch_session with mode='clean' must store no seed on child session."""
    from nidavellir.sessions.continuity import switch_session

    store = _store(tmp_path)
    old_id = _conv(store, messages=4)

    new_id = switch_session(store, old_id, new_provider="codex", new_model="gpt-5.4", mode="clean")

    child = store.get_conversation(new_id)
    assert not child.get("seed_text")


# ── Test 6: seed expires after 8 turns ───────────────────────────────────────

def test_should_inject_seed_true_before_8_turns():
    """should_inject_seed must return True for turn_number 0–7."""
    from nidavellir.sessions.handoff import should_inject_seed

    for turn in range(8):
        assert should_inject_seed(turn), f"must inject at turn {turn}"


def test_should_inject_seed_false_at_turn_8():
    """should_inject_seed must return False at turn 8 and beyond."""
    from nidavellir.sessions.handoff import should_inject_seed

    assert not should_inject_seed(8)
    assert not should_inject_seed(9)
    assert not should_inject_seed(100)


def test_seed_text_built_from_snapshot():
    """build_seed must produce non-empty text from a snapshot dict."""
    from nidavellir.sessions.handoff import build_seed

    snap = {
        "conversation_id": "abc",
        "message_count": 4,
        "summary": "User discussed async Python and JWT auth.",
    }
    seed = build_seed(snap)
    assert isinstance(seed, str) and len(seed) > 0
    assert "async Python" in seed or "JWT" in seed or "prior session" in seed.lower()


# ── Test 7: no token carryover on session switch ──────────────────────────────

def test_new_session_starts_with_zero_context(tmp_path):
    """Child session must have zero context tokens (payload is empty initially)."""
    from nidavellir.sessions.continuity import switch_session
    from nidavellir.tokens.context_meter import estimate_payload_tokens

    store = _store(tmp_path)
    old_id = _conv(store, messages=10)  # old session with many messages
    new_id = switch_session(store, old_id, new_provider="claude", new_model="claude-sonnet-4-6", mode="clean")

    new_msgs = store.get_conversation_messages(new_id)
    tokens = estimate_payload_tokens(new_msgs)
    assert tokens == 0, f"new session must start with 0 context tokens, got {tokens}"


# ── Test 8: get_conversation returns dict with all columns ────────────────────

def test_get_conversation_returns_full_row(tmp_path):
    """get_conversation must return a dict with id, status, parent_id, continuity_mode."""
    store = _store(tmp_path)
    cid = _conv(store)
    conv = store.get_conversation(cid)
    assert conv["id"] == cid
    assert "status" in conv
    assert "parent_id" in conv
    assert "continuity_mode" in conv
