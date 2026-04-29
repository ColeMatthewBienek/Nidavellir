from __future__ import annotations

_SEED_MAX_TURNS = 8

CONTINUED_WITH_PRIOR_CONTEXT = "continued_with_prior_context"
INTENTIONALLY_CLEAN = "intentionally_clean"

_CONTINUE_ALIASES = {
    "continue",
    "review",
    "continue_with_prior_context",
    CONTINUED_WITH_PRIOR_CONTEXT,
}

_CLEAN_ALIASES = {
    "clean",
    "start_clean",
    INTENTIONALLY_CLEAN,
}


def normalize_handoff_mode(mode: str | None) -> str:
    """Normalize UI/API handoff decisions to persisted continuity modes."""
    value = (mode or "start_clean").strip()
    if value in _CONTINUE_ALIASES:
        return CONTINUED_WITH_PRIOR_CONTEXT
    if value in _CLEAN_ALIASES:
        return INTENTIONALLY_CLEAN
    return INTENTIONALLY_CLEAN


def mode_uses_prior_context(mode: str | None) -> bool:
    return normalize_handoff_mode(mode) == CONTINUED_WITH_PRIOR_CONTEXT


def should_inject_seed(turn_number: int, max_turns: int = _SEED_MAX_TURNS) -> bool:
    """Return True if the seed should be injected at this turn number (0-indexed)."""
    return turn_number < max_turns


def build_seed(snapshot: dict) -> str:
    """Build a continuity seed string from a session snapshot."""
    summary = snapshot.get("summary", "").strip()
    count   = snapshot.get("message_count", 0)

    if not summary:
        return f"[Prior session context: {count} messages — no content available]"

    return (
        f"[Prior session context — {count} messages]\n"
        f"{summary}"
    )
