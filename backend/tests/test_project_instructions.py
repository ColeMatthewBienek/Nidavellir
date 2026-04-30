from __future__ import annotations

from pathlib import Path

from nidavellir.prompt.assembly import assemble_prompt
from nidavellir.prompt.models import PromptSection
from nidavellir.project_instructions.discovery import discover_project_instructions


def test_discovers_global_root_and_child_project_instructions_in_stable_order(tmp_path: Path):
    agent_dir = tmp_path / "agent"
    root = tmp_path / "repo"
    child = root / "src" / "feature"
    agent_dir.mkdir()
    child.mkdir(parents=True)
    (agent_dir / "AGENTS.md").write_text("Global rules", encoding="utf-8")
    (root / "NIDAVELLIR.md").write_text("Repo rules", encoding="utf-8")
    (child / "AGENTS.md").write_text("Feature rules", encoding="utf-8")

    result = discover_project_instructions(cwd=child, agent_dir=agent_dir)

    assert [item.name for item in result.instructions] == ["AGENTS.md", "NIDAVELLIR.md", "AGENTS.md"]
    assert [item.content for item in result.instructions] == ["Global rules", "Repo rules", "Feature rules"]
    assert result.rendered_text.index("Global rules") < result.rendered_text.index("Repo rules")
    assert result.rendered_text.index("Repo rules") < result.rendered_text.index("Feature rules")
    assert result.token_estimate > 0


def test_project_instructions_precede_conversation_context_in_prompt_order():
    result = assemble_prompt([
        PromptSection(name="conversation/session context", content="History", source="conversation"),
        PromptSection(name="project instructions", content="Repo rules", source="project_instructions"),
        PromptSection(name="user message", content="Do it", source="user"),
    ])

    assert result.rendered_text.index("## Project Instructions") < result.rendered_text.index("## Conversation/Session Context")
    assert result.rendered_text.index("## Conversation/Session Context") < result.rendered_text.index("## User Message")


def test_ws_prompt_assembly_injects_project_instructions_as_separate_section(tmp_path: Path):
    from nidavellir.routers.ws import _build_prompt_assembly

    (tmp_path / "NIDAVELLIR.md").write_text("Use strict project conventions.", encoding="utf-8")

    class Store:
        def list_conversation_files(self, conversation_id: str):
            return []

    assembly = _build_prompt_assembly(
        store=Store(),
        skill_store=None,
        conversation_id="conv",
        provider_id="codex",
        model_id="gpt-5.5",
        current_content="Change the thing",
        memory_context="Prior context",
        workdir=tmp_path,
    )

    assert "## Project Instructions" in assembly.rendered_text
    assert "Use strict project conventions." in assembly.rendered_text
    assert assembly.rendered_text.index("## Project Instructions") < assembly.rendered_text.index("## Conversation/Session Context")
    assert assembly.rendered_text.index("## Project Instructions") < assembly.rendered_text.index("## User Message")
