from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.commands import CommandRunStore
from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest, PermissionEvaluationResult
from nidavellir.skills.models import NidavellirSkill
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
    (tmp_path / "NIDAVELLIR.md").write_text("Use project audit rules.", encoding="utf-8")
    app.state.skill_store.create_skill(NidavellirSkill.model_validate({
        "id": "skill-audit",
        "slug": "audit-helper",
        "name": "Audit Helper",
        "description": "Helps review audit bundles.",
        "scope": "global",
        "activation_mode": "manual",
        "triggers": [{"type": "keyword", "value": "audit", "weight": 1}],
        "instructions": {"core": "Inspect exported evidence carefully."},
        "required_capabilities": {},
        "priority": 50,
        "enabled": True,
        "show_in_slash": True,
        "version": 1,
        "status": "validated",
        "source": {"format": "native", "trust_status": "trusted"},
    }))
    app.state.skill_store.log_activation(
        skill_id="skill-audit",
        conversation_id="conv-audit",
        session_id="sess-audit",
        provider="codex",
        model="gpt-5.5",
        trigger_reason="manual",
        score=1.0,
        matched_triggers=["audit"],
        compatibility_status="compatible",
        diagnostics=[],
        token_estimate=8,
        injected=True,
    )
    app.state.skill_store.log_activation(
        skill_id="skill-audit",
        conversation_id="conv-other",
        session_id="sess-other",
        provider="codex",
        model="gpt-5.5",
        trigger_reason="manual",
        score=1.0,
        matched_triggers=["audit"],
        compatibility_status="compatible",
        diagnostics=[],
        token_estimate=8,
        injected=True,
    )
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
    assert body["manifest"]["conversation_id"] == "conv-audit"
    assert body["manifest"]["counts"] == {
        "messages": 2,
        "working_set_files": 0,
        "command_runs": 1,
        "permission_audit_events": 1,
        "memory_activity": 1,
        "project_instructions": 1,
        "suppressed_project_instructions": 0,
        "skills": 1,
        "skill_activations": 1,
    }
    assert body["manifest"]["redaction"]["command_output"] == "omitted"
    assert body["manifest"]["redaction"]["memory_snapshots"] == "omitted"
    assert body["manifest"]["redaction"]["project_instruction_contents"] == "omitted"
    assert body["manifest"]["redaction"]["skill_instructions"] == "omitted"
    assert body["conversation"]["id"] == "conv-audit"
    assert body["conversation"]["active_session_id"] == "sess-audit"
    assert [message["id"] for message in body["messages"]] == ["msg-user", "msg-agent"]
    assert body["command_runs"][0]["command"] == "npm test"
    assert body["command_runs"][0]["stdout"] == ""
    assert body["command_runs"][0]["stdout_bytes"] == 2
    assert body["command_runs"][0]["output_redacted"] is True
    assert body["permission_audit_events"][0]["conversation_id"] == "conv-audit"
    assert body["memory_activity"][0]["session_id"] == "sess-audit"
    assert body["memory_activity"][0]["memory_snapshot"] is None
    assert body["project_instructions"]["active"][0]["name"] == "NIDAVELLIR.md"
    assert body["project_instructions"]["active"][0]["content"] == ""
    assert body["project_instructions"]["active"][0]["content_redacted"] is True
    assert body["skills"][0]["slug"] == "audit-helper"
    assert body["skills"][0]["instructions"]["core"] == ""
    assert body["skills"][0]["instructions_redacted"] is True
    assert len(body["skill_activations"]) == 1
    assert body["skill_activations"][0]["conversation_id"] == "conv-audit"


