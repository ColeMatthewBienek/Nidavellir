import json
import sqlite3
from datetime import datetime, timedelta, UTC

import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.context_pack import compute_final_score


# ---------------------------
# Helpers
# ---------------------------

def iso_days_ago(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat()


# ===========================
# 1. SCHEMA + FTS
# ===========================

def test_schema_tables_exist(tmp_path):
    db_path = tmp_path / "memory.db"
    MemoryStore(str(db_path))

    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )
    tables = {row[0] for row in cur.fetchall()}

    assert "memories" in tables
    assert "conversations" in tables
    assert "conversation_messages" in tables
    assert "memory_events" in tables

    conn.close()


def test_fts_table_exists(tmp_path):
    db_path = tmp_path / "memory.db"
    MemoryStore(str(db_path))

    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )
    tables = {row[0] for row in cur.fetchall()}

    assert "memory_fts" in tables
    conn.close()


def test_triggers_exist(tmp_path):
    db_path = tmp_path / "memory.db"
    MemoryStore(str(db_path))

    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='trigger'"
    )
    triggers = {row[0] for row in cur.fetchall()}

    assert any("memories_ai" in t for t in triggers)
    assert any("memories_ad" in t for t in triggers)
    assert any("memories_au" in t for t in triggers)

    conn.close()


def test_event_subject_column_exists(tmp_path):
    db_path = tmp_path / "memory.db"
    MemoryStore(str(db_path))

    conn = sqlite3.connect(db_path)
    cur = conn.execute("PRAGMA table_info(memory_events)")
    cols = {row[1] for row in cur.fetchall()}

    assert "event_subject" in cols
    conn.close()


# ===========================
# 2. FTS STARTUP CHECK
# ===========================

def test_verify_fts5_passes(tmp_path):
    db_path = tmp_path / "memory.db"
    store = MemoryStore(str(db_path))

    # If init passed, FTS is available
    assert store is not None


def test_verify_fts5_raises_when_missing(tmp_path, monkeypatch):
    db_path = tmp_path / "memory.db"

    import nidavellir.memory.store as store_mod

    def broken_verify(conn):
        raise sqlite3.OperationalError("fts5 not available")

    monkeypatch.setattr(store_mod, "_verify_fts5", broken_verify)

    with pytest.raises((RuntimeError, sqlite3.OperationalError)):
        MemoryStore(str(db_path))


# ===========================
# 3. MEMORY SAVE + SEARCH
# ===========================

def test_save_memory_and_search(tmp_path):
    db_path = tmp_path / "memory.db"
    store = MemoryStore(str(db_path))

    store.save_memories([
        {
            "id": "m1",
            "content": "Nidavellir uses FastAPI.",
            "category": "project",
            "memory_type": "fact",
            "workflow": "chat",
            "scope_type": "workflow",
            "scope_id": "chat",
            "tags": "fastapi",
            "confidence": 0.9,
            "importance": 7,
            "source": "manual",
        }
    ])

    results = store.search_fts("FastAPI", "chat", 10)

    assert results
    assert any("FastAPI" in r["content"] for r in results)


def test_low_confidence_not_stored(tmp_path):
    db_path = tmp_path / "memory.db"
    store = MemoryStore(str(db_path))

    store.save_memories([
        {
            "id": "low",
            "content": "Ignore this",
            "category": "thought",
            "memory_type": "fact",
            "workflow": "chat",
            "scope_type": "workflow",
            "scope_id": "chat",
            "tags": "",
            "confidence": 0.3,
            "importance": 1,
            "source": "manual",
        }
    ])

    results = store.get_active_memories("chat", 10)
    assert all(r["id"] != "low" for r in results)

    events = store.get_events(event_type="dedup_rejected")
    assert events


