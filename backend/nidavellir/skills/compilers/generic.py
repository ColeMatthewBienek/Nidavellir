from __future__ import annotations

from .base import SkillCompileResult
from ..activation import estimate_skill_tokens
from ..models import NidavellirSkill


class GenericSkillCompiler:
    def compile(self, skills: list[NidavellirSkill], *, suppressed: list[dict] | None = None) -> SkillCompileResult:
        enabled = [skill for skill in skills if skill.enabled]
        enabled.sort(key=lambda skill: (-skill.priority, skill.slug))
        if not enabled:
            return SkillCompileResult(
                prompt_fragment="",
                injected_skill_ids=[],
                suppressed=suppressed or [],
                estimated_tokens=0,
            )

        parts = ["## Activated Skills"]
        for skill in enabled:
            parts.append(f"### {skill.name}")
            parts.append(f"Skill ID: {skill.id}")
            if skill.description:
                parts.append(f"Purpose:\n{skill.description}")
            parts.append(f"Instructions:\n{skill.instructions.core.strip()}")
            if skill.instructions.constraints:
                parts.append("Constraints:")
                parts.extend(f"- {item}" for item in skill.instructions.constraints)
            if skill.instructions.steps:
                parts.append("Steps:")
                parts.extend(f"{idx}. {item}" for idx, item in enumerate(skill.instructions.steps, start=1))
            if skill.instructions.anti_patterns:
                parts.append("Anti-Patterns:")
                parts.extend(f"- {item}" for item in skill.instructions.anti_patterns)

        fragment = "\n\n".join(parts).strip()
        return SkillCompileResult(
            prompt_fragment=fragment,
            injected_skill_ids=[skill.id for skill in enabled],
            suppressed=suppressed or [],
            estimated_tokens=sum(estimate_skill_tokens(skill) for skill in enabled),
        )
