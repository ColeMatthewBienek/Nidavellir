from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, UTC

from .model_limits import get_model_limits


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
