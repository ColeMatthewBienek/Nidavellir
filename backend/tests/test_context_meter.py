"""Tests for context pressure meter."""
from __future__ import annotations

import pytest

from nidavellir.tokens.context_meter import (
    compute_context_pressure,
    get_model_limits,
    ContextPressure,
)


def test_get_model_limits_known_model():
    limits = get_model_limits("claude-sonnet-4-6", "anthropic")
    assert limits["context_limit"] > 0
    assert limits["reserved_output_tokens"] > 0
    assert limits["usable_tokens"] == limits["context_limit"] - limits["reserved_output_tokens"]


def test_get_model_limits_unknown_falls_back():
    limits = get_model_limits("unknown-model-xyz", "unknown")
    assert limits["context_limit"] > 0


def test_usable_tokens_formula():
    limits = get_model_limits("claude-sonnet-4-6", "anthropic")
    assert limits["usable_tokens"] == limits["context_limit"] - limits["reserved_output_tokens"]


def test_percent_calculated_correctly():
    result = compute_context_pressure(current_tokens=9600, model="claude-sonnet-4-6", provider="anthropic")
    limits = get_model_limits("claude-sonnet-4-6", "anthropic")
    expected_pct = round((9600 / limits["usable_tokens"]) * 100, 2)
    assert result.percent_used == pytest.approx(expected_pct, abs=0.1)


def test_state_ok_below_65_pct():
    result = compute_context_pressure(current_tokens=100, model="claude-sonnet-4-6", provider="anthropic")
    assert result.state == "ok"


def test_state_warn_at_65_pct():
    limits = get_model_limits("claude-sonnet-4-6", "anthropic")
    tokens = int(limits["usable_tokens"] * 0.67)
    result = compute_context_pressure(current_tokens=tokens, model="claude-sonnet-4-6", provider="anthropic")
    assert result.state == "warn"


def test_state_prepare_at_75_pct():
    limits = get_model_limits("claude-sonnet-4-6", "anthropic")
    tokens = int(limits["usable_tokens"] * 0.78)
    result = compute_context_pressure(current_tokens=tokens, model="claude-sonnet-4-6", provider="anthropic")
    assert result.state == "prepare"


def test_state_force_at_85_pct():
    limits = get_model_limits("claude-sonnet-4-6", "anthropic")
    tokens = int(limits["usable_tokens"] * 0.87)
    result = compute_context_pressure(current_tokens=tokens, model="claude-sonnet-4-6", provider="anthropic")
    assert result.state == "force"


def test_state_blocked_at_95_pct():
    limits = get_model_limits("claude-sonnet-4-6", "anthropic")
    tokens = int(limits["usable_tokens"] * 0.97)
    result = compute_context_pressure(current_tokens=tokens, model="claude-sonnet-4-6", provider="anthropic")
    assert result.state == "blocked"


def test_different_model_same_tokens_different_pct():
    tokens = 50_000
    a = compute_context_pressure(tokens, "claude-sonnet-4-6", "anthropic")
    b = compute_context_pressure(tokens, "gpt-5.4", "codex")
    # Codex has smaller context → higher percentage for same token count
    assert b.percent_used != a.percent_used


def test_result_has_required_fields():
    result = compute_context_pressure(5000, "claude-sonnet-4-6", "anthropic")
    assert isinstance(result, ContextPressure)
    for field in ("model", "provider", "current_tokens", "usable_tokens",
                  "context_limit", "reserved_output_tokens", "percent_used", "state"):
        assert hasattr(result, field), f"ContextPressure missing field: {field}"


def test_does_not_use_negative_tokens():
    result = compute_context_pressure(0, "claude-sonnet-4-6", "anthropic")
    assert result.percent_used == 0.0
    assert result.state == "ok"
