from __future__ import annotations

import logging

from .context_pack import (
    CONFIDENCE_INJECT_THRESHOLD,
    ContextPack,
    compute_final_score,
)
from .store import MemoryStore

# Lazy import: retrieval module may not be available in all test environments
def _get_search_vectors_with_diagnostics():
    from .retrieval import search_vectors_with_diagnostics
    return search_vectors_with_diagnostics

logger = logging.getLogger(__name__)

# ── Retrieval thresholds ──────────────────────────────────────────────────────

# BM25 scores from SQLite FTS5 are negative; more negative = more relevant.
# Only use FTS results when the best result has score <= this value.
FTS_SCORE_THRESHOLD = -0.2

# Memories whose final composite score falls below this are not injected.
MIN_SCORE_THRESHOLD = 0.2

# ── Vector guardrails (Phase 2B prep — do not activate yet) ──────────────────

MAX_VECTOR_CANDIDATES = 20
MAX_INJECTED          = 5
MIN_VECTOR_SIM        = 0.65

# On a new session, only inject memories with importance >= this value
# to reduce noise and focus on high-signal context.
MIN_IMPORTANCE_NEW_SESSION = 5


# ── Pure selection function ───────────────────────────────────────────────────

def _fts_select(
    store: MemoryStore,
    query: str,
    workflow: str,
    is_new_session: bool = False,
    repo_id: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Phase 2B FTS/fallback selection — unchanged from before hybrid."""
    retrieval_reason = "fts_match"
    candidates: list[tuple[dict, float | None]] = []

    if query and query.strip():
        fts_results = store.search_fts(query, workflow, limit=limit)
        if fts_results and fts_results[0].get("relevance_score", 0) <= FTS_SCORE_THRESHOLD:
            candidates = [(m, m.get("relevance_score")) for m in fts_results]
        else:
            retrieval_reason = "fallback_recency"
            candidates = [
                (m, None) for m in store.get_active_memories(workflow, limit=limit)
            ]
    else:
        retrieval_reason = "fallback_recency"
        candidates = [
            (m, None) for m in store.get_active_memories(workflow, limit=limit)
        ]

    def _scope_boost(m: dict) -> float:
        if repo_id and m.get("repo_id") == repo_id:
            return 0.3
        if m.get("scope_type") == "workflow" and m.get("scope_id") == workflow:
            return 0.1
        return 0.0

    scored: list[tuple[float, dict]] = []
    for m, rank in candidates:
        if float(m.get("confidence", 0)) < CONFIDENCE_INJECT_THRESHOLD:
            continue
        if is_new_session and int(m.get("importance", 0)) < MIN_IMPORTANCE_NEW_SESSION:
            continue
        score = compute_final_score(
            relevance_score=rank,
            importance=int(m.get("importance", 5)),
            scope_boost=_scope_boost(m),
            memory_type=m.get("memory_type", "fact"),
            created_at=m.get("created_at", ""),
            use_count=int(m.get("use_count", 0)),
        )
        if score < MIN_SCORE_THRESHOLD:
            continue
        scored.append((score, m))

    scored.sort(key=lambda t: t[0], reverse=True)

    pack = ContextPack()
    selected: list[dict] = []
    for score, m in scored[:MAX_INJECTED * 3]:
        if pack.try_add(m):
            selected.append(m)
        if len(selected) >= MAX_INJECTED:
            break

    return selected


def select_memories(
    store: MemoryStore,
    query: str,
    workflow: str,
    is_new_session: bool = False,
    repo_id: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Pure function: retrieve → score → filter → return final selected list.

    When NIDAVELLIR_HYBRID_RETRIEVAL=true, delegates to hybrid_select_memories.
    When false, uses FTS/fallback path (Phase 2B behaviour).
    No side effects in either path.
    """
    from .hybrid import is_hybrid_enabled, hybrid_select_memories
    if is_hybrid_enabled():
        return hybrid_select_memories(
            store, query, workflow,
            is_new_session=is_new_session, repo_id=repo_id,
        )
    return _fts_select(store, query, workflow, is_new_session=is_new_session,
                       repo_id=repo_id, limit=limit)


# ── Vector observation (Phase 2B — log only, no injection) ───────────────────

def _observe_vectors(
    store: MemoryStore,
    query: str,
    fts_count: int = 0,
    limit: int = 20,
) -> list[dict]:
    """Run vector search and log results. Never modifies selection or scoring.

    Logs vector_searched on success, vector_search_failed on exception.
    Never raises — failures are always logged, never silently swallowed.
    """
    if not query or not query.strip():
        return []

    logger.info("vector_observe_start", extra={"query": query[:80]})

    try:
        fn      = _get_search_vectors_with_diagnostics()
        outcome = fn(store, query, limit=limit)
        vector_results = outcome["results"]
        diag           = outcome["diagnostics"]

        top_memory_ids = [r["memory_id"] for r in vector_results[:5] if r.get("memory_id")]
        store.log_event(
            event_type="vector_searched",
            event_subject="retrieval",
            payload={
                "query":                query[:200],
                "top_results":          vector_results[:5],
                "top_memory_ids":       top_memory_ids,
                "fts_results_count":    fts_count,
                "vector_results_count": len(vector_results),
                "raw_results_count":    diag.get("raw_results_count", 0),
                "raw_top_scores":       diag.get("raw_top_scores", []),
                "min_vector_sim":       diag.get("min_vector_sim"),
                "vector_store_count":   diag.get("vector_store_count"),
                "query_vector_dim":     diag.get("query_vector_dim"),
            },
        )

        logger.info("vector_observe_complete", extra={"count": len(vector_results)})
        return vector_results

    except Exception as exc:
        store.log_event(
            event_type="vector_search_failed",
            event_subject="retrieval",
            payload={
                "query": query[:200],
                "error": str(exc)[:300],
            },
        )
        logger.warning("vector_observe_failed", extra={"error": str(exc)[:100]})
        return []


def _log_hybrid_scored(
    store: MemoryStore,
    query: str,
    selected: list[dict],
    session_id: str | None,
) -> None:
    """Log hybrid_scored event with candidate diagnostics. Never raises."""
    try:
        has_strong_fts = any(m.get("_has_strong_fts") for m in selected)
        candidates_payload = [
            {
                "memory_id":   m["id"],
                "source":      m.get("_retrieval_source", "unknown"),
                "hybrid_score": m.get("_hybrid_score"),
                "allowed":     True,
            }
            for m in selected
        ]
        store.log_event(
            event_type="hybrid_scored",
            event_subject="retrieval",
            session_id=session_id,
            payload={
                "query":          query[:200],
                "hybrid_enabled": True,
                "has_strong_fts": bool(has_strong_fts),
                "selected_ids":   [m["id"] for m in selected],
                "candidates":     candidates_payload,
                "fts_count":      sum(1 for m in selected
                                      if m.get("_retrieval_source") in ("fts", "both")),
                "vector_count":   sum(1 for m in selected
                                      if m.get("_retrieval_source") in ("vector", "both")),
                "merged_count":   len(selected),
            },
        )
    except Exception:
        pass


# ── Side-effecting API ────────────────────────────────────────────────────────

def get_context_pack(
    store: MemoryStore,
    query: str,
    workflow: str,
    repo_id: str | None = None,
    session_id: str | None = None,
    limit: int = 20,
    is_new_session: bool = False,
) -> ContextPack:
    """Retrieve, select, mark used, log, and return a ContextPack."""

    # 1. Pure selection — no side effects
    selected = select_memories(
        store=store,
        query=query,
        workflow=workflow,
        is_new_session=is_new_session,
        repo_id=repo_id,
        limit=limit,
    )

    # 2. Mark ONLY the final selected memories as used (single write path)
    selected_ids = [m["id"] for m in selected]
    store.mark_memories_used(selected_ids)

    # 3. Determine retrieval reason, log fallback, run vector observation
    if query and query.strip():
        fts_probe = store.search_fts(query, workflow, limit=1)
        if fts_probe and fts_probe[0].get("relevance_score", 0) <= FTS_SCORE_THRESHOLD:
            retrieval_reason = "fts_match"
        else:
            retrieval_reason = "fallback_recency"
            store.log_event(
                event_type="retrieval_fallback",
                event_subject="retrieval",
                payload={"query": query, "reason": "fallback_recency"},
            )
        fts_count = len(fts_probe)
    else:
        retrieval_reason = "fallback_recency"
        store.log_event(
            event_type="retrieval_fallback",
            event_subject="retrieval",
            payload={"query": query, "reason": "fallback_recency"},
        )
        fts_count = 0

    # 4. Vector search — observational only when hybrid is disabled
    _observe_vectors(store, query, fts_count)

    # 4b. Log hybrid_scored event when hybrid retrieval is active
    from .hybrid import is_hybrid_enabled
    if is_hybrid_enabled() and query and query.strip():
        _log_hybrid_scored(store, query, selected, session_id)

    # 5. Log injection events and build pack
    pack = ContextPack()
    for rank, m in enumerate(selected, start=1):
        if pack.try_add(m):
            scope_match = (
                "repo" if (repo_id and m.get("repo_id") == repo_id)
                else "workflow" if m.get("scope_id") == workflow
                else "none"
            )
            store.log_event(
                event_type="injected",
                memory_id=m["id"],
                event_subject="injection",
                session_id=session_id,
                payload={
                    "query":       query,
                    "rank":        rank,
                    "score":       round(
                        compute_final_score(
                            relevance_score=None,
                            importance=int(m.get("importance", 5)),
                            scope_boost=0.1 if m.get("scope_id") == workflow else 0.0,
                            memory_type=m.get("memory_type", "fact"),
                            created_at=m.get("created_at", ""),
                            use_count=int(m.get("use_count", 0)),
                        ), 4
                    ),
                    "reason":      retrieval_reason,
                    "scope_match": scope_match,
                    "injected":    True,
                },
            )

    # 5. Structured trace log
    logger.info(
        "memory_injection",
        extra={
            "selected_ids": selected_ids,
            "count":        len(selected_ids),
            "query":        query[:80] if query else "",
            "workflow":     workflow,
        },
    )

    return pack


def get_context_prefix(
    store: MemoryStore,
    query: str,
    workflow: str,
    repo_id: str | None = None,
    session_id: str | None = None,
    is_new_session: bool = False,
) -> str:
    pack = get_context_pack(
        store, query, workflow,
        repo_id=repo_id, session_id=session_id,
        is_new_session=is_new_session,
    )
    return pack.to_prefix()
