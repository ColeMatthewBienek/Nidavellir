"""
SPEC-12H — Bad Hybrid Pick Detector.

Pure diagnostic module. No DB writes. No behavior changes.
detect_bad_hybrid_picks() returns warnings about suspicious hybrid selections;
the caller (injector.py) is responsible for logging them.
"""
from __future__ import annotations

from .hybrid import VECTOR_ONLY_MIN_SIM
from .context_pack import CONFIDENCE_INJECT_THRESHOLD

# Score range considered borderline for vector-only candidates
BORDERLINE_LOWER = VECTOR_ONLY_MIN_SIM   # 0.63
BORDERLINE_UPPER = 0.67

# Technical query heuristic — keywords that suggest a code/infra context
_TECHNICAL_KEYWORDS = frozenset([
    "api", "rest", "graphql", "fastapi", "flask", "django", "code", "class",
    "function", "sql", "database", "schema", "endpoint", "service", "deploy",
    "docker", "kubernetes", "terraform", "aws", "gcp", "azure", "git", "ci",
    "test", "debug", "error", "exception", "stack", "trace", "log", "query",
    "struct", "interface", "module", "package", "import", "type", "async",
    "thread", "process", "memory", "cache", "redis", "postgres", "mongo",
])

# Memory types that are rarely relevant to technical queries
_NON_TECHNICAL_TYPES = frozenset(["preference", "person", "task"])


def _is_technical_query(query: str) -> bool:
    words = set(query.lower().split())
    return bool(words & _TECHNICAL_KEYWORDS)


def detect_bad_hybrid_picks(
    selected: list[dict],
    query: str,
    store=None,
) -> list[dict]:
    """Return diagnostic warnings for suspicious hybrid selections.

    Does NOT mutate selected memories or the DB.
    Each warning is a dict with: memory_id, reason, severity, source,
    vector_score, hybrid_score, query.
    """
    warnings: list[dict] = []

    for m in selected:
        source       = m.get("_retrieval_source", "unknown")
        vector_score = m.get("_vector_score")
        hybrid_score = m.get("_hybrid_score")
        memory_id    = m.get("id", "")
        confidence   = float(m.get("confidence") or 0.0)
        importance   = int(m.get("importance") or 0)
        category     = m.get("category", "")
        memory_type  = m.get("memory_type", "")

        def _warn(reason: str, severity: str) -> None:
            warnings.append({
                "memory_id":   memory_id,
                "reason":      reason,
                "severity":    severity,
                "source":      source,
                "vector_score": vector_score,
                "hybrid_score": hybrid_score,
                "query":       query,
            })

        # ── Rule 4.1: Weak vector-only selection (below gate — should be impossible) ──
        if source == "vector" and vector_score is not None and vector_score < BORDERLINE_LOWER:
            _warn("vector_only_below_gate", "high")

        # ── Rule 4.2: Borderline vector selection ─────────────────────────────────
        elif source == "vector" and vector_score is not None and \
                BORDERLINE_LOWER <= vector_score < BORDERLINE_UPPER:
            _warn("vector_only_borderline_score", "medium")

        # ── Rule 4.3: Low confidence selected (should be impossible) ─────────────
        if confidence < CONFIDENCE_INJECT_THRESHOLD:
            _warn("selected_low_confidence_memory", "high")

        # ── Rule 4.4: Low importance vector-only ──────────────────────────────────
        if source == "vector" and importance < 5:
            _warn("selected_low_importance_memory", "medium")

        # ── Rule 4.5: Over-dominant memory (requires store) ───────────────────────
        if store is not None and memory_id:
            try:
                count_rows = store.get_events(event_type="hybrid_scored")
                recent_selections = sum(
                    1 for e in count_rows
                    if e.get("payload_json") and memory_id in e["payload_json"]
                )
                if recent_selections >= 5:
                    _warn("possible_over_dominant_memory", "low")
            except Exception:
                pass

        # ── Rule 4.6: Cross-domain suspicion ─────────────────────────────────────
        if (source == "vector"
                and vector_score is not None
                and vector_score < 0.70
                and memory_type in _NON_TECHNICAL_TYPES
                and _is_technical_query(query)):
            _warn("possible_cross_domain_vector_pick", "low")

    return warnings
