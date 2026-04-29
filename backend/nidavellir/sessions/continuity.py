from __future__ import annotations

import uuid
import logging

from .snapshot import create_snapshot
from .handoff import build_seed, mode_uses_prior_context, normalize_handoff_mode

_log = logging.getLogger(__name__)


def switch_session(
    store,
    old_conversation_id: str,
    *,
    new_provider: str,
    new_model: str,
    mode: str = "clean",
) -> str:
    """Freeze the old session and create a child session.

    mode accepts legacy aliases ('continue', 'clean', 'review') and canonical
    decisions ('continue_with_prior_context', 'start_clean'). The persisted
    continuity_mode is always canonical.
    """
    continuity_mode = normalize_handoff_mode(mode)

    # Snapshot from the parent before creating the child, so an empty child can
    # never be accidentally summarized.
    seed_text: str | None = None
    if mode_uses_prior_context(mode):
        snap = create_snapshot(store, old_conversation_id)
        _log.info("handoff_snapshot_created", extra={
            "event": "handoff_snapshot_created",
            "source_conversation_id": old_conversation_id,
            "message_count": snap.get("message_count", 0),
            "summary_length": len(snap.get("summary", "")),
        })
        if snap["message_count"] > 0:
            seed_text = build_seed(snap)

    store.freeze_conversation(old_conversation_id)

    new_id = str(uuid.uuid4())
    store.create_child_conversation(
        old_conversation_id,
        new_id=new_id,
        workflow="chat",
        model_id=new_model,
        provider_id=new_provider,
        continuity_mode=continuity_mode,
        seed_text=seed_text,
    )
    _log.info("child_conversation_created", extra={
        "event": "child_conversation_created",
        "parent_conversation_id": old_conversation_id,
        "child_conversation_id": new_id,
        "continuity_mode": continuity_mode,
    })
    _log.info("handoff_seed_stored", extra={
        "event": "handoff_seed_stored",
        "child_conversation_id": new_id,
        "seed_length": len(seed_text or ""),
        "expires_after_turns": 8,
    })

    return new_id
