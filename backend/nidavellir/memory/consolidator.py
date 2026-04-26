from __future__ import annotations

DUPLICATE_THRESHOLD = 0.80


def _jaccard(a: str, b: str) -> float:
    sa = set(a.lower().split())
    sb = set(b.lower().split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def find_duplicate_groups(
    memories: list[dict],
    threshold: float = DUPLICATE_THRESHOLD,
) -> list[dict]:
    """Return groups of near-duplicate memories using Jaccard token overlap."""
    groups: list[dict] = []
    used: set[str] = set()

    for i, m1 in enumerate(memories):
        if m1["id"] in used:
            continue
        similar: list[tuple[dict, float]] = []
        for m2 in memories[i + 1:]:
            if m2["id"] in used:
                continue
            sim = _jaccard(m1["content"], m2["content"])
            if sim >= threshold:
                similar.append((m2, sim))

        if not similar:
            continue

        used.add(m1["id"])
        max_sim = 0.0
        losers: list[dict] = []
        for m2, sim in similar:
            used.add(m2["id"])
            losers.append(m2)
            max_sim = max(max_sim, sim)

        groups.append({
            "winner_id":      m1["id"],
            "winner_content": m1["content"],
            "loser_ids":      [m["id"] for m in losers],
            "loser_contents": [m["content"] for m in losers],
            "match_type":     "jaccard",
            "similarity":     round(max_sim, 3),
            "scope": {
                "workflow":    m1.get("workflow"),
                "scope_type":  m1.get("scope_type"),
                "scope_id":    m1.get("scope_id"),
                "repo_id":     m1.get("repo_id"),
                "memory_type": m1.get("memory_type"),
                "category":    m1.get("category"),
            },
            "reason": "near_duplicate_same_scope",
        })

    return groups


def consolidate_memories(
    store,
    workflow: str = "chat",
    dry_run: bool = True,
    limit: int = 25,
    threshold: float = DUPLICATE_THRESHOLD,
) -> dict:
    """Find (and optionally apply) duplicate consolidation.

    dry_run=True  → analyse only, no DB writes
    dry_run=False → supersede losers pointing to winner
    """
    memories = store.get_active_memories(workflow=workflow, limit=500)
    groups = find_duplicate_groups(memories, threshold=threshold)

    if not dry_run:
        for group in groups:
            for loser_id in group["loser_ids"]:
                store.update_memory(loser_id, {"superseded_by": group["winner_id"]})
        if groups:
            store.log_event(
                event_type="consolidation_applied",
                event_subject="consolidation",
                payload={
                    "groups":  len(groups),
                    "workflow": workflow,
                    "dry_run": False,
                },
            )
    else:
        if groups:
            store.log_event(
                event_type="consolidation_proposed",
                event_subject="consolidation",
                payload={
                    "groups":  len(groups),
                    "workflow": workflow,
                    "dry_run": True,
                },
            )

    affected = sum(1 + len(g["loser_ids"]) for g in groups)
    return {
        "groups":            groups,
        "groups_found":      len(groups),
        "memories_affected": affected,
        "dry_run":           dry_run,
    }
