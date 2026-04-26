from __future__ import annotations

from .context_pack import (
    CONFIDENCE_INJECT_THRESHOLD,
    ContextPack,
    compute_final_score,
)
from .store import MemoryStore

# ── Retrieval thresholds ──────────────────────────────────────────────────────

# BM25 scores from SQLite FTS5 are negative; more negative = more relevant.
# Only use FTS results when the best result has score <= this value.
FTS_SCORE_THRESHOLD = -0.2

# Memories whose final composite score falls below this are not injected.
MIN_SCORE_THRESHOLD = 0.2


# ── Public API ────────────────────────────────────────────────────────────────

def get_context_pack(
    store: MemoryStore,
    query: str,
    workflow: str,
    repo_id: str | None = None,
    session_id: str | None = None,
    limit: int = 20,
) -> ContextPack:
    pack = ContextPack()

    # ── 1. Retrieval: FTS first; recency fallback otherwise ───────────────────

    retrieval_reason = "fts_match"
    candidates: list[tuple[dict, float | None]] = []

    if query and query.strip():
        fts_results = store.search_fts(query, workflow, limit=limit)
        # Accept FTS results only when the best hit clears the quality threshold
        if fts_results and fts_results[0].get("relevance_score", 0) <= FTS_SCORE_THRESHOLD:
            candidates = [(m, m.get("relevance_score")) for m in fts_results]
        else:
            retrieval_reason = "fallback_recency"
            store.log_event(
                event_type="retrieval_fallback",
                event_subject="retrieval",
                payload={"query": query, "reason": "fallback_recency"},
            )
            candidates = [
                (m, None) for m in store.get_active_memories(workflow, limit=limit)
            ]
    else:
        retrieval_reason = "fallback_recency"
        store.log_event(
            event_type="retrieval_fallback",
            event_subject="retrieval",
            payload={"query": query, "reason": "fallback_recency"},
        )
        candidates = [
            (m, None) for m in store.get_active_memories(workflow, limit=limit)
        ]

    # ── 2. Score, filter by inject threshold, filter by min score ────────────

    def _scope_boost(m: dict) -> float:
        if repo_id and m.get("repo_id") == repo_id:
            return 0.3
        if m.get("scope_type") == "workflow" and m.get("scope_id") == workflow:
            return 0.1
        return 0.0

    def _scope_match_label(m: dict) -> str:
        if repo_id and m.get("repo_id") == repo_id:
            return "repo"
        if m.get("scope_id") == workflow:
            return "workflow"
        return "none"

    scored: list[tuple[float, dict, str]] = []
    for m, rank in candidates:
        if float(m.get("confidence", 0)) < CONFIDENCE_INJECT_THRESHOLD:
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
        scored.append((score, m, _scope_match_label(m)))

    scored.sort(key=lambda t: t[0], reverse=True)

    # ── 3. Fill pack and log injection events ──────────────────────────────────

    for rank, (score, m, scope_match) in enumerate(scored, start=1):
        if pack.try_add(m):
            store.log_event(
                event_type="injected",
                memory_id=m["id"],
                event_subject="injection",
                session_id=session_id,
                payload={
                    "query":       query,
                    "rank":        rank,
                    "score":       round(score, 4),
                    "reason":      retrieval_reason,
                    "scope_match": scope_match,
                    "injected":    True,
                },
            )

    return pack


def get_context_prefix(
    store: MemoryStore,
    query: str,
    workflow: str,
    repo_id: str | None = None,
    session_id: str | None = None,
) -> str:
    pack = get_context_pack(
        store, query, workflow, repo_id=repo_id, session_id=session_id
    )
    return pack.to_prefix()
