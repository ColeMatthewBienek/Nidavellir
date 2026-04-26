"""
Provider response fixtures for token adapter tests.
Each fixture represents a real response shape from the provider.
"""

# ── Anthropic / Claude JSONL fixtures ─────────────────────────────────────────
# Shape from ~/.claude/projects/<path>/<session>.jsonl

CLAUDE_STANDARD = {
    "sessionId":  "sess-standard-001",
    "requestId":  "req-standard-001",
    "timestamp":  "2026-04-26T10:00:00.000Z",
    "message": {
        "model": "claude-sonnet-4-6",
        "usage": {
            "input_tokens":                1240,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens":     0,
            "output_tokens":               312,
        },
    },
    "costUSD": 0.0034,
}

CLAUDE_WITH_CACHE_CREATION = {
    "sessionId":  "sess-cache-create",
    "requestId":  "req-cache-create",
    "timestamp":  "2026-04-26T10:01:00.000Z",
    "message": {
        "model": "claude-sonnet-4-6",
        "usage": {
            "input_tokens":                3,
            "cache_creation_input_tokens": 9425,
            "cache_read_input_tokens":     0,
            "output_tokens":               131,
        },
    },
    "costUSD": None,
}

CLAUDE_WITH_CACHE_READ = {
    "sessionId":  "sess-cache-read",
    "requestId":  "req-cache-read",
    "timestamp":  "2026-04-26T10:02:00.000Z",
    "message": {
        "model": "claude-sonnet-4-6",
        "usage": {
            "input_tokens":                3,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens":     11661,
            "output_tokens":               248,
        },
    },
    "costUSD": None,
}

CLAUDE_MISSING_USAGE = {
    "sessionId":  "sess-no-usage",
    "requestId":  "req-no-usage",
    "timestamp":  "2026-04-26T10:03:00.000Z",
    "message": {
        "model": "claude-sonnet-4-6",
        # no "usage" key
    },
}

CLAUDE_MALFORMED = "{ this is not valid json :"


# ── OpenAI / Codex stdout fixtures ────────────────────────────────────────────
# Codex stdout after "tokens used":  input_count\noutput_count

CODEX_STANDARD_TOKENS = {
    "input_tokens":  1240,
    "output_tokens": 312,
}

CODEX_WITH_FORMATTED_NUMBERS = {
    "raw_lines": ["1,240", "312"],   # Codex may print commas
    "input_tokens":  1240,
    "output_tokens": 312,
}

CODEX_MISSING_TOKENS = None          # subprocess exited before footer

CODEX_MALFORMED_LINES = {
    "raw_lines": ["not-a-number", "also-not"],
}


# ── Ollama HTTP done=true fixtures ────────────────────────────────────────────
# Final JSON blob from /api/generate when done=true

OLLAMA_STANDARD = {
    "model":                "qwen3.6:27b",
    "done":                 True,
    "done_reason":          "stop",
    "prompt_eval_count":    156,
    "eval_count":           243,
    "total_duration":       4_935_000_000,
    "prompt_eval_duration": 130_000_000,
    "eval_duration":        4_700_000_000,
}

OLLAMA_MISSING_COUNTS = {
    "model":       "qwen3.6:27b",
    "done":        True,
    "done_reason": "stop",
    # no prompt_eval_count, no eval_count
}

OLLAMA_MALFORMED = {"done": True}    # missing model field too


# ── Generic failure fixtures ──────────────────────────────────────────────────

GENERIC_TIMEOUT     = {"error": "timeout",    "code": "request_timeout"}
GENERIC_RATE_LIMIT  = {"error": "rate_limit", "code": "rate_limit_exceeded", "retry_after": 30}
GENERIC_PARTIAL     = {"partial": True, "content": "Response cut short", "error": "stream_interrupted"}
GENERIC_UNKNOWN     = {"error": "unknown_error", "message": "Something went wrong"}
