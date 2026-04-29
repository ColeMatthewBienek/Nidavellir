from __future__ import annotations

import uuid

from nidavellir.memory.store import MemoryStore


def test_context_capacity_event_starts_new_seeded_session(tmp_path):
    """When payload capacity is exceeded, roll to a new session with seed context."""
    from nidavellir.routers.ws import (
        _build_provider_context,
        ensure_context_capacity_for_conversation,
    )

    store = MemoryStore(str(tmp_path / "mem.db"))
    store.create_conversation(
        "conv-capacity",
        title="Capacity test",
        provider_id="codex",
        model_id="gpt-5.4",
        active_session_id="session-before-capacity",
    )
    store.append_message(
        "conv-capacity",
        str(uuid.uuid4()),
        "user",
        "IMPORTANT_PROJECT_ANCHOR: the story is about a lighthouse that becomes a rap.",
    )
    store.append_message(
        "conv-capacity",
        str(uuid.uuid4()),
        "agent",
        "The lighthouse story has a happy tone and must be preserved across rollover.",
    )
    # > 112k estimated tokens for codex:gpt-5.4, forcing a blocked context state.
    store.append_message("conv-capacity", str(uuid.uuid4()), "user", "overflow " * 70_000)
    store.append_message("conv-capacity", str(uuid.uuid4()), "agent", "overflow " * 70_000)

    result = ensure_context_capacity_for_conversation(
        store,
        "conv-capacity",
        provider_id="codex",
        model_id="gpt-5.4",
    )

    assert result["rolled_over"] is True
    assert result["conversation_id"] == "conv-capacity"
    assert result["session_id"] != "session-before-capacity"
    assert result["pressure"]["state"] == "blocked"

    conv = store.get_conversation("conv-capacity")
    assert conv["active_session_id"] == result["session_id"]
    assert "IMPORTANT_PROJECT_ANCHOR" in (conv["seed_text"] or "")

    context, includes_seed, _ = _build_provider_context(
        store=store,
        conversation_id="conv-capacity",
        prior_messages=store.get_conversation_messages("conv-capacity"),
        current_content="Make it rhyme like a rap.",
        workflow="chat",
    )
    assert includes_seed is True
    assert "IMPORTANT_PROJECT_ANCHOR" in context
    assert len(context) < 20_000, "new session context must be compact, not full overflow history"
