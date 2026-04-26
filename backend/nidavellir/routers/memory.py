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


@router.get("/quality/summary")
def quality_summary(request: Request, workflow: str = "chat"):
    return _store(request).quality_summary(workflow)


@router.get("/quality/stale")
def quality_stale(request: Request, workflow: str = "chat", limit: int = 25):
    return {"items": _store(request).quality_stale(workflow, limit)}


@router.get("/quality/low-confidence")
def quality_low_confidence(request: Request, workflow: str = "chat", limit: int = 25):
    return {"items": _store(request).quality_low_confidence(workflow, limit)}


@router.get("/quality/never-used")
def quality_never_used(request: Request, workflow: str = "chat", limit: int = 25):
    return {"items": _store(request).quality_never_used(workflow, limit)}


@router.get("/quality/frequent")
def quality_frequent(request: Request, workflow: str = "chat", limit: int = 25):
    return {"items": _store(request).quality_frequent(workflow, limit)}


@router.get("/quality/events")
def quality_events(request: Request, workflow: str = "chat", limit: int = 50):
    return {"items": _store(request).quality_events(workflow, limit)}


@router.get("/quality/top-scored")
def quality_top_scored(request: Request, workflow: str = "chat", q: str = "", limit: int = 25):
    return {"items": _store(request).quality_top_scored(workflow, q, limit)}


@router.get("/quality/duplicates")
def quality_duplicates(request: Request, workflow: str = "chat", limit: int = 25):
    return _store(request).quality_duplicates(workflow, limit, dry_run=True)


@router.post("/consolidate")
def consolidate(request: Request, workflow: str = "chat", dry_run: bool = True):
    from nidavellir.memory.consolidator import consolidate_memories
    return consolidate_memories(_store(request), workflow=workflow, dry_run=dry_run)


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
