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


@router.get("/vector/health")
def vector_health(request: Request):
    """Diagnostic endpoint: Qdrant collection status and embedding model info."""
    from nidavellir.memory.embedding import DEFAULT_EMBED_MODEL
    store = _store(request)
    vs = store.vector_store

    if vs is None:
        return {
            "enabled":         False,
            "vector_path":     None,
            "collection_name": None,
            "points_count":    0,
            "embedding_model": DEFAULT_EMBED_MODEL,
            "ready":           False,
        }

    try:
        points_count = vs.count()
        info         = vs.collection_info()
        ready        = vs.is_ready()
    except Exception as exc:
        return {
            "enabled":         True,
            "vector_path":     "configured",
            "collection_name": info.get("collection_name") if "info" in dir() else None,
            "points_count":    0,
            "embedding_model": DEFAULT_EMBED_MODEL,
            "ready":           False,
            "error":           str(exc)[:200],
        }

    return {
        "enabled":         True,
        "vector_path":     "configured",
        "collection_name": info["collection_name"],
        "points_count":    points_count,
        "vector_size":     info.get("vector_size"),
        "embedding_model": DEFAULT_EMBED_MODEL,
        "ready":           ready,
    }


@router.get("/vector/probe")
def vector_probe(request: Request, q: str = "", workflow: str = "chat"):
    """Debug endpoint: run vector search and join hits back to SQLite memory content.

    Does NOT affect injection or usage counts.
    """
    from nidavellir.memory.retrieval import search_vectors_with_diagnostics

    store = _store(request)

    if not q.strip():
        return {"query": q, "diagnostics": {}, "results": []}

    outcome = search_vectors_with_diagnostics(store, q)
    results = outcome["results"]

    # Join back to SQLite for content
    enriched = []
    for r in results:
        with store._conn() as conn:
            row = conn.execute(
                "SELECT content, category, memory_type, confidence, importance "
                "FROM memories WHERE id = ?",
                (r["memory_id"],),
            ).fetchone()
        enriched.append({
            "memory_id":   r["memory_id"],
            "score":       r["score"],
            "source":      r["source"],
            "content":     row["content"] if row else None,
            "category":    row["category"] if row else None,
            "memory_type": row["memory_type"] if row else None,
            "confidence":  row["confidence"] if row else None,
            "importance":  row["importance"] if row else None,
        })

    return {
        "query":       q,
        "diagnostics": outcome["diagnostics"],
        "results":     enriched,
    }


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
