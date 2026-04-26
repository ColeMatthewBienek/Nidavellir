"""Tests for anomaly detection."""
from __future__ import annotations

import uuid
import pytest

from nidavellir.tokens.store import TokenUsageStore
from nidavellir.tokens.anomaly import detect_anomalies, AnomalyType


def _store(tmp_path):
    return TokenUsageStore(str(tmp_path / "tokens.db"))


def _insert(store, session_id="s1", input_t=1000, output_t=300, preflight=None, suspect=False):
    req_id = str(uuid.uuid4())
    store.insert({
        "id":                         str(uuid.uuid4()),
        "request_id":                 req_id,
        "session_id":                 session_id,
        "provider":                   "anthropic",
        "model":                      "claude-sonnet-4-6",
        "preflight_input_tokens":     preflight,
        "preflight_source":           "local_estimate" if preflight else None,
        "reported_input_tokens":      input_t,
        "reported_output_tokens":     output_t,
        "reported_total_tokens":      input_t + output_t if (input_t and output_t) else None,
        "cached_input_tokens":        None,
        "cache_creation_input_tokens": None,
        "cache_read_input_tokens":    None,
        "reasoning_tokens":           None,
        "discrepancy_pct":            None,
        "suspect":                    suspect,
        "stop_reason":                None,
        "finish_reason":              "end_turn",
        "incomplete_reason":          None,
        "anomaly":                    False,
        "anomaly_types":              None,
    })
    return req_id


def test_spike_anomaly_detected(tmp_path):
    store = _store(tmp_path)
    # Baseline: 1000 tokens each
    for _ in range(5):
        _insert(store, input_t=1000)
    # Spike: 4000+ tokens (>3x baseline)
    spike_req = _insert(store, input_t=5000)

    # Fetch and analyse the spike record
    rows = store.get_by_session("s1")
    spike = next(r for r in rows if r["reported_input_tokens"] == 5000)

    anomalies = detect_anomalies(spike, baseline_avg_input=1000)
    types = [a["type"] for a in anomalies]
    assert AnomalyType.INPUT_SPIKE in types


def test_no_spike_for_normal_usage(tmp_path):
    store = _store(tmp_path)
    _insert(store, input_t=1000)
    rows = store.get_by_session("s1")
    anomalies = detect_anomalies(rows[0], baseline_avg_input=1000)
    types = [a["type"] for a in anomalies]
    assert AnomalyType.INPUT_SPIKE not in types


def test_high_discrepancy_anomaly_detected(tmp_path):
    store = _store(tmp_path)
    _insert(store, input_t=2000, preflight=500)  # 300% discrepancy
    rows = store.get_by_session("s1")
    # Mark discrepancy manually
    row = rows[0]
    row["discrepancy_pct"] = 300.0
    row["suspect"] = True

    anomalies = detect_anomalies(row, baseline_avg_input=500)
    types = [a["type"] for a in anomalies]
    assert AnomalyType.HIGH_DISCREPANCY in types


def test_large_output_anomaly_detected(tmp_path):
    store = _store(tmp_path)
    _insert(store, output_t=8000)
    rows = store.get_by_session("s1")
    row = rows[0]
    # Baseline output is ~300 tokens
    anomalies = detect_anomalies(row, baseline_avg_output=300)
    types = [a["type"] for a in anomalies]
    assert AnomalyType.OUTPUT_SPIKE in types


def test_anomaly_record_has_required_fields(tmp_path):
    store = _store(tmp_path)
    _insert(store, input_t=10000)
    rows = store.get_by_session("s1")
    anomalies = detect_anomalies(rows[0], baseline_avg_input=100)
    if anomalies:
        a = anomalies[0]
        for field in ("type", "severity", "description"):
            assert field in a
