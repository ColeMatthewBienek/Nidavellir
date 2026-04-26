from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, UTC

# ── Confidence thresholds ─────────────────────────────────────────────────────

CONFIDENCE_STORE_THRESHOLD  = 0.50
CONFIDENCE_INJECT_THRESHOLD = 0.70
CONFIDENCE_HIGH_THRESHOLD   = 0.85

# ── Budget limits ─────────────────────────────────────────────────────────────

CONTEXT_BUDGET_CHARS       = 4000
MAX_MEMORIES_PER_CATEGORY  = 5
MAX_TOTAL_MEMORIES         = 12

# ── Type priority ─────────────────────────────────────────────────────────────

HIGH_PRIORITY_TYPES = {"warning", "procedure"}
LOW_PRIORITY_TYPES  = {"tool_result"}

# ── Decay half-lives (days) ───────────────────────────────────────────────────

DECAY_RATES: dict[str, int] = {
    "decision":     14,
    "task":          7,
    "fact":         60,
    "preference":   90,
    "procedure":    45,
    "warning":      30,
    "relationship": 120,
    "tool_result":   3,
}


def compute_final_score(
    relevance_score: float | None,
    importance: int,
    scope_boost: float,
    memory_type: str,
    created_at: str,
    use_count: int,
) -> float:
    try:
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
    except Exception:
        created = datetime.now(UTC)

    age_days  = max(0, (datetime.now(UTC) - created).days)
    half_life = DECAY_RATES.get(memory_type, 30)
    decay     = math.exp(-0.693 * age_days / half_life)

    relevance_boost  = -relevance_score if relevance_score is not None else 0.0
    importance_boost = importance / 10.0
    use_boost        = min(use_count / 20.0, 0.5)

    return (
        relevance_boost * 2.0
        + importance_boost
        + scope_boost
        + use_boost
        + decay
    )


@dataclass
class ContextPack:
    memories:     list[dict] = field(default_factory=list)
    total_chars:  int        = 0
    budget_chars: int        = CONTEXT_BUDGET_CHARS
    truncated:    bool       = False

    def try_add(self, memory: dict) -> bool:
        chars = len(memory.get("content", ""))
        if self.total_chars + chars > self.budget_chars:
            self.truncated = True
            return False
        if len(self.memories) >= MAX_TOTAL_MEMORIES:
            self.truncated = True
            return False
        cat       = memory.get("category", "thought")
        cat_count = sum(1 for m in self.memories if m.get("category") == cat)
        if cat_count >= MAX_MEMORIES_PER_CATEGORY:
            return False
        self.memories.append(memory)
        self.total_chars += chars
        return True

    def to_prefix(self) -> str:
        if not self.memories:
            return ""

        labels = {
            "decision":   "Decisions Made",
            "preference": "User Preferences",
            "project":    "Project Context",
            "insight":    "Lessons Learned",
            "person":     "People & Relationships",
            "task":       "Ongoing Tasks",
            "thought":    "Notes",
        }

        lines = [
            "## Memory Context\n",
            "The following is relevant context from previous sessions:\n",
        ]

        by_cat: dict[str, list[dict]] = {}
        for memory in self.memories:
            by_cat.setdefault(memory.get("category", "thought"), []).append(memory)

        for cat, label in labels.items():
            if cat not in by_cat:
                continue
            lines.append(f"**{label}:**")
            for memory in by_cat[cat]:
                lines.append(f"- {memory['content']}")
            lines.append("")

        if self.truncated:
            lines.append("*(additional context omitted — budget limit reached)*\n")

        lines.append("---\n")
        return "\n".join(lines)
