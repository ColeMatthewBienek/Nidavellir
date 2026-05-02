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


def ensure_builtin_skills(store: SkillStore) -> None:
    if store.get_skill(SKILL_BUILDER_ID) is not None:
        return
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
