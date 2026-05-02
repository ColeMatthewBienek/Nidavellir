from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.prompt.assembly import assemble_prompt
from nidavellir.prompt.models import PromptSection
from nidavellir.project_instructions.discovery import default_global_instruction_files, discover_project_instructions
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


def test_provider_globals_can_be_supplied_as_machine_wide_instruction_files(tmp_path: Path):
    globals_dir = tmp_path / "globals"
    workspace = tmp_path / "repo"
    globals_dir.mkdir()
    workspace.mkdir()
    (globals_dir / "AGENTS.md").write_text("Codex global behavior", encoding="utf-8")
    (globals_dir / "CLAUDE.md").write_text("Claude global behavior", encoding="utf-8")
    (workspace / "NIDAVELLIR.md").write_text("Runtime orchestration", encoding="utf-8")
    (workspace / "PROJECT.md").write_text("Project scoped context", encoding="utf-8")

    result = discover_project_instructions(
        cwd=workspace,
        provider="claude",
        global_instruction_files={
            "AGENTS.md": globals_dir / "AGENTS.md",
            "CLAUDE.md": globals_dir / "CLAUDE.md",
        },
    )

    assert [item.name for item in result.instructions] == ["CLAUDE.md", "PROJECT.md", "NIDAVELLIR.md"]
    assert result.instructions[0].scope == "global"
    assert "Codex global behavior" not in result.rendered_text
    assert "Claude global behavior" in result.rendered_text
    assert result.rendered_text.index("Claude global behavior") < result.rendered_text.index("Project scoped context")
    assert result.rendered_text.index("Project scoped context") < result.rendered_text.index("Runtime orchestration")


def test_default_global_instruction_files_prefers_provider_config_env(tmp_path: Path, monkeypatch):
    codex_home = tmp_path / "codex"
    claude_home = tmp_path / "claude"
    codex_home.mkdir()
    claude_home.mkdir()
    (codex_home / "AGENTS.md").write_text("Codex global", encoding="utf-8")
    (claude_home / "CLAUDE.md").write_text("Claude global", encoding="utf-8")
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(claude_home))

    files = default_global_instruction_files()

    assert files["AGENTS.md"] == codex_home / "AGENTS.md"
    assert files["CLAUDE.md"] == claude_home / "CLAUDE.md"


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


def test_ws_prompt_assembly_injects_attached_command_output(tmp_path: Path):
    from nidavellir.commands import CommandRunStore
    from nidavellir.routers.ws import _build_prompt_assembly

    command_store = CommandRunStore(str(tmp_path / "commands.db"))
    run = command_store.create_run(
        conversation_id="conv",
        command="npm test",
        cwd=str(tmp_path),
        exit_code=0,
        stdout="tests passed",
        stderr="",
        timed_out=False,
        include_in_chat=True,
        added_to_working_set=False,
        duration_ms=42,
    )

    class Store:
        def list_conversation_files(self, conversation_id: str):
            return []

    assembly = _build_prompt_assembly(
        store=Store(),
        skill_store=None,
        conversation_id="conv",
        provider_id="codex",
        model_id="gpt-5.5",
        current_content="Use the command result",
        memory_context="Prior context",
        workdir=tmp_path,
        command_store=command_store,
    )

    assert "## Command Output Attachments" in assembly.rendered_text
    assert "npm test" in assembly.rendered_text
    assert "tests passed" in assembly.rendered_text
    assert run["id"] in assembly.sections[1].metadata["command_run_ids"]


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
async def test_project_instruction_api_surfaces_global_provider_files(tmp_path: Path, monkeypatch):
    _setup_app(tmp_path)
    workspace = tmp_path / "repo"
    codex_home = tmp_path / "codex"
    claude_home = tmp_path / "claude"
    workspace.mkdir()
    codex_home.mkdir()
    claude_home.mkdir()
    (codex_home / "AGENTS.md").write_text("Codex machine behavior", encoding="utf-8")
    (claude_home / "CLAUDE.md").write_text("Claude machine behavior", encoding="utf-8")
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(claude_home))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        listed = await c.get("/api/project-instructions", params={"workspace": str(workspace), "provider": "claude"})

    assert listed.status_code == 200
    body = listed.json()
    editable = {item["name"]: item for item in body["editableFiles"]}
    assert editable["AGENTS.md"]["path"] == str(codex_home / "AGENTS.md")
    assert editable["AGENTS.md"]["scope"] == "global"
    assert editable["AGENTS.md"]["content"] == "Codex machine behavior"
    assert editable["CLAUDE.md"]["path"] == str(claude_home / "CLAUDE.md")
    assert editable["CLAUDE.md"]["scope"] == "global"
    assert editable["CLAUDE.md"]["content"] == "Claude machine behavior"
    assert any(item["name"] == "CLAUDE.md" and item["scope"] == "global" for item in body["instructions"])


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

    monkeypatch.setattr(app.state, "permission_evaluator", AskingEvaluator())

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


@pytest.mark.asyncio
async def test_context_usage_counts_active_project_instructions(tmp_path: Path):
    _setup_app(tmp_path)
    workspace = tmp_path / "repo"
    workspace.mkdir()
    instruction_text = "Use this project instruction context. " * 20
    (workspace / "CLAUDE.md").write_text(instruction_text, encoding="utf-8")
    app.state.memory_store.create_conversation(
        "conv-instructions",
        model_id="claude-sonnet-4-6",
        provider_id="anthropic",
        working_directory=str(workspace),
        working_directory_display=str(workspace),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        usage = await c.get(
            "/api/context/usage",
            params={
                "conversation_id": "conv-instructions",
                "model": "claude-sonnet-4-6",
                "provider": "anthropic",
            },
        )

    assert usage.status_code == 200
    body = usage.json()
    assert body["projectInstructionTokens"] > 0
    assert body["currentTokens"] >= body["projectInstructionTokens"]
