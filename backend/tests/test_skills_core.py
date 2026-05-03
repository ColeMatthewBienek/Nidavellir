from __future__ import annotations

import sqlite3

import pytest
from pydantic import ValidationError

from nidavellir.skills.activation import activate_skills
from nidavellir.skills.builtin import ensure_builtin_skills
from nidavellir.skills.compilers.generic import GenericSkillCompiler
from nidavellir.skills.compatibility import compatibility_for_skill
from nidavellir.skills.models import (
    NidavellirSkill,
    SkillActivationMode,
    SkillCapabilityRequirements,
    SkillInstructions,
    SkillScope,
    SkillSource,
    SkillSourceFormat,
    SkillStatus,
    SkillTaskContext,
    SkillTrigger,
    SkillTriggerType,
)
from nidavellir.skills.store import SkillStore
from nidavellir.skills.validator import validate_skill


def make_skill(**overrides) -> NidavellirSkill:
    data = {
        "id": "skill-review",
        "slug": "reviewer",
        "name": "Reviewer",
        "description": "Reviews code.",
        "scope": SkillScope.GLOBAL,
        "activation_mode": SkillActivationMode.AUTOMATIC,
        "triggers": [SkillTrigger(type=SkillTriggerType.KEYWORD, value="review", weight=1.0)],
        "instructions": SkillInstructions(core="Review the work carefully.", constraints=["Be specific."]),
        "required_capabilities": SkillCapabilityRequirements(file_read=True),
        "priority": 50,
        "enabled": False,
        "status": SkillStatus.VALIDATED,
        "source": SkillSource(format=SkillSourceFormat.NATIVE, origin="test"),
    }
    data.update(overrides)
    return NidavellirSkill(**data)


def test_skill_model_defaults_enabled_false_and_status_has_no_enabled_disabled():
    skill = make_skill(enabled=False)
    assert skill.enabled is False
    assert "enabled" not in {s.value for s in SkillStatus}
    assert "disabled" not in {s.value for s in SkillStatus}


def test_skill_model_rejects_missing_name_missing_core_invalid_priority_and_trigger():
    with pytest.raises(ValidationError):
        make_skill(name="")
    with pytest.raises(ValidationError):
        make_skill(instructions=SkillInstructions(core=""))
    with pytest.raises(ValidationError):
        make_skill(priority=101)
    with pytest.raises(ValidationError):
        make_skill(triggers=[{"type": "nonsense", "value": "x"}])


def test_validator_distinguishes_automatic_from_manual_no_trigger_skills():
    auto = make_skill(triggers=[])
    manual = make_skill(activation_mode=SkillActivationMode.MANUAL, triggers=[])

    assert validate_skill(auto).ok is False
    assert any(d.code == "automatic_skill_requires_trigger" for d in validate_skill(auto).diagnostics)
    assert validate_skill(manual).ok is True


def test_validator_flags_secret_looking_and_dangerous_content_without_mutating():
    skill = make_skill(instructions=SkillInstructions(
        core="Use API_KEY=abc123 and run rm -rf / if blocked.",
    ))
    before = skill.model_dump()

    report = validate_skill(skill)

    assert skill.model_dump() == before
    assert any(d.code == "secret_like_content" for d in report.diagnostics)
    assert any(d.code == "dangerous_instruction" for d in report.diagnostics)


def test_provider_compatibility_maps_manifest_capabilities():
    vision = make_skill(required_capabilities=SkillCapabilityRequirements(vision=True))
    file_write = make_skill(required_capabilities=SkillCapabilityRequirements(file_write=True))
    shell = make_skill(required_capabilities=SkillCapabilityRequirements(shell=True))
    network = make_skill(required_capabilities=SkillCapabilityRequirements(network=True))

    assert compatibility_for_skill(vision, "claude").status == "compatible"
    assert compatibility_for_skill(vision, "codex").status in {"degraded", "unsupported"}
    assert compatibility_for_skill(file_write, "codex", model="gpt-5.5").status == "compatible"
    assert compatibility_for_skill(shell, "ollama").status == "degraded"
    assert compatibility_for_skill(network, "ollama").status == "degraded"


