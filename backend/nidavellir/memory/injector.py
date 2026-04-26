from __future__ import annotations

import logging

from .context_pack import (
    CONFIDENCE_INJECT_THRESHOLD,
    ContextPack,
    compute_final_score,
)
from .store import MemoryStore

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

def select_memories(
    store: MemoryStore,
    query: str,
    workflow: str,
    is_new_session: bool = False,
    repo_id: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Pure function: retrieve → score → filter → return final selected list.

    No side effects. Does not write events, does not update use_count.
    The caller is responsible for calling store.mark_memories_used() on the
    returned list.
    """
    # ── 1. Retrieve candidates ────────────────────────────────────────────────

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

    # ── 2. Score and filter ───────────────────────────────────────────────────

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

    # ── 3. Apply injection cap ────────────────────────────────────────────────

    # Fill a ContextPack to enforce budget/category/total limits, then extract
    # the final list. This keeps selection identical to what the pack renders.
    pack = ContextPack()
    selected: list[dict] = []
    for score, m in scored[:MAX_INJECTED * 3]:  # oversample slightly for pack limits
        if pack.try_add(m):
            selected.append(m)
        if len(selected) >= MAX_INJECTED:
            break

    return selected


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

    # 3. Determine retrieval reason and log fallback when applicable
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
    else:
        retrieval_reason = "fallback_recency"
        store.log_event(
            event_type="retrieval_fallback",
            event_subject="retrieval",
            payload={"query": query, "reason": "fallback_recency"},
        )

    # 4. Log injection events and build pack
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
