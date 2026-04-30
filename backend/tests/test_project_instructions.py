from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.prompt.assembly import assemble_prompt
from nidavellir.prompt.models import PromptSection
from nidavellir.project_instructions.discovery import discover_project_instructions
from nidavellir.skills.store import SkillStore
from nidavellir.tokens.store import TokenUsageStore


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


def test_provider_specific_instruction_file_wins_duplicate_for_codex(tmp_path: Path):
    (tmp_path / "NIDAVELLIR.md").write_text("# NIDAVELLIR.md\nShared rules", encoding="utf-8")
    (tmp_path / "AGENTS.md").write_text("# AGENTS.md\nShared rules", encoding="utf-8")
    (tmp_path / "CLAUDE.md").write_text("Claude-only rules", encoding="utf-8")

    result = discover_project_instructions(cwd=tmp_path, provider="codex")

    assert [item.name for item in result.instructions] == ["AGENTS.md"]
    assert result.instructions[0].content.endswith("Shared rules")
    suppressed = {item.name: item.reason for item in result.suppressed}
    assert suppressed["NIDAVELLIR.md"] == "duplicate_content"
    assert suppressed["CLAUDE.md"] == "provider_mismatch"


def test_provider_specific_instruction_layers_after_shared_content(tmp_path: Path):
    (tmp_path / "PROJECT.md").write_text("Generic project rules", encoding="utf-8")
    (tmp_path / "NIDAVELLIR.md").write_text("Shared Nidavellir rules", encoding="utf-8")
    (tmp_path / "CLAUDE.md").write_text("Claude refinement", encoding="utf-8")
    (tmp_path / "AGENTS.md").write_text("Codex refinement", encoding="utf-8")

    result = discover_project_instructions(cwd=tmp_path, provider="claude")

    assert [item.name for item in result.instructions] == ["PROJECT.md", "NIDAVELLIR.md", "CLAUDE.md"]
    assert "AGENTS.md" not in [item.name for item in result.instructions]
    assert result.rendered_text.index("Generic project rules") < result.rendered_text.index("Shared Nidavellir rules")
    assert result.rendered_text.index("Shared Nidavellir rules") < result.rendered_text.index("Claude refinement")


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


def _setup_app(tmp_path: Path):
    app.state.memory_store = MemoryStore(str(tmp_path / "memory.db"))
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    app.state.skill_store = SkillStore(str(tmp_path / "skills.db"))
    app.state.permission_evaluator = PermissionEvaluator()
    app.state.permission_audit_store = PermissionAuditStore(str(tmp_path / "permissions.db"))


@pytest.mark.asyncio
async def test_project_instruction_api_lists_and_writes_known_files(tmp_path: Path):
    _setup_app(tmp_path)
    workspace = tmp_path / "repo"
    workspace.mkdir()
    (workspace / "NIDAVELLIR.md").write_text("Shared rules", encoding="utf-8")
    (workspace / "AGENTS.md").write_text("Codex rules", encoding="utf-8")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        listed = await c.get("/api/project-instructions", params={"workspace": str(workspace), "provider": "codex"})
        assert listed.status_code == 200
        body = listed.json()
        assert body["workspace"] == str(workspace)
        assert [item["name"] for item in body["instructions"]] == ["NIDAVELLIR.md", "AGENTS.md"]
        assert len(body["editableFiles"]) == 4

        saved = await c.put("/api/project-instructions", json={
            "workspace": str(workspace),
            "filename": "PROJECT.md",
            "content": "Project rules",
            "provider": "codex",
        })
        assert saved.status_code == 200
        assert (workspace / "PROJECT.md").read_text(encoding="utf-8") == "Project rules"
        assert any(item["name"] == "PROJECT.md" for item in saved.json()["instructions"])

        audit = await c.get("/api/permissions/audit")
        assert audit.json()[0]["action"] == "file_write"


@pytest.mark.asyncio
async def test_project_instruction_api_rejects_unknown_filename(tmp_path: Path):
    _setup_app(tmp_path)
    workspace = tmp_path / "repo"
    workspace.mkdir()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        saved = await c.put("/api/project-instructions", json={
            "workspace": str(workspace),
            "filename": "../README.md",
            "content": "Bad",
        })
        assert saved.status_code == 400
        assert saved.json()["detail"] == "unsupported_instruction_file"


@pytest.mark.asyncio
async def test_project_instruction_write_supports_allow_once_permission_override(tmp_path: Path, monkeypatch):
    _setup_app(tmp_path)
    workspace = tmp_path / "repo"
    workspace.mkdir()

    from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationResult

    class AskingEvaluator:
        def evaluate(self, request):
            return PermissionEvaluationResult(
                action=request.action,
                decision=PermissionDecision.ASK,
                reason="test requires approval",
                path=request.path,
                normalized_path=request.path,
                matched_rule="test_rule",
                requires_user_choice=True,
            )

    app.state.permission_evaluator = AskingEvaluator()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        blocked = await c.put("/api/project-instructions", json={
            "workspace": str(workspace),
            "filename": "NIDAVELLIR.md",
            "content": "Blocked until approved",
        })
        assert blocked.status_code == 403
        assert not (workspace / "NIDAVELLIR.md").exists()

        allowed = await c.put("/api/project-instructions", json={
            "workspace": str(workspace),
            "filename": "NIDAVELLIR.md",
            "content": "Allowed once",
            "permissionOverride": "allow_once",
        })
        assert allowed.status_code == 200
        assert (workspace / "NIDAVELLIR.md").read_text(encoding="utf-8") == "Allowed once"

        audit = await c.get("/api/permissions/audit")
        decisions = [event["decision"] for event in audit.json()]
        assert "allow_once" in decisions
        assert "ask" in decisions