def test_skill_store_persists_versions_enablement_and_activation_logs(tmp_path):
    store = SkillStore(str(tmp_path / "skills.db"))
    skill = make_skill()

    stored = store.create_skill(skill, change_reason="initial")
    loaded = store.get_skill(skill.id)
    assert loaded == stored
    assert loaded.model_dump(exclude={"created_at", "updated_at"}) == skill.model_dump(exclude={"created_at", "updated_at"})
    assert store.list_skills()[0].id == skill.id

    store.set_enabled(skill.id, True)
    assert store.get_skill(skill.id).enabled is True

    store.set_show_in_slash(skill.id, True)
    assert store.get_skill(skill.id).show_in_slash is True

    with pytest.raises(sqlite3.IntegrityError):
        store.create_skill(make_skill(id="other", slug=skill.slug))

    store.log_activation(
        skill_id=skill.id,
        conversation_id="conv",
        session_id="sess",
        provider="codex",
        model="gpt-5.5",
        trigger_reason="keyword: review",
        score=42,
        matched_triggers=["keyword:review"],
        compatibility_status="compatible",
        diagnostics=[],
        token_estimate=20,
        injected=True,
    )
    assert store.list_activations()[0]["skill_id"] == skill.id


def test_builtin_humanspeak_replaces_verbose_imported_skill(tmp_path):
    store = SkillStore(str(tmp_path / "skills.db"))
    old = make_skill(
        id="humanizer-remove-ai-writing-patterns",
        slug="humanspeak",
        name="Humanspeak: remove AI writing patterns",
        activation_mode=SkillActivationMode.MANUAL,
        triggers=[],
        instructions=SkillInstructions(core="**Draft rewrite:**\n\n**What makes this AI-generated:**"),
        enabled=True,
        show_in_slash=True,
    )
    store.create_skill(old)

    ensure_builtin_skills(store)

    updated = store.get_skill(old.id)
    assert updated is not None
    assert updated.slug == "humanspeak"
    assert updated.name == "Humanspeak"
    assert updated.enabled is True
    assert updated.show_in_slash is True
    assert "Output only the rewritten text." in updated.instructions.core
    assert "Draft rewrite" not in updated.instructions.core
    assert "~/.claude/commands" in updated.instructions.core


def test_activation_engine_is_deterministic_and_respects_enabled_mode_compatibility_budget():
    enabled = make_skill(enabled=True, priority=80)
    disabled = make_skill(id="disabled", slug="disabled", enabled=False)
    manual = make_skill(
        id="manual",
        slug="manual",
        enabled=True,
        activation_mode=SkillActivationMode.MANUAL,
        triggers=[],
        priority=100,
    )
    unsupported = make_skill(
        id="vision",
        slug="vision",
        enabled=True,
        required_capabilities=SkillCapabilityRequirements(vision=True),
        triggers=[SkillTrigger(type=SkillTriggerType.KEYWORD, value="review")],
    )
    context = SkillTaskContext(user_message="please review this", provider="codex", model="gpt-5.5")

    result = activate_skills([manual, disabled, unsupported, enabled], context, usable_context_tokens=2000)

    assert [s.id for s in result.activated] == [enabled.id]
    assert any(s.skill_id == disabled.id and s.reason == "disabled" for s in result.suppressed)
    assert any(s.skill_id == manual.id and s.reason == "manual_not_requested" for s in result.suppressed)
    assert any(s.skill_id == unsupported.id and s.reason == "unsupported" for s in result.suppressed)
    assert result.logs[0].score > 0
    assert result.logs[0].matched_triggers


def test_manual_skill_activates_from_slash_invocation():
    manual = make_skill(
        id="strict-tdd-builder",
        slug="strict-tdd-builder",
        name="Strict TDD Builder",
        enabled=True,
        activation_mode=SkillActivationMode.MANUAL,
        triggers=[],
        priority=90,
    )
    context = SkillTaskContext(
        user_message="/skill strict-tdd-builder Add buildMode to health.",
        provider="codex",
        model="gpt-5.5",
    )

    result = activate_skills([manual], context, usable_context_tokens=2000)

    assert [skill.id for skill in result.activated] == ["strict-tdd-builder"]
    assert result.logs[0].matched_triggers == ["explicit:strict-tdd-builder"]


def test_generic_compiler_renders_active_skills_and_suppressed_records():
    skill = make_skill(enabled=True)
    result = GenericSkillCompiler().compile([skill], suppressed=[{"skill_id": "x", "reason": "disabled"}])

    assert "## Activated Skills" in result.prompt_fragment
    assert "### Reviewer" in result.prompt_fragment
    assert "Skill ID: skill-review" in result.prompt_fragment
    assert result.injected_skill_ids == ["skill-review"]
    assert result.suppressed == [{"skill_id": "x", "reason": "disabled"}]
    assert result.estimated_tokens > 0
