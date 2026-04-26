"""
Tests for SPEC token-usage — Provider Adapter Layer.
Uses mandatory fixtures BEFORE adapter implementation.
"""
from __future__ import annotations

import pytest

from tests.fixtures.provider_fixtures import (
    CLAUDE_STANDARD,
    CLAUDE_WITH_CACHE_CREATION,
    CLAUDE_WITH_CACHE_READ,
    CLAUDE_MISSING_USAGE,
    CLAUDE_MALFORMED,
    CODEX_STANDARD_TOKENS,
    CODEX_WITH_FORMATTED_NUMBERS,
    CODEX_MISSING_TOKENS,
    CODEX_MALFORMED_LINES,
    OLLAMA_STANDARD,
    OLLAMA_MISSING_COUNTS,
    OLLAMA_MALFORMED,
    GENERIC_TIMEOUT,
    GENERIC_RATE_LIMIT,
)
from nidavellir.tokens.adapters import (
    parse_claude_jsonl_entry,
    parse_codex_token_lines,
    parse_ollama_done,
    classify_provider_error,
    ProviderUsageResult,
)


# ══════════════════════════════════════════════════════════════════════════════
# Anthropic / Claude JSONL
# ══════════════════════════════════════════════════════════════════════════════

def test_claude_standard_usage_parsed():
    result = parse_claude_jsonl_entry(CLAUDE_STANDARD)
    assert isinstance(result, ProviderUsageResult)
    assert result.input_tokens == 1240
    assert result.output_tokens == 312
    assert result.cache_creation_input_tokens == 0
    assert result.cache_read_input_tokens == 0
    assert result.model == "claude-sonnet-4-6"
    assert result.accurate is True


def test_claude_cache_creation_parsed():
    result = parse_claude_jsonl_entry(CLAUDE_WITH_CACHE_CREATION)
    assert result.cache_creation_input_tokens == 9425
    assert result.cache_read_input_tokens == 0
    assert result.input_tokens == 3
    assert result.output_tokens == 131


def test_claude_cache_read_parsed():
    result = parse_claude_jsonl_entry(CLAUDE_WITH_CACHE_READ)
    assert result.cache_read_input_tokens == 11661
    assert result.cache_creation_input_tokens == 0


def test_claude_missing_usage_handled_gracefully():
    result = parse_claude_jsonl_entry(CLAUDE_MISSING_USAGE)
    assert result is not None
    assert result.input_tokens is None
    assert result.output_tokens is None
    assert result.accurate is False


def test_claude_malformed_jsonl_handled_gracefully():
    result = parse_claude_jsonl_entry(CLAUDE_MALFORMED)
    assert result is None


def test_claude_session_and_request_ids_extracted():
    result = parse_claude_jsonl_entry(CLAUDE_STANDARD)
    assert result.session_id == "sess-standard-001"
    assert result.request_id == "req-standard-001"


# ══════════════════════════════════════════════════════════════════════════════
# OpenAI / Codex stdout
# ══════════════════════════════════════════════════════════════════════════════

def test_codex_standard_tokens_parsed():
    result = parse_codex_token_lines(
        CODEX_STANDARD_TOKENS["input_tokens"],
        CODEX_STANDARD_TOKENS["output_tokens"],
    )
    assert isinstance(result, ProviderUsageResult)
    assert result.input_tokens == 1240
    assert result.output_tokens == 312
    assert result.accurate is True


def test_codex_comma_formatted_lines_parsed():
    raw = CODEX_WITH_FORMATTED_NUMBERS["raw_lines"]
    input_t = int(raw[0].replace(",", ""))
    output_t = int(raw[1].replace(",", ""))
    result = parse_codex_token_lines(input_t, output_t)
    assert result.input_tokens == 1240
    assert result.output_tokens == 312


def test_codex_missing_tokens_returns_none():
    result = parse_codex_token_lines(None, None)
    assert result is not None
    assert result.input_tokens is None
    assert result.accurate is False


def test_codex_malformed_lines_handled():
    result = parse_codex_token_lines(None, None)
    assert result.accurate is False


# ══════════════════════════════════════════════════════════════════════════════
# Ollama HTTP done=true
# ══════════════════════════════════════════════════════════════════════════════

def test_ollama_standard_done_parsed():
    result = parse_ollama_done(OLLAMA_STANDARD)
    assert isinstance(result, ProviderUsageResult)
    assert result.input_tokens == 156    # prompt_eval_count
    assert result.output_tokens == 243   # eval_count
    assert result.model == "qwen3.6:27b"
    assert result.accurate is True


def test_ollama_missing_counts_handled():
    result = parse_ollama_done(OLLAMA_MISSING_COUNTS)
    assert result is not None
    assert result.input_tokens is None
    assert result.output_tokens is None
    assert result.accurate is False


def test_ollama_malformed_handled():
    result = parse_ollama_done(OLLAMA_MALFORMED)
    assert result is not None
    assert result.accurate is False


# ══════════════════════════════════════════════════════════════════════════════
# Generic failure classification
# ══════════════════════════════════════════════════════════════════════════════

def test_timeout_classified():
    result = classify_provider_error(GENERIC_TIMEOUT)
    assert result["type"] == "timeout"


def test_rate_limit_classified():
    result = classify_provider_error(GENERIC_RATE_LIMIT)
    assert result["type"] == "rate_limit"
    assert result.get("retry_after") == 30


def test_unknown_error_classified():
    result = classify_provider_error({"unexpected": "shape"})
    assert result["type"] == "unknown"
