from __future__ import annotations

from .models import (
    NidavellirSkill,
    SkillActivationMode,
    SkillCapabilityRequirements,
    SkillInstructions,
    SkillScope,
    SkillSource,
    SkillSourceFormat,
    SkillStatus,
    SkillTrigger,
)
from .store import SkillStore

SKILL_BUILDER_ID = "skill-builder"
HUMANSPEAK_SLUG = "humanspeak"
PLANNER_PM_SLUG = "planner-pm"

SKILL_BUILDER_MARKDOWN = """---
name: skill-builder
description: Help the user design, tune, validate, and add a Nidavellir skill to the skill inventory. Use when the user wants to create, rewrite, import, configure, enable, or expose a skill in the slash menu.
---

# Skill Builder

Use this skill to help the user create or refine a Nidavellir skill.

## Workflow

1. Clarify the skill's purpose, target tasks, and when it should activate.
2. Identify whether the skill should be global or project scoped.
3. Decide activation mode:
   - `manual`: invoked by slash command or explicit request.
   - `automatic`: can activate from configured triggers.
   - `explicit_only`: only activates when directly requested.
4. Decide whether it should be enabled immediately.
5. Decide whether it should appear in the slash menu.
6. Draft a concise `SKILL.md` with YAML frontmatter and only essential instructions.
7. Check for over-broad triggers, unsafe instructions, bloated examples, and duplicated guidance.
8. After the user approves the final skill, add it to the Nidavellir inventory when tool access allows it.

## Intake

Ask only for missing information:

- skill name
- what the skill helps with
- examples of user requests that should trigger it
- scope: global or project
- activation mode
- slash command slug
- show in slash menu: yes/no
- enable immediately: yes/no
- capabilities or safety boundaries

## Output

When ready, output:

1. A short rationale.
2. A fenced `json` block containing final settings.
3. A fenced `markdown` block containing the complete `SKILL.md`. If the skill contains code fences, wrap the whole `SKILL.md` in a four-backtick ````markdown fence.

Use this exact settings shape:

```json
{
  "name": "Skill Name",
  "slug": "skill-slug",
  "scope": "global",
  "activationMode": "manual",
  "triggers": [],
  "enabled": true,
  "showInSlash": true
}
```

Keep the generated skill concise. Do not include implementation notes, changelogs, or auxiliary documentation unless the user explicitly asks for them.

## Add To Inventory

When the user approves creating the skill and the local Nidavellir API is available, add it with:

```bash
curl -sS -X POST http://localhost:7430/api/skills/import/markdown \
  -H 'Content-Type: application/json' \
  -d '{"name":"Skill Name","slug":"skill-slug","markdown":"...","scope":"global","activationMode":"manual","triggers":[],"enabled":true,"showInSlash":true}'
```

Use the exact final `SKILL.md` content as the `markdown` value. Apply the user's chosen flags. If the API is unavailable, provide the final markdown and settings for manual import.
"""

HUMANSPEAK_MARKDOWN = """---
name: humanspeak
description: Rewrite text so it sounds natural and human-written while preserving meaning exactly.
---

# Humanspeak

Rewrite the provided text so it reads like a human wrote it. Remove AI writing tells while preserving the original meaning, facts, level of certainty, and intended register.

This is a Nidavellir slash skill. Do not create, edit, reference, or remove provider-native command files such as `~/.claude/commands/*.md`, `CLAUDE.md`, or `AGENTS.md` unless the user explicitly asks to manage those files.

## Remove

- Filler openers such as "Certainly", "Great question", "Of course", and "I'd be happy to"
- Formulaic rewrite labels, change summaries, audit sections, or analysis headings
- Meta-commentary about the rewrite process
- Overused em dashes when commas, periods, or sentence splits are more natural
- Generic transitions such as "In conclusion", "To summarize", "That said", and "With that in mind"
- Inflated or over-formal wording when a plain word is more natural
- Unnecessary hedging, throat-clearing, and scaffolding
- Repetitive sentence cadence, rule-of-three phrasing, and tidy wrap-up language
- Added bold formatting, markdown section labels, or decorative structure

## Rules

- Output only the rewritten text.
- Do not include explanations, bullets, headings, labels, audit notes, or before/after commentary.
- Do not use bold or italic formatting unless it was present in the source and must be preserved.
- Do not summarize, expand, fact-check, soften, or intensify the source unless required for natural wording.
- Keep the original tone: casual stays casual, technical stays technical, formal stays formal.
- If the input is already clean, return it unchanged.
"""

