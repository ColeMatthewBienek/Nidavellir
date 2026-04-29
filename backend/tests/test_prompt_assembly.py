from __future__ import annotations

from nidavellir.prompt.assembly import assemble_prompt
from nidavellir.prompt.models import PromptSection


def test_prompt_sections_render_in_deterministic_order_and_preserve_metadata():
    result = assemble_prompt([
        PromptSection(name="user message", content="Do it", source="user", metadata={"id": "u1"}),
        PromptSection(name="memory retrieval", content="Remember X", source="memory"),
        PromptSection(name="system/app instructions", content="System", source="app"),
    ])

    assert result.rendered_text.index("System") < result.rendered_text.index("Remember X")
    assert result.rendered_text.index("Remember X") < result.rendered_text.index("Do it")
    user_section = next(section for section in result.sections if section.name == "user message")
    assert user_section.metadata == {"id": "u1"}


def test_empty_sections_are_omitted_and_skills_section_is_conditional():
    result = assemble_prompt([
        PromptSection(name="activated skills", content="", source="skills"),
        PromptSection(name="user message", content="Hello", source="user"),
    ])

    assert "Activated Skills" not in result.rendered_text
    assert "Hello" in result.rendered_text
    assert result.injected_skill_ids == []


def test_activated_skills_are_separate_from_user_message():
    result = assemble_prompt([
        PromptSection(
            name="activated skills",
            content="## Activated Skills\n\n### Reviewer",
            source="skills",
            metadata={"injected_skill_ids": ["reviewer"]},
        ),
        PromptSection(name="user message", content="Review this code", source="user"),
    ])

    assert "## Activated Skills" in result.rendered_text
    assert result.rendered_text.index("## Activated Skills") < result.rendered_text.index("## User Message")
    assert result.injected_skill_ids == ["reviewer"]
