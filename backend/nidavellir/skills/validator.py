from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel

from .models import NidavellirSkill, SkillActivationMode


class SkillValidationDiagnostic(BaseModel):
    level: Literal["error", "warning", "info"]
    code: str
    message: str
    field: str | None = None


class SkillValidationReport(BaseModel):
    ok: bool
    diagnostics: list[SkillValidationDiagnostic]


SECRET_RE = re.compile(r"\b(?:api[_-]?key|secret|token|password)\s*=", re.I)
DANGEROUS_RE = re.compile(r"\brm\s+-rf\s+/|format\s+[a-z]:|del\s+/s\b", re.I)


def validate_skill(skill: NidavellirSkill) -> SkillValidationReport:
    diagnostics: list[SkillValidationDiagnostic] = []
    core = skill.instructions.core.strip()

    if not core:
        diagnostics.append(SkillValidationDiagnostic(
            level="error",
            code="empty_core_instruction",
            message="Skill core instructions must not be empty.",
            field="instructions.core",
        ))

    if skill.activation_mode == SkillActivationMode.AUTOMATIC and not skill.triggers:
        diagnostics.append(SkillValidationDiagnostic(
            level="error",
            code="automatic_skill_requires_trigger",
            message="Automatic skills require at least one deterministic trigger.",
            field="triggers",
        ))

    full_text = "\n".join([
        skill.name,
        skill.description,
        core,
        "\n".join(skill.instructions.constraints),
        "\n".join(skill.instructions.steps),
        "\n".join(skill.instructions.anti_patterns),
    ])
    if SECRET_RE.search(full_text):
        diagnostics.append(SkillValidationDiagnostic(
            level="warning",
            code="secret_like_content",
            message="Skill content appears to contain a secret-like assignment.",
            field="instructions",
        ))
    if DANGEROUS_RE.search(full_text):
        diagnostics.append(SkillValidationDiagnostic(
            level="error",
            code="dangerous_instruction",
            message="Skill content contains a dangerous executable instruction.",
            field="instructions",
        ))

    return SkillValidationReport(
        ok=not any(d.level == "error" for d in diagnostics),
        diagnostics=diagnostics,
    )
