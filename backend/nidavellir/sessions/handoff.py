from __future__ import annotations

_SEED_MAX_TURNS = 8


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
