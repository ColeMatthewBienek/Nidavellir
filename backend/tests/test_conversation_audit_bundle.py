from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.commands import CommandRunStore
from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest, PermissionEvaluationResult
from nidavellir.skills.store import SkillStore
from nidavellir.tokens.store import TokenUsageStore


def setup_app(tmp_path: Path) -> tuple[MemoryStore, CommandRunStore, PermissionAuditStore]:
    memory_store = MemoryStore(str(tmp_path / "memory.db"))
    command_store = CommandRunStore(str(tmp_path / "commands.db"))
    permission_store = PermissionAuditStore(str(tmp_path / "permissions.db"))
    app.state.memory_store = memory_store
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    app.state.skill_store = SkillStore(str(tmp_path / "skills.db"))
    app.state.permission_evaluator = PermissionEvaluator()
    app.state.permission_audit_store = permission_store
    app.state.command_store = command_store
    return memory_store, command_store, permission_store


@pytest.mark.asyncio
async def test_conversation_audit_bundle_exports_session_artifacts(tmp_path: Path):
    memory_store, command_store, permission_store = setup_app(tmp_path)
    memory_store.create_conversation(
        "conv-audit",
        title="Audit me",
        active_session_id="sess-audit",
        provider_id="codex",
        model_id="gpt-5.5",
        working_directory=str(tmp_path),
        working_directory_display=str(tmp_path),
    )
    memory_store.append_message("conv-audit", "msg-user", "user", "Run the tests")
    memory_store.append_message("conv-audit", "msg-agent", "agent", "Tests passed")
    memory_store.log_event(
        event_type="injected",
        event_subject="injection",
        session_id="sess-audit",
        payload={"memory_ids": ["mem-1"]},
    )
    command_store.create_run(
        conversation_id="conv-audit",
        command="npm test",
        cwd=str(tmp_path),
        exit_code=0,
        stdout="ok",
        stderr="",
        timed_out=False,
        include_in_chat=False,
        added_to_working_set=False,
        duration_ms=42,
    )
    permission_store.log(
        PermissionEvaluationRequest(
            action="shell_command",
            command="npm test",
            actor="user",
            conversation_id="conv-audit",
            workspace=str(tmp_path),
        ),
        PermissionEvaluationResult(
            action="shell_command",
            decision=PermissionDecision.ALLOW,
            reason="test",
        ),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/api/conversations/conv-audit/audit-bundle")

    assert response.status_code == 200
    assert "json" in response.headers["content-type"]
    assert "attachment" in response.headers.get("content-disposition", "")
    body = response.json()
    assert body["schema_version"] == "conversation_audit_bundle.v1"
    assert body["conversation"]["id"] == "conv-audit"
    assert body["conversation"]["active_session_id"] == "sess-audit"
    assert [message["id"] for message in body["messages"]] == ["msg-user", "msg-agent"]
    assert body["command_runs"][0]["command"] == "npm test"
    assert body["permission_audit_events"][0]["conversation_id"] == "conv-audit"
    assert body["memory_activity"][0]["session_id"] == "sess-audit"


@pytest.mark.asyncio
async def test_conversation_audit_bundle_rejects_missing_conversation(tmp_path: Path):
    setup_app(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/api/conversations/missing/audit-bundle")
    assert response.status_code == 404
