"""
Phase 2C — Hybrid Retrieval (SPEC-12D Phase 2C FINAL).

Combines FTS lexical candidates with vector semantic candidates into a
single scored, gated selection. FTS-first, vector-assisted.

This module is pure computation — no DB writes, no event logging.
All side effects (mark_memories_used, log_event) remain in injector.py.
"""
from __future__ import annotations

import math
import os
from datetime import datetime, UTC

from .context_pack import (
    CONFIDENCE_INJECT_THRESHOLD,
    ContextPack,
    DECAY_RATES,
)

# ── Feature flag ──────────────────────────────────────────────────────────────

def _read_flag() -> bool:
    return os.environ.get("NIDAVELLIR_HYBRID_RETRIEVAL", "false").lower() == "true"

# Module-level attribute so tests can monkeypatch it directly.
HYBRID_ENABLED: bool = _read_flag()


def is_hybrid_enabled() -> bool:
    """Return True when hybrid retrieval is active. Reads module-level flag."""
    return HYBRID_ENABLED


# ── Constants ─────────────────────────────────────────────────────────────────

STRONG_FTS_THRESHOLD  = 0.80
MEDIUM_FTS_THRESHOLD  = 0.45

MAX_FTS_CANDIDATES    = 10
MAX_VECTOR_CANDIDATES = 20
MAX_MERGED_CANDIDATES = 25
MAX_FINAL_SELECTED    = 5

# Minimum vector score for a vector-only candidate to be injected.
VECTOR_ONLY_MIN_SIM   = 0.63
# Minimum importance for a vector-only candidate.
VECTOR_ONLY_MIN_IMP   = 5


# ── Scoring helpers ───────────────────────────────────────────────────────────

def normalize_bm25(bm25: float | None) -> float:
    """Convert negative SQLite FTS5 BM25 score to a positive relevance value in [0,1]."""
    if bm25 is None:
        return 0.0
    return min(max(0.0, -bm25), 1.0)


def vector_boost(vector_score: float | None) -> float:
    """Tiered vector weight based on observed nomic-embed-text score distributions."""
    if vector_score is None:
        return 0.0
    if vector_score >= 0.70:
        return vector_score * 1.5    # strong semantic signal
    if vector_score >= 0.63:
        return vector_score * 1.0    # moderate semantic signal
    if vector_score >= 0.55:
        return vector_score * 0.25   # weak/borderline — minimal influence
    return 0.0


def _temporal_decay(memory: dict) -> float:
    """Compute temporal decay for a memory dict (mirrors context_pack logic)."""
    try:
        created_at = memory.get("created_at", "")
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        age_days = max(0, (datetime.now(UTC) - created).days)
    except Exception:
        age_days = 0
    half_life = DECAY_RATES.get(memory.get("memory_type", "fact"), 30)
    return math.exp(-0.693 * age_days / half_life)


def compute_hybrid_score(candidate: dict, strong_fts: bool = False) -> float:
    """Compute the hybrid ranking score for a merged candidate.

    When FTS is strong, vector contribution is excluded for that candidate.
    """
    memory = candidate.get("memory", {})

    fts_part       = normalize_bm25(candidate.get("bm25")) * 2.0
    confidence_part = float(memory.get("confidence") or 0.0)
    importance_part = int(memory.get("importance") or 0) / 10.0
    use_count       = int(memory.get("use_count") or 0)
    use_part        = min(math.log(use_count + 1), 2.0) * 0.15
    decay_part      = _temporal_decay(memory)

    if strong_fts:
        # FTS dominates — do not add vector boost
        vector_part = 0.0
    else:
        vector_part = vector_boost(candidate.get("vector_score"))

    return fts_part + vector_part + confidence_part + importance_part + use_part + decay_part


# ── Injection gate ────────────────────────────────────────────────────────────

def allow_vector_only(candidate: dict, has_strong_fts: bool) -> bool:
    """Return True if a vector-only candidate may be injected."""
    if has_strong_fts:
        return False

    if candidate.get("source") != "vector":
        return True  # FTS / both candidates are always allowed through

    memory = candidate.get("memory", {})
    return (
        (candidate.get("vector_score") or 0.0) >= VECTOR_ONLY_MIN_SIM
        and float(memory.get("confidence") or 0.0) >= CONFIDENCE_INJECT_THRESHOLD
        and int(memory.get("importance") or 0) >= VECTOR_ONLY_MIN_IMP
        and not memory.get("superseded_by")
        and not memory.get("deleted_at")
    )


# ── Merge ─────────────────────────────────────────────────────────────────────

