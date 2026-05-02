from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.orchestration import OrchestrationStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
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
    app.state.orchestration_store = OrchestrationStore(str(tmp_path / "orchestration.db"))


@pytest.mark.asyncio
async def test_orchestration_task_dag_and_step_readiness_flow(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        created = await c.post("/api/orchestration/tasks", json={
            "title": "Build orchestration",
            "description": "Create the first orchestration slice",
            "priority": 1,
            "labels": ["orchestration"],
            "baseRepoPath": str(tmp_path),
            "baseBranch": "main",
        })
        assert created.status_code == 200
        task = created.json()
        assert task["title"] == "Build orchestration"
        assert task["labels"] == ["orchestration"]

        data_node = await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={
            "title": "Data model",
            "provider": "codex",
            "model": "gpt-5.5",
        })
        ui_node = await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={
            "title": "Board UI",
        })
        assert data_node.status_code == 200
        assert ui_node.status_code == 200
        data = data_node.json()
        ui = ui_node.json()

        edge = await c.post(f"/api/orchestration/tasks/{task['id']}/edges", json={
            "fromNodeId": data["id"],
            "toNodeId": ui["id"],
        })
        assert edge.status_code == 200

        first_step = await c.post(f"/api/orchestration/nodes/{data['id']}/steps", json={
            "title": "Create SQLite schema",
            "type": "manual",
        })
        second_step = await c.post(f"/api/orchestration/nodes/{ui['id']}/steps", json={
            "title": "Render board columns",
            "type": "manual",
        })
        assert first_step.status_code == 200
        assert second_step.status_code == 200

        before = await c.get(f"/api/orchestration/tasks/{task['id']}")
        assert before.status_code == 200
        body = before.json()
        statuses = {node["title"]: node["status"] for node in body["nodes"]}
        assert statuses["Data model"] == "ready"
        assert statuses["Board UI"] == "blocked"
        assert body["readiness"]["runnable"] == [{
            "node_id": data["id"],
            "step_id": first_step.json()["id"],
            "step_type": "manual",
        }]

        completed = await c.patch(f"/api/orchestration/steps/{first_step.json()['id']}/status", json={
            "status": "complete",
            "outputSummary": "Schema done",
        })
        assert completed.status_code == 200
        assert completed.json()["status"] == "complete"

        after = await c.get(f"/api/orchestration/tasks/{task['id']}")
        body = after.json()
        statuses = {node["title"]: node["status"] for node in body["nodes"]}
        assert statuses["Data model"] == "complete"
        assert statuses["Board UI"] == "ready"
        assert body["readiness"]["runnable"] == [{
            "node_id": ui["id"],
            "step_id": second_step.json()["id"],
            "step_type": "manual",
        }]

        events = await c.get(f"/api/orchestration/tasks/{task['id']}/events")
        assert events.status_code == 200
        event_types = {event["type"] for event in events.json()}
        assert {"task_created", "node_added", "edge_added", "step_added", "step_status_changed"} <= event_types


@pytest.mark.asyncio
async def test_orchestration_updates_nodes_and_removes_edges(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        task = (await c.post("/api/orchestration/tasks", json={"title": "Interactive DAG"})).json()
        first = (await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={"title": "First"})).json()
        second = (await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={"title": "Second"})).json()
        edge = (await c.post(f"/api/orchestration/tasks/{task['id']}/edges", json={
            "fromNodeId": first["id"],
            "toNodeId": second["id"],
        })).json()

        updated = await c.patch(f"/api/orchestration/nodes/{first['id']}", json={
            "title": "Renamed",
            "positionX": 220,
            "positionY": 120,
        })
        assert updated.status_code == 200
        assert updated.json()["title"] == "Renamed"
        assert updated.json()["position_x"] == 220
        assert updated.json()["position_y"] == 120

        deleted = await c.delete(f"/api/orchestration/edges/{edge['id']}")
        assert deleted.status_code == 204

        detail = (await c.get(f"/api/orchestration/tasks/{task['id']}")).json()
        assert detail["edges"] == []
        event_types = {event["type"] for event in (await c.get(f"/api/orchestration/tasks/{task['id']}/events")).json()}
        assert {"node_updated", "edge_removed"} <= event_types


@pytest.mark.asyncio
async def test_orchestration_rejects_invalid_status(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.post("/api/orchestration/tasks", json={
            "title": "Bad task",
            "status": "maybe",
        })

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_task_status"


@pytest.mark.asyncio
async def test_orchestration_rejects_edges_that_create_cycles(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        task = (await c.post("/api/orchestration/tasks", json={"title": "Cycle test"})).json()
        first = (await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={"title": "First"})).json()
        second = (await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={"title": "Second"})).json()

        forward = await c.post(f"/api/orchestration/tasks/{task['id']}/edges", json={
            "fromNodeId": first["id"],
            "toNodeId": second["id"],
        })
        assert forward.status_code == 200

        cycle = await c.post(f"/api/orchestration/tasks/{task['id']}/edges", json={
            "fromNodeId": second["id"],
            "toNodeId": first["id"],
        })

    assert cycle.status_code == 400
    assert cycle.json()["detail"] == "edge_would_create_cycle"
