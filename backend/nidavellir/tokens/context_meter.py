from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, UTC

from .model_limits import get_model_limits


# Chars-per-token approximation. Real tokenizers vary but 4 is a well-established
# heuristic for English/code content across OpenAI and Anthropic models.
_CHARS_PER_TOKEN = 4


def estimate_payload_tokens(messages: list[dict]) -> int:
    """Estimate token count for the given conversation messages.

    This represents the size of the next provider request payload, which is
    what the context window limit is actually evaluated against.

    Uses character-count heuristic (len(content) // chars_per_token).
    Does NOT touch historical token_usage_records.
    """
    total_chars = sum(len(m.get("content", "")) for m in messages)
    return total_chars // _CHARS_PER_TOKEN


@dataclass
class ContextPressure:
    model:                  str
    provider:               str
    current_tokens:         int
    usable_tokens:          int
    context_limit:          int
    reserved_output_tokens: int
    percent_used:           float
    state:                  str   # ok | warn | prepare | force | blocked
    accuracy:               str   # accurate | estimated | unknown
    last_updated_at:        str


def _classify_state(pct: float) -> str:
    if pct >= 95.0:
        return "blocked"
    if pct >= 85.0:
        return "force"
    if pct >= 75.0:
        return "prepare"
    if pct >= 65.0:
        return "warn"
    return "ok"


def compute_context_pressure(
    current_tokens: int,
    model: str,
    provider: str,
    accuracy: str = "estimated",
) -> ContextPressure:
    limits  = get_model_limits(model, provider)
    usable  = limits["usable_tokens"]
    pct     = round((current_tokens / usable) * 100, 2) if usable > 0 else 0.0
    pct     = max(0.0, pct)

    return ContextPressure(
        model=model,
        provider=provider,
        current_tokens=current_tokens,
        usable_tokens=usable,
        context_limit=limits["context_limit"],
        reserved_output_tokens=limits["reserved_output_tokens"],
        percent_used=pct,
        state=_classify_state(pct),
        accuracy=accuracy,
        last_updated_at=datetime.now(UTC).isoformat(),
    )
