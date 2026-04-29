from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from nidavellir.sessions.continuity import switch_session
from nidavellir.sessions.handoff import normalize_handoff_mode
from nidavellir.sessions.snapshot import create_snapshot

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class SwitchRequest(BaseModel):
    old_conversation_id: str
    new_provider:        str
    new_model:           str
    mode:                str = "clean"   # continue | clean | review


@router.get("/{conversation_id}/snapshot")
async def get_snapshot(conversation_id: str, request: Request):
    store = getattr(request.app.state, "memory_store", None)
    if store is None:
        raise HTTPException(503, "memory store unavailable")
    snap = create_snapshot(store, conversation_id)
    return snap


@router.post("/switch")
async def session_switch(body: SwitchRequest, request: Request):
    store = getattr(request.app.state, "memory_store", None)
    if store is None:
        raise HTTPException(503, "memory store unavailable")
    new_id = switch_session(
        store,
        body.old_conversation_id,
        new_provider=body.new_provider,
        new_model=body.new_model,
        mode=body.mode,
    )
    child = store.get_conversation(new_id)
    return {
        "new_conversation_id": new_id,
        "mode":                normalize_handoff_mode(body.mode),
        "seed_text":           child.get("seed_text"),
    }