@pytest.mark.asyncio
async def test_conversation_audit_bundle_can_include_redacted_prompt_surfaces(tmp_path: Path):
    memory_store, command_store, _permission_store = setup_app(tmp_path)
    (tmp_path / "PROJECT.md").write_text("Project-only audit context", encoding="utf-8")
    app.state.skill_store.create_skill(NidavellirSkill.model_validate({
        "id": "skill-full",
        "slug": "full-helper",
        "name": "Full Helper",
        "description": "Full prompt surface test.",
        "scope": "project",
        "activation_mode": "automatic",
        "triggers": [{"type": "keyword", "value": "full", "weight": 1}],
        "instructions": {"core": "Full skill instruction text."},
        "required_capabilities": {},
        "priority": 60,
        "enabled": True,
        "show_in_slash": False,
        "version": 1,
        "status": "validated",
        "source": {"format": "native", "trust_status": "trusted"},
    }))
    memory_store.create_conversation(
        "conv-full",
        active_session_id="sess-full",
        provider_id="codex",
        model_id="gpt-5.5",
        working_directory=str(tmp_path),
    )
    memory_store.save_memories([{
        "id": "mem-full",
        "content": "Important implementation detail",
        "category": "project",
        "memory_type": "fact",
        "workflow": "chat",
        "scope_type": "workflow",
        "scope_id": "chat",
        "tags": "",
        "confidence": 0.9,
        "importance": 7,
        "source": "manual",
    }])
    memory_store.log_event(
        event_type="injected",
        event_subject="injection",
        memory_id="mem-full",
        session_id="sess-full",
        payload={"rank": 1},
    )
    command_store.create_run(
        conversation_id="conv-full",
        command="printf ok",
        cwd=str(tmp_path),
        exit_code=0,
        stdout="ok",
        stderr="",
        timed_out=False,
        include_in_chat=False,
        added_to_working_set=False,
        duration_ms=12,
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get(
            "/api/conversations/conv-full/audit-bundle"
            "?include_command_output=true&include_memory_snapshots=true"
            "&include_instruction_contents=true&include_skill_instructions=true"
        )

    assert response.status_code == 200
    body = response.json()
    assert body["manifest"]["redaction"]["command_output"] == "included"
    assert body["manifest"]["redaction"]["memory_snapshots"] == "included"
    assert body["manifest"]["redaction"]["project_instruction_contents"] == "included"
    assert body["manifest"]["redaction"]["skill_instructions"] == "included"
    assert body["command_runs"][0]["stdout"] == "ok"
    assert body["command_runs"][0]["output_redacted"] is False
    assert body["memory_activity"][0]["memory_snapshot"]["content"] == "Important implementation detail"
    assert body["project_instructions"]["active"][0]["content"] == "Project-only audit context"
    assert body["project_instructions"]["active"][0]["content_redacted"] is False
    assert body["skills"][0]["instructions"]["core"] == "Full skill instruction text."
    assert body["skills"][0]["instructions_redacted"] is False


@pytest.mark.asyncio
async def test_conversation_audit_bundle_warns_when_optional_stores_unavailable(tmp_path: Path):
    memory_store, _command_store, _permission_store = setup_app(tmp_path)
    memory_store.create_conversation("conv-warn")
    memory_store.update_conversation("conv-warn", {"active_session_id": None})
    delattr(app.state, "command_store")
    delattr(app.state, "permission_audit_store")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/api/conversations/conv-warn/audit-bundle")

    assert response.status_code == 200
    body = response.json()
    assert body["manifest"]["session_id"] == "conv-warn"
    assert body["manifest"]["counts"]["command_runs"] == 0
    assert body["manifest"]["counts"]["permission_audit_events"] == 0
    assert body["manifest"]["counts"]["skills"] == 0
    warnings = " ".join(body["manifest"]["warnings"])
    assert "active_session_id" in warnings
    assert "command store unavailable" in warnings
    assert "permission audit store unavailable" in warnings


@pytest.mark.asyncio
async def test_conversation_audit_bundle_rejects_missing_conversation(tmp_path: Path):
    setup_app(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/api/conversations/missing/audit-bundle")
    assert response.status_code == 404
