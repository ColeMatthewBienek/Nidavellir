from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.commands.runner import MAX_CAPTURE_CHARS
from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationResult
from nidavellir.skills.store import SkillStore
from nidavellir.tokens.store import TokenUsageStore


def setup_app(tmp_path: Path):
    app.state.memory_store = MemoryStore(str(tmp_path / "memory.db"))
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    app.state.skill_store = SkillStore(str(tmp_path / "skills.db"))
    app.state.permission_evaluator = PermissionEvaluator()
    app.state.permission_audit_store = PermissionAuditStore(str(tmp_path / "permissions.db"))
    app.state.command_store = CommandRunStore(str(tmp_path / "commands.db"))
    app.state.command_runner = CommandRunner()


@pytest.mark.asyncio
async def test_command_runner_captures_stdout_and_history(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        run = await c.post("/api/commands/run", json={
            "command": "printf hello",
            "cwd": str(tmp_path),
            "conversationId": "conv",
        })
        assert run.status_code == 200
        body = run.json()
        assert body["stdout"] == "hello"
        assert body["stderr"] == ""
        assert body["exit_code"] == 0
        assert body["conversation_id"] == "conv"

        history = await c.get("/api/commands/runs", params={"conversationId": "conv"})
        assert history.status_code == 200
        assert history.json()[0]["id"] == body["id"]

        attached = await c.post(f"/api/commands/runs/{body['id']}/chat-attachment", json={"includeInChat": True})
        assert attached.status_code == 200
        assert attached.json()["include_in_chat"] is True


@pytest.mark.asyncio
async def test_command_runner_streams_start_output_and_finish_events(tmp_path: Path):
    events = []

    async def collect(event: dict):
        events.append(event)

    result = await CommandRunner().run(
        command="printf streamed",
        cwd=str(tmp_path),
        on_event=collect,
    )

    assert result["stdout"] == "streamed"
    assert events[0]["type"] == "started"
    assert {"type": "output", "stream": "stdout", "content": "streamed"} in events
    assert events[-1]["type"] == "finished"
    assert events[-1]["exit_code"] == 0


@pytest.mark.asyncio
async def test_command_runner_caps_streamed_output_while_running(tmp_path: Path):
    events = []

    async def collect(event: dict):
        events.append(event)

    result = await CommandRunner().run(
        command="python -c 'print(\"x\" * 70000, end=\"\")'",
        cwd=str(tmp_path),
        on_event=collect,
    )

    output_events = [event for event in events if event.get("type") == "output"]
    streamed = "".join(event.get("content", "") for event in output_events)
    assert len(result["stdout"]) <= MAX_CAPTURE_CHARS + 100
    assert "[truncated" in result["stdout"]
    assert streamed == result["stdout"]


@pytest.mark.asyncio
async def test_command_runner_captures_stderr_and_nonzero_exit(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        run = await c.post("/api/commands/run", json={
            "command": "python -c 'import sys; print(\"bad\", file=sys.stderr); sys.exit(3)'",
            "cwd": str(tmp_path),
        })
        assert run.status_code == 200
        body = run.json()
        assert body["exit_code"] == 3
        assert "bad" in body["stderr"]


@pytest.mark.asyncio
async def test_command_presets_reflect_workspace_tooling(tmp_path: Path):
    setup_app(tmp_path)
    (tmp_path / "frontend").mkdir()
    (tmp_path / "frontend" / "package.json").write_text("{}", encoding="utf-8")
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend" / "pyproject.toml").write_text("[project]\nname='x'\n", encoding="utf-8")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/api/commands/presets", params={"cwd": str(tmp_path)})

    assert response.status_code == 200
    commands = {item["command"] for item in response.json()}
    assert "cd frontend && npm run typecheck" in commands
    assert "cd backend && uv run python -m pytest" in commands
    assert "npx fallow dead-code --format json --quiet" in commands


@pytest.mark.asyncio
async def test_command_runner_requires_permission_for_risky_command(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        blocked = await c.post("/api/commands/run", json={
            "command": "rm -rf build",
            "cwd": str(tmp_path),
        })
        assert blocked.status_code == 403
        detail = blocked.json()["detail"]
        assert detail["code"] == "permission_required"
        assert detail["permission"]["action"] == "shell_command"

        audit = await c.get("/api/permissions/audit")
        assert audit.json()[0]["decision"] == "ask"


@pytest.mark.asyncio
async def test_command_runner_supports_allow_once_override(tmp_path: Path):
    setup_app(tmp_path)

    class AskingEvaluator:
        def evaluate(self, request):
            return PermissionEvaluationResult(
                action=request.action,
                decision=PermissionDecision.ASK,
                reason="test approval required",
                matched_rule="test_rule",
                requires_user_choice=True,
            )

    app.state.permission_evaluator = AskingEvaluator()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        allowed = await c.post("/api/commands/run", json={
            "command": "printf allowed",
            "cwd": str(tmp_path),
            "permissionOverride": "allow_once",
        })
        assert allowed.status_code == 200
        assert allowed.json()["stdout"] == "allowed"

        audit = await c.get("/api/permissions/audit")
        decisions = [event["decision"] for event in audit.json()]
        assert "allow_once" in decisions
        assert "ask" in decisions


@pytest.mark.asyncio
async def test_command_runner_rejects_missing_cwd(tmp_path: Path):
    setup_app(tmp_path)
    missing = tmp_path / "missing"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        run = await c.post("/api/commands/run", json={
            "command": "pwd",
            "cwd": str(missing),
        })
        assert run.status_code == 400
        assert run.json()["detail"] == "directory_not_found"
