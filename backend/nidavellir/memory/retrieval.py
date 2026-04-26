from __future__ import annotations

import nidavellir.memory.embedding as _emb

# ── Guardrails (Phase 2B) ─────────────────────────────────────────────────────

MAX_VECTOR_CANDIDATES = 20

# Lowered from 0.65 → 0.55 for Phase 2B observation.
# nomic-embed-text cosine similarity for semantically related (but not identical)
# content typically falls in the 0.55–0.75 range.
MIN_VECTOR_SIM = 0.55


def search_vectors_with_diagnostics(
    store,
    query: str,
    limit: int = MAX_VECTOR_CANDIDATES,
) -> dict:
    """Embed query, search Qdrant, return results + full diagnostic metadata.

    Return shape:
        {
            "results": [{"memory_id": str, "score": float, "source": "vector"}, ...],
            "diagnostics": {
                "query":                  str,
                "raw_results_count":      int,
                "filtered_results_count": int,
                "raw_top_scores":         list[float],
                "min_vector_sim":         float,
                "vector_store_count":     int,
                "query_vector_dim":       int,
            }
        }

    Never raises — failures are captured in diagnostics.
    """
    empty_diag = {
        "query":                  query,
        "raw_results_count":      0,
        "filtered_results_count": 0,
        "raw_top_scores":         [],
        "min_vector_sim":         MIN_VECTOR_SIM,
        "vector_store_count":     0,
        "query_vector_dim":       0,
    }

    if store.vector_store is None:
        return {"results": [], "diagnostics": empty_diag}

    try:
        vs_count = store.vector_store.count()
        empty_diag["vector_store_count"] = vs_count

        embedding = _emb.embed_query(query)
        empty_diag["query_vector_dim"] = len(embedding)

        raw = store.vector_store.search(embedding, limit=limit)
    except Exception as exc:
        empty_diag["error"] = str(exc)[:200]
        return {"results": [], "diagnostics": empty_diag}

    raw_scores = [r.score for r in raw]
    results = []
    for r in raw:
        memory_id = r.payload.get("memory_id") if r.payload else None
        if not memory_id:
            continue  # defensive: skip malformed points
        if r.score >= MIN_VECTOR_SIM:
            results.append({
                "memory_id": memory_id,
                "score":     round(r.score, 6),
                "source":    "vector",
            })

    return {
        "results": results,
        "diagnostics": {
            "query":                  query,
            "raw_results_count":      len(raw),
            "filtered_results_count": len(results),
            "raw_top_scores":         [round(s, 6) for s in raw_scores[:5]],
            "min_vector_sim":         MIN_VECTOR_SIM,
            "vector_store_count":     vs_count,
            "query_vector_dim":       len(embedding),
        },
    }


def search_vectors(
    store,
    query: str,
    limit: int = MAX_VECTOR_CANDIDATES,
) -> list[dict]:
    """Backward-compatible wrapper — returns filtered results only.

    Delegates to search_vectors_with_diagnostics for consistency.
    Returns [] gracefully on any failure.
    """
    if store.vector_store is None:
        return []
    try:
        return search_vectors_with_diagnostics(store, query, limit)["results"]
    except Exception:
        return []
