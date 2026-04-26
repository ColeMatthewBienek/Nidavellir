"""Tests for token usage SQLite store."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, UTC

import pytest

from nidavellir.tokens.store import TokenUsageStore


def _record(**overrides) -> dict:
    base = {
        "id":                         str(uuid.uuid4()),
        "request_id":                 str(uuid.uuid4()),
        "session_id":                 "sess-001",
        "provider":                   "anthropic",
        "model":                      "claude-sonnet-4-6",
        "preflight_input_tokens":     None,
        "preflight_source":           None,
        "reported_input_tokens":      1240,
        "reported_output_tokens":     312,
        "reported_total_tokens":      1552,
        "cached_input_tokens":        None,
        "cache_creation_input_tokens": None,
        "cache_read_input_tokens":    None,
        "reasoning_tokens":           None,
        "discrepancy_pct":            None,
        "suspect":                    False,
        "stop_reason":                None,
        "finish_reason":              "end_turn",
        "incomplete_reason":          None,
        "anomaly":                    False,
        "anomaly_types":              None,
    }
    base.update(overrides)
    return base


def test_migration_creates_table(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    conn = sqlite3.connect(str(tmp_path / "tokens.db"))
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "token_usage_records" in tables
    conn.close()


def test_indexes_exist(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    conn = sqlite3.connect(str(tmp_path / "tokens.db"))
    indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
    assert any("session" in i for i in indexes)
    assert any("provider" in i or "created" in i for i in indexes)
    conn.close()


def test_insert_and_retrieve(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    rec = _record()
    store.insert(rec)
    rows = store.get_by_session("sess-001")
    assert len(rows) == 1
    assert rows[0]["reported_input_tokens"] == 1240


def test_request_id_uniqueness(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    req_id = str(uuid.uuid4())
    store.insert(_record(request_id=req_id))
    store.insert(_record(request_id=req_id))  # duplicate — must not raise
    rows = store.get_by_session("sess-001")
    assert len(rows) == 1  # only one persisted


def test_duplicate_request_does_not_double_count(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    req_id = str(uuid.uuid4())
    store.insert(_record(request_id=req_id, reported_input_tokens=100))
    store.insert(_record(request_id=req_id, reported_input_tokens=999))
    rows = store.get_by_session("sess-001")
    assert rows[0]["reported_input_tokens"] == 100  # first wins


def test_missing_provider_usage_does_not_crash(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    rec = _record(reported_input_tokens=None, reported_output_tokens=None, reported_total_tokens=None)
    store.insert(rec)
    rows = store.get_by_session("sess-001")
    assert len(rows) == 1


def test_suspect_defaults_false(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    store.insert(_record())
    rows = store.get_by_session("sess-001")
    assert rows[0]["suspect"] == 0 or rows[0]["suspect"] is False


def test_get_by_provider_model(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    store.insert(_record(session_id="s1", provider="anthropic", model="claude-sonnet-4-6"))
    store.insert(_record(session_id="s2", provider="codex",     model="gpt-5.4"))
    rows = store.get_by_provider_model("codex", "gpt-5.4")
    assert len(rows) == 1
    assert rows[0]["provider"] == "codex"


def test_export_range_query(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    store.insert(_record(session_id="s1"))
    rows = store.export_range(hours=24, limit=100)
    assert len(rows) >= 1


def test_session_totals(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    store.insert(_record(session_id="s1", reported_input_tokens=500, reported_output_tokens=200))
    store.insert(_record(session_id="s1", reported_input_tokens=300, reported_output_tokens=150))
    store.insert(_record(session_id="s2", reported_input_tokens=999, reported_output_tokens=999))
    totals = store.session_totals("s1")
    assert totals["total_input"] == 800
    assert totals["total_output"] == 350


def test_update_record(tmp_path):
    store = TokenUsageStore(str(tmp_path / "tokens.db"))
    rec = _record()
    store.insert(rec)
    store.update(rec["id"], {"discrepancy_pct": 12.5, "suspect": True})
    rows = store.get_by_session("sess-001")
    assert rows[0]["discrepancy_pct"] == pytest.approx(12.5)