PLANNER_PM_MARKDOWN = """---
name: planner-pm
description: Nidavellir's first-class planning PM for autonomous coding workflows. Use for turning rough user intent into an approved, agentic-forward spec and walking the user through deterministic planning gates.
---

# Planner PM

You are Nidavellir's Planner PM. Convert user intent into executable, testable, low-risk engineering work. You are a project manager, critic, and QA supervisor, not the default coding agent.

## Operating Principles

- Be clear, skeptical, concise, requirements-driven, evidence-oriented, and test-focused.
- Walk the user gate by gate. Do not ask generic "what else?" questions.
- Ask one focused clarification only when the next gate is blocked.
- Require evidence before marking progress complete.
- Preserve dirty worktrees and partial work; never discard them automatically.
- Merge only after explicit approval.

## Planning Gates

Advance gates only when deterministic evidence exists. The checkpoint rail is read-only status; users cannot manually certify gates.

1. Intake captured: raw goal and initial constraints exist.
2. Repo target clarified: repo path or new-project setup path, base branch or baseline strategy.
3. Scope agreed: in-scope outcomes and non-goals are explicit.
4. Acceptance agreed: testable acceptance criteria and user-visible success conditions.
5. Verification agreed: commands, smoke checks, screenshots, or review method.
6. Risks and dependencies agreed: ordering, migrations, credentials, destructive operations, autonomy guardrails.
7. Spec draft generated: decomposer-ready Markdown spec exists.
8. Spec approved: user approval exists after all required evidence exists.

## PM Turn Output

Each PM turn should produce a short user-facing message, the active gate, one focused question when blocked, proposed decisions or assumptions, proposed checkpoint updates with evidence references, and spec deltas when the spec should change.

Never mark a checkpoint complete because the user says "check it off". Identify the concrete message, repo fact, readiness report, spec section, or validation artifact that satisfies it.

## Supervision Boundary

The PM scopes, gates, supervises, validates, and reports. Coding agents implement only after approval and EM acceptance. Sandcastle-style runner mechanics are an execution substrate below the PM, not a replacement for the PM flow.
"""


def ensure_builtin_skills(store: SkillStore) -> None:
    if store.get_skill(SKILL_BUILDER_ID) is None:
        skill = NidavellirSkill(
            id=SKILL_BUILDER_ID,
            slug=SKILL_BUILDER_ID,
            name="Skill Builder",
            description="Design, tune, validate, and import Nidavellir skills.",
            scope=SkillScope.GLOBAL,
            activation_mode=SkillActivationMode.MANUAL,
            triggers=[SkillTrigger(type="keyword", value="build skill", weight=1.0)],
            instructions=SkillInstructions(core=SKILL_BUILDER_MARKDOWN),
            required_capabilities=SkillCapabilityRequirements(),
            priority=50,
            enabled=True,
            show_in_slash=True,
            version=1,
            status=SkillStatus.VALIDATED,
            source=SkillSource(format=SkillSourceFormat.NATIVE, origin="nidavellir", source_type="builtin"),
        )
        store.create_skill(skill, change_reason="builtin seed")
    _ensure_humanspeak_skill(store)
    _ensure_planner_pm_skill(store)


def _ensure_humanspeak_skill(store: SkillStore) -> None:
    existing = next((skill for skill in store.list_skills() if skill.slug == HUMANSPEAK_SLUG), None)
    if existing is None:
        skill = NidavellirSkill(
            id=HUMANSPEAK_SLUG,
            slug=HUMANSPEAK_SLUG,
            name="Humanspeak",
            description="Rewrite text so it sounds natural and human-written.",
            scope=SkillScope.GLOBAL,
            activation_mode=SkillActivationMode.MANUAL,
            triggers=[],
            instructions=SkillInstructions(core=HUMANSPEAK_MARKDOWN),
            required_capabilities=SkillCapabilityRequirements(),
            priority=50,
            enabled=True,
            show_in_slash=True,
            version=1,
            status=SkillStatus.VALIDATED,
            source=SkillSource(format=SkillSourceFormat.NATIVE, origin="nidavellir", source_type="builtin"),
        )
        store.create_skill(skill, change_reason="builtin seed")
        return
    if existing.instructions.core.strip() == HUMANSPEAK_MARKDOWN.strip():
        return
    store.update_skill_details(
        existing.id,
        name="Humanspeak",
        slug=HUMANSPEAK_SLUG,
        core_instructions=HUMANSPEAK_MARKDOWN,
        scope=existing.scope.value,
        activation_mode=SkillActivationMode.MANUAL.value,
        triggers=[],
    )


def _ensure_planner_pm_skill(store: SkillStore) -> None:
    existing = next((skill for skill in store.list_skills() if skill.slug == PLANNER_PM_SLUG), None)
    if existing is None:
        skill = NidavellirSkill(
            id=PLANNER_PM_SLUG,
            slug=PLANNER_PM_SLUG,
            name="Planner PM",
            description="Guide autonomous coding work through deterministic PM planning gates.",
            scope=SkillScope.AGENT_ROLE,
            activation_mode=SkillActivationMode.AUTOMATIC,
            triggers=[
                SkillTrigger(type="agent_role", value="planner_pm", weight=10.0),
                SkillTrigger(type="keyword", value="agentic-forward spec", weight=3.0),
            ],
            instructions=SkillInstructions(core=PLANNER_PM_MARKDOWN),
            required_capabilities=SkillCapabilityRequirements(long_context=True),
            priority=90,
            enabled=True,
            show_in_slash=True,
            version=1,
            status=SkillStatus.VALIDATED,
            source=SkillSource(format=SkillSourceFormat.NATIVE, origin="nidavellir", source_type="builtin"),
        )
        store.create_skill(skill, change_reason="builtin seed")
        return
    if existing.instructions.core.strip() == PLANNER_PM_MARKDOWN.strip():
        return
    store.update_skill_details(
        existing.id,
        name="Planner PM",
        slug=PLANNER_PM_SLUG,
        core_instructions=PLANNER_PM_MARKDOWN,
        scope=SkillScope.AGENT_ROLE.value,
        activation_mode=SkillActivationMode.AUTOMATIC.value,
        triggers=[
            {"type": "agent_role", "value": "planner_pm", "weight": 10.0},
            {"type": "keyword", "value": "agentic-forward spec", "weight": 3.0},
        ],
    )
