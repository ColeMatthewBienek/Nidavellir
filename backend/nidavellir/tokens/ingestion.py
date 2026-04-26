from __future__ import annotations

import uuid
from datetime import datetime, UTC

from .adapters import ProviderUsageResult
from .store import TokenUsageStore

SUSPECT_DISCREPANCY_THRESHOLD = 50.0  # percent


def compute_discrepancy(preflight: int | None, reported: int | None) -> float | None:
    if preflight is None or reported is None or preflight == 0:
        return None
    return abs(reported - preflight) / preflight * 100.0


def ingest_preflight(
    store: TokenUsageStore,
    request_id: str,
    session_id: str,
    provider: str,
    model: str,
    preflight_tokens: int | None,
    preflight_source: str,
) -> None:
    """Create an initial usage record before the provider call."""
    now = datetime.now(UTC).isoformat()
    store.insert({
        "id":                     str(uuid.uuid4()),
        "request_id":             request_id,
        "session_id":             session_id,
        "provider":               provider,
        "model":                  model,
        "preflight_input_tokens": preflight_tokens,
        "preflight_source":       preflight_source,
        "suspect":                False,
        "anomaly":                False,
        "created_at":             now,
        "updated_at":             now,
    })


def ingest_provider_response(
    store: TokenUsageStore,
    request_id: str,
    usage: ProviderUsageResult,
    finish_reason: str | None = None,
    stop_reason: str | None = None,
) -> None:
    """Update existing record with provider-reported usage after the call."""
    # Fetch existing record to compute discrepancy
    with store._conn() as conn:
        row = conn.execute(
            "SELECT id, preflight_input_tokens FROM token_usage_records WHERE request_id = ?",
            (request_id,),
        ).fetchone()

    if row is None:
        # No preflight record — insert fresh
        now = datetime.now(UTC).isoformat()
        store.insert({
            "id":                     str(uuid.uuid4()),
            "request_id":             request_id,
            "session_id":             "unknown",
            "provider":               "unknown",
            "model":                  usage.model or "unknown",
            "reported_input_tokens":  usage.input_tokens,
            "reported_output_tokens": usage.output_tokens,
            "reported_total_tokens":  _total(usage),
            "suspect":                False,
            "anomaly":                False,
            "created_at":             now,
            "updated_at":             now,
        })
        return

    preflight = row["preflight_input_tokens"]
    discrepancy = compute_discrepancy(preflight, usage.input_tokens)
    suspect = (
        discrepancy is not None and discrepancy > SUSPECT_DISCREPANCY_THRESHOLD
    )

    store.update_by_request_id(request_id, {
        "reported_input_tokens":  usage.input_tokens,
        "reported_output_tokens": usage.output_tokens,
        "reported_total_tokens":  _total(usage),
        "cache_creation_input_tokens": usage.cache_creation_input_tokens,
        "cache_read_input_tokens":     usage.cache_read_input_tokens,
        "reasoning_tokens":            usage.reasoning_tokens,
        "discrepancy_pct":             discrepancy,
        "suspect":                     suspect,
        "finish_reason":               finish_reason,
        "stop_reason":                 stop_reason,
    })


def _total(usage: ProviderUsageResult) -> int | None:
    i = usage.input_tokens or 0
    o = usage.output_tokens or 0
    if usage.input_tokens is None and usage.output_tokens is None:
        return None
    return i + o
