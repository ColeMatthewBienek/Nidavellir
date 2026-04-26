"""Tests for token ingestion service."""
from __future__ import annotations

import uuid

import pytest

from nidavellir.tokens.store import TokenUsageStore
from nidavellir.tokens.adapters import ProviderUsageResult
from nidavellir.tokens.ingestion import (
    ingest_preflight,
    ingest_provider_response,
    compute_discrepancy,
    SUSPECT_DISCREPANCY_THRESHOLD,
)


def _store(tmp_path):
    return TokenUsageStore(str(tmp_path / "tokens.db"))


def _usage(input_t=1000, output_t=300, **kw) -> ProviderUsageResult:
    return ProviderUsageResult(
        input_tokens=input_t,
        output_tokens=output_t,
        accurate=True,
        **kw,
    )


# ══════════════════════════════════════════════════════════════════════════════
# Pre-call preflight
# ══════════════════════════════════════════════════════════════════════════════

def test_preflight_count_stored(tmp_path):
    store = _store(tmp_path)
    request_id = str(uuid.uuid4())
    ingest_preflight(
        store=store,
        request_id=request_id,
        session_id="s1",
        provider="anthropic",
        model="claude-sonnet-4-6",
        preflight_tokens=1200,
        preflight_source="local_estimate",
    )
    rows = store.get_by_session("s1")
    assert len(rows) == 1
    assert rows[0]["preflight_input_tokens"] == 1200
    assert rows[0]["preflight_source"] == "local_estimate"


def test_preflight_source_unavailable(tmp_path):
    store = _store(tmp_path)
    ingest_preflight(
        store=store,
        request_id=str(uuid.uuid4()),
        session_id="s1",
        provider="anthropic",
        model="claude-sonnet-4-6",
        preflight_tokens=None,
        preflight_source="unavailable",
    )
    rows = store.get_by_session("s1")
    assert rows[0]["preflight_source"] == "unavailable"


# ══════════════════════════════════════════════════════════════════════════════
# Post-call provider response
# ══════════════════════════════════════════════════════════════════════════════

def test_provider_usage_updates_record(tmp_path):
    store = _store(tmp_path)
    req_id = str(uuid.uuid4())
    ingest_preflight(store, req_id, "s1", "anthropic", "claude-sonnet-4-6", 1200, "local_estimate")

    ingest_provider_response(
        store=store,
        request_id=req_id,
        usage=_usage(input_t=1240, output_t=312),
    )
    rows = store.get_by_session("s1")
    assert rows[0]["reported_input_tokens"] == 1240
    assert rows[0]["reported_output_tokens"] == 312


def test_discrepancy_calculated_correctly():
    pct = compute_discrepancy(preflight=1200, reported=1240)
    expected = abs(1240 - 1200) / 1200 * 100
    assert pct == pytest.approx(expected, rel=0.01)


def test_suspect_flag_set_on_high_discrepancy(tmp_path):
    store = _store(tmp_path)
    req_id = str(uuid.uuid4())
    ingest_preflight(store, req_id, "s1", "anthropic", "claude-sonnet-4-6", 500, "local_estimate")

    ingest_provider_response(
        store=store,
        request_id=req_id,
        usage=_usage(input_t=1500, output_t=200),  # 200% discrepancy → suspect
    )
    rows = store.get_by_session("s1")
    assert rows[0]["suspect"] in (True, 1)


def test_stop_reason_stored(tmp_path):
    store = _store(tmp_path)
    req_id = str(uuid.uuid4())
    ingest_preflight(store, req_id, "s1", "anthropic", "claude-sonnet-4-6", 1000, "local_estimate")
    usage = _usage(input_t=1000, output_t=200)
    ingest_provider_response(store, req_id, usage, finish_reason="end_turn")
    rows = store.get_by_session("s1")
    assert rows[0]["finish_reason"] == "end_turn"


def test_ingestion_idempotent(tmp_path):
    store = _store(tmp_path)
    req_id = str(uuid.uuid4())
    ingest_preflight(store, req_id, "s1", "anthropic", "claude-sonnet-4-6", 1000, "local_estimate")
    ingest_provider_response(store, req_id, _usage())
    ingest_provider_response(store, req_id, _usage())  # duplicate
    rows = store.get_by_session("s1")
    assert len(rows) == 1


def test_missing_provider_usage_does_not_crash(tmp_path):
    store = _store(tmp_path)
    req_id = str(uuid.uuid4())
    ingest_preflight(store, req_id, "s1", "anthropic", "claude-sonnet-4-6", 1000, "local_estimate")
    usage = ProviderUsageResult(input_tokens=None, output_tokens=None, accurate=False)
    ingest_provider_response(store, req_id, usage)
    rows = store.get_by_session("s1")
    assert len(rows) == 1
    assert rows[0]["reported_input_tokens"] is None
