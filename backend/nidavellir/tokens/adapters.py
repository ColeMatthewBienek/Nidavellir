from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass
class ProviderUsageResult:
    input_tokens:                 int | None = None
    output_tokens:                int | None = None
    cache_creation_input_tokens:  int | None = None
    cache_read_input_tokens:      int | None = None
    cached_input_tokens:          int | None = None
    reasoning_tokens:             int | None = None
    model:                        str | None = None
    session_id:                   str | None = None
    request_id:                   str | None = None
    stop_reason:                  str | None = None
    finish_reason:                str | None = None
    cost_usd:                     float | None = None
    accurate:                     bool = False


def parse_claude_jsonl_entry(entry: object) -> ProviderUsageResult | None:
    """Parse one entry from Claude's ~/.claude/projects/*/*.jsonl file.

    Returns None on total parse failure; returns a result with accurate=False
    when the usage block is missing.
    """
    if isinstance(entry, str):
        try:
            entry = json.loads(entry)
        except Exception:
            return None

    if not isinstance(entry, dict):
        return None

    msg   = entry.get("message", {}) or {}
    usage = msg.get("usage")

    result = ProviderUsageResult(
        model      = msg.get("model"),
        session_id = entry.get("sessionId"),
        request_id = entry.get("requestId"),
        cost_usd   = entry.get("costUSD"),
    )

    if not isinstance(usage, dict):
        result.accurate = False
        return result

    result.input_tokens                = usage.get("input_tokens")
    result.output_tokens               = usage.get("output_tokens")
    result.cache_creation_input_tokens = usage.get("cache_creation_input_tokens")
    result.cache_read_input_tokens     = usage.get("cache_read_input_tokens")
    result.accurate                    = (
        result.input_tokens is not None and result.output_tokens is not None
    )
    return result


def parse_codex_token_lines(
    input_tokens: int | None,
    output_tokens: int | None,
) -> ProviderUsageResult:
    """Build a ProviderUsageResult from captured Codex stdout token count lines."""
    accurate = input_tokens is not None and output_tokens is not None
    return ProviderUsageResult(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        accurate=accurate,
    )


def parse_ollama_done(done_payload: dict) -> ProviderUsageResult:
    """Parse Ollama's done=true JSON body from /api/generate."""
    if not isinstance(done_payload, dict):
        return ProviderUsageResult(accurate=False)

    input_t  = done_payload.get("prompt_eval_count")
    output_t = done_payload.get("eval_count")
    accurate = input_t is not None and output_t is not None

    return ProviderUsageResult(
        input_tokens=input_t,
        output_tokens=output_t,
        model=done_payload.get("model"),
        accurate=accurate,
    )


def classify_provider_error(error: object) -> dict:
    """Classify a provider error payload into a normalised dict."""
    if not isinstance(error, dict):
        return {"type": "unknown"}

    code = error.get("code", "") or error.get("error", "")
    if "timeout" in str(code).lower():
        return {"type": "timeout"}
    if "rate_limit" in str(code).lower():
        return {"type": "rate_limit", "retry_after": error.get("retry_after")}
    if "partial" in str(error).lower():
        return {"type": "partial_response"}
    return {"type": "unknown"}
