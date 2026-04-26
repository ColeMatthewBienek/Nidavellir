from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/memory", tags=["memory"])


def _store(request: Request):
    try:
        return request.app.state.memory_store
    except AttributeError:
        raise HTTPException(503, "Memory store not initialized")


# ── Models ────────────────────────────────────────────────────────────────────

class MemorySaveRequest(BaseModel):
    memories: list[dict]


class MemoryUpdateRequest(BaseModel):
    updates: dict


class MemorySearchRequest(BaseModel):
    query: str
    workflow: str = "chat"
    limit: int = 10


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_memories(request: Request, workflow: str = "chat", limit: int = 50):
    return _store(request).get_active_memories(workflow=workflow, limit=limit)


@router.post("/search")
def search_memories(body: MemorySearchRequest, request: Request):
    return _store(request).search_fts(body.query, body.workflow, body.limit)


@router.post("/")
def save_memories(body: MemorySaveRequest, request: Request):
    count = _store(request).save_memories(body.memories)
    return {"saved": count}


@router.put("/{memory_id}")
def update_memory(memory_id: str, body: MemoryUpdateRequest, request: Request):
    _store(request).update_memory(memory_id, body.updates)
    return {"ok": True}


@router.delete("/{memory_id}")
def delete_memory(memory_id: str, request: Request):
    _store(request).update_memory(memory_id, {"deleted_at": "NOW"})
    return {"ok": True}


@router.get("/events")
def get_events(request: Request, event_type: str | None = None, limit: int = 50):
    return _store(request).get_events(event_type=event_type, limit=limit)


@router.get("/conversations")
def list_conversations(request: Request, workflow: str = "chat", limit: int = 20):
    return _store(request).get_recent_conversations(workflow=workflow, limit=limit)


@router.get("/conversations/{conversation_id}/messages")
def get_conversation_messages(conversation_id: str, request: Request):
    return _store(request).get_conversation_messages(conversation_id)


@router.get("/context")
def get_context(request: Request, query: str = "", workflow: str = "chat"):
    from nidavellir.memory.injector import get_context_pack
    pack = get_context_pack(_store(request), query, workflow)
    return {
        "memories":     pack.memories,
        "total_chars":  pack.total_chars,
        "truncated":    pack.truncated,
        "prefix":       pack.to_prefix(),
    }