def test_supersession(tmp_path):
    db_path = tmp_path / "memory.db"
    store = MemoryStore(str(db_path))

    store.save_memories([
        {
            "id": "old",
            "content": "Old fact",
            "category": "fact",
            "memory_type": "fact",
            "workflow": "chat",
            "scope_type": "workflow",
            "scope_id": "chat",
            "tags": "",
            "confidence": 0.9,
            "importance": 5,
            "source": "manual",
        }
    ])

    store.update_memory("old", {"superseded_by": "new"})

    results = store.get_active_memories("chat", 10)
    assert all(r["id"] != "old" for r in results)


# ===========================
# 4. SCORING
# ===========================

def test_newer_scores_higher():
    newer = compute_final_score(-1, 5, 0.5, "fact", iso_days_ago(1), 0)
    older = compute_final_score(-1, 5, 0.5, "fact", iso_days_ago(120), 0)
    assert newer > older


def test_importance_affects_score():
    low = compute_final_score(-1, 2, 0.5, "fact", iso_days_ago(1), 0)
    high = compute_final_score(-1, 9, 0.5, "fact", iso_days_ago(1), 0)
    assert high > low


def test_use_count_capped():
    base = compute_final_score(-1, 5, 0.5, "fact", iso_days_ago(1), 0)
    used = compute_final_score(-1, 5, 0.5, "fact", iso_days_ago(1), 20)
    over = compute_final_score(-1, 5, 0.5, "fact", iso_days_ago(1), 200)

    assert used > base
    assert over == used


def test_decay_by_type():
    task = compute_final_score(-1, 5, 0.5, "task", iso_days_ago(30), 0)
    rel = compute_final_score(-1, 5, 0.5, "relationship", iso_days_ago(30), 0)
    assert rel > task


# ===========================
# 5. FTS QUERY SAFETY
# ===========================

def test_bad_query_does_not_crash(tmp_path):
    db_path = tmp_path / "memory.db"
    store = MemoryStore(str(db_path))

    store.save_memories([
        {
            "id": "m",
            "content": "FastAPI backend",
            "category": "project",
            "memory_type": "fact",
            "workflow": "chat",
            "scope_type": "workflow",
            "scope_id": "chat",
            "tags": "",
            "confidence": 0.9,
            "importance": 5,
            "source": "manual",
        }
    ])

    results = store.search_fts('"bad OR', "chat", 10)
    assert isinstance(results, list)


# ===========================
# 6. DB CONNECTION
# ===========================

def test_multiple_store_instances(tmp_path):
    db_path = tmp_path / "memory.db"

    a = MemoryStore(str(db_path))
    b = MemoryStore(str(db_path))

    a.save_memories([{
        "id": "a",
        "content": "A",
        "category": "thought",
        "memory_type": "fact",
        "workflow": "chat",
        "scope_type": "workflow",
        "scope_id": "chat",
        "tags": "",
        "confidence": 0.9,
        "importance": 5,
        "source": "manual",
    }])

    b.save_memories([{
        "id": "b",
        "content": "B",
        "category": "thought",
        "memory_type": "fact",
        "workflow": "chat",
        "scope_type": "workflow",
        "scope_id": "chat",
        "tags": "",
        "confidence": 0.9,
        "importance": 5,
        "source": "manual",
    }])

    results = a.get_active_memories("chat", 10)
    ids = {r["id"] for r in results}

    assert "a" in ids and "b" in ids


# ===========================
# 7. ASYNC EXTRACTION SAFETY
# ===========================

