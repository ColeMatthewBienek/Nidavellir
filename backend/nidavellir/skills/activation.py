from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass

from pydantic import BaseModel, Field

from .compatibility import compatibility_for_skill
from .models import NidavellirSkill, SkillActivationMode, SkillTaskContext, SkillTriggerType


class SkillActivationLog(BaseModel):
    skill_id: str
    score: float
    matched_triggers: list[str]
    compatibility_status: str
    injected: bool
    reason: str
    token_estimate: int


class SuppressedSkill(BaseModel):
    skill_id: str
    reason: str
    score: float = 0
    matched_triggers: list[str] = Field(default_factory=list)


class SkillActivationResult(BaseModel):
    activated: list[NidavellirSkill]
    suppressed: list[SuppressedSkill]
    logs: list[SkillActivationLog]


TRIGGER_SPECIFICITY = {
    SkillTriggerType.EXPLICIT_USER_REQUEST: 7,
    SkillTriggerType.FILE_PATTERN: 6,
    SkillTriggerType.REPO: 5,
    SkillTriggerType.AGENT_ROLE: 4,
    SkillTriggerType.KEYWORD: 3,
    SkillTriggerType.INTENT: 2,
    SkillTriggerType.CONVERSATION_CONTEXT: 1,
}


@dataclass
class _Candidate:
    skill: NidavellirSkill
    score: float
    matched: list[str]
    compatibility_status: str
    token_estimate: int


def estimate_skill_tokens(skill: NidavellirSkill) -> int:
    text = "\n".join([
        skill.name,
        skill.description,
        skill.instructions.core,
        "\n".join(skill.instructions.constraints),
        "\n".join(skill.instructions.steps),
        "\n".join(skill.instructions.anti_patterns),
    ])
    return max(1, len(text) // 4)


def _explicitly_requested(skill: NidavellirSkill, message: str) -> bool:
    msg = message.lower()
    slug = re.escape(skill.slug.lower())
    slash_requested = re.search(rf"(?:^|\s)/skill\s+{slug}(?:\s|$)", msg) is not None
    direct_slash_requested = re.search(rf"(?:^|\s)/{slug}(?:\s|$)", msg) is not None
    return (
        slash_requested
        or direct_slash_requested
        or skill.slug.lower() in msg
        or skill.name.lower() in msg
        or f"skill:{skill.slug.lower()}" in msg
    )


def _score_skill(skill: NidavellirSkill, context: SkillTaskContext) -> tuple[float, list[str]]:
    msg = context.user_message.lower()
    score = 0.0
    matched: list[str] = []
    if _explicitly_requested(skill, msg):
        score += 100
        matched.append(f"explicit:{skill.slug}")

    for trigger in skill.triggers:
        value = trigger.value.lower()
        if trigger.type == SkillTriggerType.KEYWORD and value in msg:
            score += trigger.weight * 20
            matched.append(f"keyword:{trigger.value}")
        elif trigger.type == SkillTriggerType.INTENT and value in msg:
            score += trigger.weight * 15
            matched.append(f"intent:{trigger.value}")
        elif trigger.type == SkillTriggerType.EXPLICIT_USER_REQUEST and value in msg:
            score += 100
            matched.append(f"explicit_user_request:{trigger.value}")
        elif trigger.type == SkillTriggerType.FILE_PATTERN:
            if any(fnmatch.fnmatch(path.lower(), value) for path in context.selected_files):
                score += trigger.weight * 15
                matched.append(f"file_pattern:{trigger.value}")
        elif trigger.type == SkillTriggerType.REPO and context.repo_path and value in context.repo_path.lower():
            score += trigger.weight * 10
            matched.append(f"repo:{trigger.value}")
        elif trigger.type == SkillTriggerType.AGENT_ROLE and value in context.provider.lower():
            score += trigger.weight * 10
            matched.append(f"agent_role:{trigger.value}")
        elif trigger.type == SkillTriggerType.CONVERSATION_CONTEXT and value in msg:
            score += trigger.weight * 5
            matched.append(f"conversation_context:{trigger.value}")

    if matched:
        score += skill.priority / 10
    return score, matched


def _sort_key(candidate: _Candidate) -> tuple:
    specificity = 0
    for trigger in candidate.skill.triggers:
        if any(item.endswith(f":{trigger.value}") for item in candidate.matched):
            specificity = max(specificity, TRIGGER_SPECIFICITY.get(trigger.type, 0))
    return (-candidate.score, -candidate.skill.priority, -specificity, -(candidate.skill.updated_at is not None), candidate.skill.slug)


def activate_skills(
    skills: list[NidavellirSkill],
    context: SkillTaskContext,
    *,
    usable_context_tokens: int = 120_000,
    max_skills: int = 5,
) -> SkillActivationResult:
    candidates: list[_Candidate] = []
    suppressed: list[SuppressedSkill] = []
    logs: list[SkillActivationLog] = []
    budget = max(1, int(usable_context_tokens * 0.10))

    for skill in skills:
        token_estimate = estimate_skill_tokens(skill)
        if not skill.enabled:
            suppressed.append(SuppressedSkill(skill_id=skill.id, reason="disabled"))
            continue

        score, matched = _score_skill(skill, context)
        explicit = any(m.startswith("explicit") for m in matched)
        if skill.activation_mode in {SkillActivationMode.MANUAL, SkillActivationMode.EXPLICIT_ONLY} and not explicit:
            suppressed.append(SuppressedSkill(skill_id=skill.id, reason="manual_not_requested", score=score, matched_triggers=matched))
            continue
        if score <= 0:
            suppressed.append(SuppressedSkill(skill_id=skill.id, reason="no_trigger_match", score=score, matched_triggers=matched))
            continue

        compat = compatibility_for_skill(skill, context.provider, context.model)
        if compat.status == "unsupported":
            suppressed.append(SuppressedSkill(skill_id=skill.id, reason="unsupported", score=score, matched_triggers=matched))
            continue
        score += 10 if compat.status == "compatible" else -10
        candidates.append(_Candidate(skill=skill, score=score, matched=matched, compatibility_status=compat.status, token_estimate=token_estimate))

    activated: list[NidavellirSkill] = []
    spent = 0
    for candidate in sorted(candidates, key=_sort_key):
        if len(activated) >= max_skills:
            suppressed.append(SuppressedSkill(skill_id=candidate.skill.id, reason="max_skills_exceeded", score=candidate.score, matched_triggers=candidate.matched))
            continue
        if spent + candidate.token_estimate > budget:
            suppressed.append(SuppressedSkill(skill_id=candidate.skill.id, reason="token_budget_exceeded", score=candidate.score, matched_triggers=candidate.matched))
            continue
        spent += candidate.token_estimate
        activated.append(candidate.skill)
        logs.append(SkillActivationLog(
            skill_id=candidate.skill.id,
            score=candidate.score,
            matched_triggers=candidate.matched,
            compatibility_status=candidate.compatibility_status,
            injected=True,
            reason=", ".join(candidate.matched),
            token_estimate=candidate.token_estimate,
        ))

    return SkillActivationResult(activated=activated, suppressed=suppressed, logs=logs)
