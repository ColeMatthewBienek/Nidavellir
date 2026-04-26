from __future__ import annotations

import nidavellir.memory.embedding as _emb

# ── Guardrails (Phase 2B) ─────────────────────────────────────────────────────

MAX_VECTOR_CANDIDATES = 20
MIN_VECTOR_SIM        = 0.65


def search_vectors(
    store,
    query: str,
    limit: int = MAX_VECTOR_CANDIDATES,
) -> list[dict]:
    """Embed query, search Qdrant, filter by MIN_VECTOR_SIM.

    Returns a list of dicts: {memory_id, score, source='vector'}.

    Observational only — no side effects on use_count or memory_events.
    Returns [] gracefully when:
    - vector store is not configured
    - Ollama is unavailable
    - Qdrant search fails
    """
    if store.vector_store is None:
        return []

    try:
        embedding = _emb.embed_query(query)
        raw = store.vector_store.search(embedding, limit=limit)
    except Exception:
        return []

    return [
        {
            "memory_id": r.payload["memory_id"],
            "score":     r.score,
            "source":    "vector",
        }
        for r in raw
        if r.score >= MIN_VECTOR_SIM
    ]
