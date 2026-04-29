from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from nidavellir.agents.registry import PROVIDER_REGISTRY

from .models import NidavellirSkill, SkillCapabilityRequirements


class SkillCompatibilityReport(BaseModel):
    skill_id: str
    provider: str
    model: str | None = None
    status: Literal["compatible", "degraded", "unsupported"]
    reasons: list[str]
    required_capabilities: SkillCapabilityRequirements
    missing_capabilities: list[str]


def compatibility_for_skill(skill: NidavellirSkill, provider: str, model: str | None = None) -> SkillCompatibilityReport:
    manifest = PROVIDER_REGISTRY.get(provider)
    req = skill.required_capabilities
    reasons: list[str] = []
    missing: list[str] = []
    degraded: list[str] = []

    if manifest is None:
        return SkillCompatibilityReport(
            skill_id=skill.id,
            provider=provider,
            model=model,
            status="unsupported",
            reasons=["unknown provider"],
            required_capabilities=req,
            missing_capabilities=["provider"],
        )

    checks = [
        ("vision", req.vision, manifest.supports_image_input, "unsupported"),
        ("file_read", req.file_read, manifest.supports_file_context, "unsupported"),
        ("file_write", req.file_write, manifest.supports_file_write, "unsupported"),
        ("shell", req.shell, manifest.supports_bash_execution, "degraded"),
        ("code_execution", req.code_execution, manifest.supports_bash_execution, "degraded"),
        ("browser", req.browser, False, "degraded"),
        ("network", req.network, manifest.requires_network, "degraded"),
        ("long_context", req.long_context, False, "degraded"),
    ]
    hard_unsupported = False
    for name, required, supported, severity in checks:
        if not required:
            continue
        if supported:
            reasons.append(f"{name} supported by {provider}")
            continue
        missing.append(name)
        if severity == "unsupported":
            hard_unsupported = True
        else:
            degraded.append(name)
        reasons.append(f"{name} not advertised by {provider}")

    if hard_unsupported:
        status: Literal["compatible", "degraded", "unsupported"] = "unsupported"
    elif degraded or missing:
        status = "degraded"
    else:
        status = "compatible"
        if not reasons:
            reasons.append("no special capabilities required")

    return SkillCompatibilityReport(
        skill_id=skill.id,
        provider=provider,
        model=model,
        status=status,
        reasons=reasons,
        required_capabilities=req,
        missing_capabilities=missing,
    )
