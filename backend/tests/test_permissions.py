from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest
from nidavellir.skills.store import SkillStore
from nidavellir.tokens.store import TokenUsageStore


def setup_app(tmp_path: Path):
    app.state.memory_store = MemoryStore(str(tmp_path / "memory.db"))
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    app.state.skill_store = SkillStore(str(tmp_path / "skills.db"))
    app.state.permission_evaluator = PermissionEvaluator()
    app.state.permission_audit_store = PermissionAuditStore(str(tmp_path / "permissions.db"))
    return app.state.skill_store


def test_permission_evaluator_asks_for_agent_read_of_protected_path(tmp_path):
    workspace = tmp_path / "repo"
    workspace.mkdir()
    env_file = workspace / ".env"
    env_file.write_text("TOKEN=secret", encoding="utf-8")

    result = PermissionEvaluator().evaluate(PermissionEvaluationRequest(
        action="file_read",
        actor="agent",
        path=str(env_file),
        workspace=str(workspace),
    ))

    assert result.decision == PermissionDecision.ASK
    assert result.protected is True
    assert result.matched_rule == ".env"


def test_permission_evaluator_allows_user_read_but_marks_protected(tmp_path):
    workspace = tmp_path / "repo"
    workspace.mkdir()
    key_file = workspace / "id_ed25519"
    key_file.write_text("secret", encoding="utf-8")

    result = PermissionEvaluator().evaluate(PermissionEvaluationRequest(
        action="file_read",
        actor="user",
        path=str(key_file),
        workspace=str(workspace),
    ))

    assert result.decision == PermissionDecision.ALLOW
    assert result.protected is True
    assert result.requires_user_choice is False


def test_permission_evaluator_asks_for_risky_shell_command(tmp_path):
    result = PermissionEvaluator().evaluate(PermissionEvaluationRequest(
        action="shell_command",
        command="rm -rf build",
        workspace=str(tmp_path),
    ))

    assert result.decision == PermissionDecision.ASK
    assert result.matched_rule


@pytest.mark.asyncio
async def test_permissions_api_evaluates_and_audits(tmp_path):
    setup_app(tmp_path)
    workspace = tmp_path / "repo"
    workspace.mkdir()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        evaluated = await c.post("/api/permissions/evaluate", json={
            "action": "file_write",
            "actor": "agent",
            "path": str(workspace / ".env"),
            "workspace": str(workspace),
        })
        assert evaluated.status_code == 200
        body = evaluated.json()
        assert body["decision"] == "ask"
        assert body["protected"] is True

        audit = await c.get("/api/permissions/audit")
        assert audit.status_code == 200
        events = audit.json()
        assert events[0]["action"] == "file_write"
        assert events[0]["decision"] == "ask"


@pytest.mark.asyncio
async def test_local_skill_import_blocks_protected_path_and_logs_audit(tmp_path):
    setup_app(tmp_path)
    workspace = tmp_path / "repo"
    workspace.mkdir()
    protected = workspace / ".env"
    protected.write_text("# Not a skill", encoding="utf-8")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        imported = await c.post("/api/skills/import/local", json={"path": str(protected)})
        assert imported.status_code == 403
        detail = imported.json()["detail"]
        assert detail["code"] == "permission_required"
        assert detail["permission"]["matched_rule"] == ".env"

        audit = await c.get("/api/permissions/audit")
        assert audit.json()[0]["action"] == "package_import"


@pytest.mark.asyncio
async def test_enabling_risky_skill_requires_permission(tmp_path):
    setup_app(tmp_path)
    skill_dir = tmp_path / "shell-skill"
    skill_dir.mkdir()
    (skill_dir / "skill.yaml").write_text(
        "id: shell-skill\n"
        "slug: shell-skill\n"
        "name: Shell Skill\n"
        "activation_mode: manual\n"
        "required_capabilities:\n"
        "  shell: true\n",
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text("# Shell Skill\n\nRuns commands.", encoding="utf-8")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        imported = await c.post("/api/skills/import/local", json={"path": str(skill_dir)})
        assert imported.status_code == 200
        skill_id = imported.json()["skill"]["id"]

        enabled = await c.post(f"/api/skills/{skill_id}/enabled", json={"enabled": True})
        assert enabled.status_code == 403
        permission = enabled.json()["detail"]["permission"]
        assert permission["action"] == "skill_enable"
        assert permission["decision"] == "ask"
        assert permission["matched_rule"] == "risky_skill_capability"