def merge_candidates(
    fts_results: list[dict],
    vector_results: list[dict],
    store,
    workflow: str,
) -> list[dict]:
    """Merge FTS and vector results by memory_id.

    FTS results already contain full memory rows.
    Vector results contain memory_id + score; full rows are fetched from SQLite.
    """
    merged: dict[str, dict] = {}

    # Index FTS results
    for m in fts_results:
        mid = m.get("id")
        if not mid:
            continue
        merged[mid] = {
            "memory_id":    mid,
            "memory":       m,
            "bm25":         m.get("relevance_score"),
            "vector_score": None,
            "source":       "fts",
        }

    # Merge vector results
    vec_ids_needing_fetch = [
        r["memory_id"] for r in vector_results
        if r.get("memory_id") and r["memory_id"] not in merged
    ]
    # Batch fetch missing memory rows
    fetched: dict[str, dict] = {}
    if vec_ids_needing_fetch:
        try:
            with store._conn() as conn:
                placeholders = ",".join("?" * len(vec_ids_needing_fetch))
                rows = conn.execute(
                    f"SELECT * FROM memories WHERE id IN ({placeholders})",
                    vec_ids_needing_fetch,
                ).fetchall()
            for row in rows:
                d = dict(row)
                fetched[d["id"]] = d
        except Exception:
            pass

    for r in vector_results:
        mid = r.get("memory_id")
        if not mid:
            continue
        if mid in merged:
            merged[mid]["vector_score"] = r["score"]
            merged[mid]["source"] = "both"
        else:
            memory = fetched.get(mid)
            if memory is None:
                continue
            merged[mid] = {
                "memory_id":    mid,
                "memory":       memory,
                "bm25":         None,
                "vector_score": r["score"],
                "source":       "vector",
            }

    return list(merged.values())[:MAX_MERGED_CANDIDATES]


# ── Hybrid selection ──────────────────────────────────────────────────────────

def hybrid_select_memories(
    store,
    query: str,
    workflow: str,
    is_new_session: bool = False,
    repo_id: str | None = None,
) -> list[dict]:
    """Hybrid retrieval: merge FTS + vector, score, gate, select.

    Pure function — no DB writes, no event logging.
    Returns list of memory dicts with '_retrieval_source' and '_hybrid_score' added.
    """
    from .retrieval import search_vectors_with_diagnostics

    # 1. FTS retrieval
    fts_results: list[dict] = []
    if query and query.strip():
        try:
            fts_results = store.search_fts(query, workflow, limit=MAX_FTS_CANDIDATES)
        except Exception:
            fts_results = []

    # 2. Vector retrieval
    vector_results: list[dict] = []
    if query and query.strip():
        try:
            outcome = search_vectors_with_diagnostics(store, query, limit=MAX_VECTOR_CANDIDATES)
            vector_results = outcome.get("results", [])
        except Exception:
            vector_results = []

    # 3. Merge by memory_id
    candidates = merge_candidates(fts_results, vector_results, store, workflow)

    # 4. Classify FTS strength
    fts_relevances = [normalize_bm25(c["bm25"]) for c in candidates if c.get("bm25") is not None]
    has_strong_fts = any(r >= STRONG_FTS_THRESHOLD for r in fts_relevances)

    # 5. Score, filter, gate
    scored: list[tuple[float, dict]] = []
    for c in candidates:
        memory = c["memory"]

        # Confidence gate
        if float(memory.get("confidence") or 0.0) < CONFIDENCE_INJECT_THRESHOLD:
            continue
        # New session importance gate
        if is_new_session and int(memory.get("importance") or 0) < 5:
            continue
        # Superseded / deleted
        if memory.get("superseded_by") or memory.get("deleted_at"):
            continue
        # Vector-only gate
        if not allow_vector_only(c, has_strong_fts):
            if c["source"] == "vector":
                continue

        score = compute_hybrid_score(c, strong_fts=has_strong_fts and c["source"] == "fts")
        c["_hybrid_score"]      = round(score, 4)
        c["_retrieval_source"]  = c["source"]
        c["_has_strong_fts"]    = has_strong_fts
        scored.append((score, c))

    scored.sort(key=lambda t: t[0], reverse=True)

    # 6. Fill ContextPack to respect budget/category/total limits
    pack = ContextPack()
    selected: list[dict] = []
    for _, c in scored[:MAX_FINAL_SELECTED * 3]:
        memory = c["memory"]
        if pack.try_add(memory):
            # Annotate the memory dict with retrieval metadata
            memory["_retrieval_source"] = c["_retrieval_source"]
            memory["_hybrid_score"]     = c["_hybrid_score"]
            memory["_vector_score"]     = c.get("vector_score")
            selected.append(memory)
        if len(selected) >= MAX_FINAL_SELECTED:
            break

    return selected
