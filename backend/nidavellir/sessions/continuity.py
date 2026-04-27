from __future__ import annotations

import uuid

from .snapshot import create_snapshot
from .handoff import build_seed


def switch_session(
    store,
    old_conversation_id: str,
    *,
    new_provider: str,
    new_model: str,
    mode: str = "clean",
) -> str:
    """Freeze the old session and create a child session.

    mode:
      'continue' — snapshot old session, build seed, inject into child
      'clean'    — no seed; fresh context
      'review'   — same as continue but caller handles seed display separately
    """
    # 1. Freeze old session
    store.freeze_conversation(old_conversation_id)

    # 2. Build seed if Continue/Review mode and old session has messages
    seed_text: str | None = None
    if mode in ("continue", "review"):
        snap = create_snapshot(store, old_conversation_id)
        if snap["message_count"] > 0:
            seed_text = build_seed(snap)

    # 3. Create child session
    new_id = str(uuid.uuid4())
    store.create_child_conversation(
        old_conversation_id,
        new_id=new_id,
        workflow="chat",
        model_id=new_model,
        provider_id=new_provider,
        continuity_mode=mode,
        seed_text=seed_text,
    )

    return new_id
