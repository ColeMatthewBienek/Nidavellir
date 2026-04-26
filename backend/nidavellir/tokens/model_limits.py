from __future__ import annotations

# Context limits per provider:model pair.
# context_limit: total context window in tokens
# reserved_output_tokens: held back for model output (not available for input)
# usable_tokens: context_limit - reserved_output_tokens

_LIMITS: dict[tuple[str, str], dict] = {
    # Anthropic / Claude
    ("anthropic", "claude-sonnet-4-6"):    {"context_limit": 200_000, "reserved_output_tokens": 8_000},
    ("anthropic", "claude-opus-4-7"):      {"context_limit": 200_000, "reserved_output_tokens": 8_000},
    ("anthropic", "claude-haiku-4-5"):     {"context_limit": 200_000, "reserved_output_tokens": 4_000},
    ("anthropic", "claude-sonnet-4"):      {"context_limit": 200_000, "reserved_output_tokens": 8_000},
    ("anthropic", "claude-opus-4"):        {"context_limit": 200_000, "reserved_output_tokens": 8_000},
    ("anthropic", "claude"):               {"context_limit": 200_000, "reserved_output_tokens": 8_000},
    # Codex / OpenAI
    ("codex", "gpt-5.4"):                  {"context_limit": 128_000, "reserved_output_tokens": 16_000},
    ("codex", "gpt-5.4-mini"):             {"context_limit": 128_000, "reserved_output_tokens": 16_000},
    ("codex", "gpt-5.3-codex"):            {"context_limit": 128_000, "reserved_output_tokens": 16_000},
    ("openai", "gpt-5.4"):                 {"context_limit": 128_000, "reserved_output_tokens": 16_000},
    ("openai", "gpt-4o"):                  {"context_limit": 128_000, "reserved_output_tokens": 16_000},
    ("openai", "gpt-4o-mini"):             {"context_limit": 128_000, "reserved_output_tokens": 16_000},
    # Ollama
    ("ollama", "qwen3.6:27b"):             {"context_limit": 131_072, "reserved_output_tokens": 8_000},
    ("ollama", "llama3"):                  {"context_limit": 128_000, "reserved_output_tokens": 4_000},
}

_DEFAULT = {"context_limit": 128_000, "reserved_output_tokens": 8_000}


def get_model_limits(model: str, provider: str) -> dict:
    key = (provider.lower(), model.lower())
    raw = _LIMITS.get(key)
    if raw is None:
        # Try prefix match (e.g. "claude-sonnet" matches "claude-sonnet-4-6")
        model_l = model.lower()
        for (p, m), v in _LIMITS.items():
            if p == provider.lower() and (model_l.startswith(m) or m.startswith(model_l)):
                raw = v
                break
    if raw is None:
        raw = _DEFAULT
    result = dict(raw)
    result["usable_tokens"] = result["context_limit"] - result["reserved_output_tokens"]
    return result