@pytest.mark.asyncio
async def test_async_extraction_failure(tmp_path, monkeypatch):
    from nidavellir.routers import ws as ws_router

    db_path = tmp_path / "memory.db"
    store = MemoryStore(str(db_path))

    cid = "conv"
    store.create_conversation(cid)

    store.append_message(cid, "u", "user", "test")
    store.append_message(cid, "a", "agent", "response")

    async def explode(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(ws_router, "extract_memories", explode)

    await ws_router._extract_and_store(
        store=store,
        conversation_id=cid,
        workflow="chat",
        model_id="claude-haiku-4-5",
    )

    events = store.get_events(event_type="extraction_failed")
    assert isinstance(events, list)


@pytest.mark.asyncio
async def test_async_extraction_failure_logs_diagnostics(tmp_path, monkeypatch):
    from nidavellir.routers import ws as ws_router

    db_path = tmp_path / "memory.db"
    store = MemoryStore(str(db_path))

    cid = "conv"
    store.create_conversation(cid)
    store.append_message(cid, "u", "user", "remember the parser failure")
    store.append_message(cid, "a", "agent", "ok")

    async def explode(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(ws_router, "extract_memories", explode)

    await ws_router._extract_and_store(
        store=store,
        conversation_id=cid,
        workflow="chat",
        model_id="claude-haiku-4-5",
    )

    event = store.get_events(event_type="extraction_failed")[0]
    payload = json.loads(event["payload_json"])

    assert payload["error"] == "boom"
    assert payload["error_type"] == "RuntimeError"
    assert payload["conversation_id"] == cid
    assert payload["workflow"] == "chat"
    assert payload["model"] == "claude-haiku-4-5"
    assert payload["message_count"] == 2
    assert payload["transcript_chars"] > 0
    assert payload["stage"] == "store_extraction"
    assert "traceback" in payload


@pytest.mark.asyncio
async def test_async_extraction_parse_failure_is_warning_without_traceback(tmp_path, monkeypatch, caplog):
    from nidavellir.routers import ws as ws_router

    db_path = tmp_path / "memory.db"
    store = MemoryStore(str(db_path))

    cid = "conv"
    store.create_conversation(cid)
    store.append_message(cid, "u", "user", "remember the parser failure")
    store.append_message(cid, "a", "agent", "ok")

    async def invalid_json(*args, **kwargs):
        raise ws_router.MemoryExtractionError(
            "memory extraction returned invalid JSON",
            {"stage": "parse_extraction_output", "stdout_sample": "not json"},
        )

    monkeypatch.setattr(ws_router, "extract_memories", invalid_json)

    with caplog.at_level("WARNING"):
        await ws_router._extract_and_store(
            store=store,
            conversation_id=cid,
            workflow="chat",
            model_id="claude-haiku-4-5",
        )

    event = store.get_events(event_type="extraction_failed")[0]
    payload = json.loads(event["payload_json"])

    assert payload["error"] == "memory extraction returned invalid JSON"
    assert payload["stage"] == "parse_extraction_output"
    assert payload["stdout_sample"] == "not json"
    assert "traceback" not in payload
    assert any(record.levelname == "WARNING" and record.message == "memory_extraction_failed" for record in caplog.records)


@pytest.mark.asyncio
async def test_extract_memories_reports_subprocess_failure(monkeypatch):
    from nidavellir.routers import ws as ws_router

    class FakeProc:
        returncode = 2

        async def communicate(self, data):
            return b"not json", b"missing api key"

    async def fake_create_subprocess_exec(*args, **kwargs):
        return FakeProc()

    monkeypatch.setattr(ws_router.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    with pytest.raises(ws_router.MemoryExtractionError) as err:
        await ws_router.extract_memories("user: hi", "chat", "claude-haiku-4-5")

    assert err.value.payload["stage"] == "claude_subprocess"
    assert err.value.payload["returncode"] == 2
    assert err.value.payload["stderr_sample"] == "missing api key"
    assert err.value.payload["stdout_sample"] == "not json"
    assert err.value.payload["model"] == "claude-haiku-4-5"


def test_memory_extraction_output_normalizer_accepts_wrapped_json():
    from nidavellir.routers import ws as ws_router

    assert ws_router._normalize_memory_extraction_output("```json\n[]\n```") == "[]"
    assert ws_router._normalize_memory_extraction_output("Here are the memories:\n[]") == "[]"
