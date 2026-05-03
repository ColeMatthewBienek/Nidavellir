from __future__ import annotations

import subprocess
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


def create_git_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-b", "main"], cwd=path, check=True, capture_output=True, text=True)
    subprocess.run(["git", "config", "user.email", "nidavellir@example.test"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.name", "Nidavellir Test"], cwd=path, check=True)
    (path / "README.md").write_text("# test\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=path, check=True)
    subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=path, check=True, capture_output=True, text=True)
    return path


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
async def test_orchestration_creates_refreshes_and_removes_worktrees(tmp_path: Path):
    setup_app(tmp_path)
    repo = create_git_repo(tmp_path / "repo")
    worktree_path = tmp_path / "worktrees" / "node-a"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        task = (await c.post("/api/orchestration/tasks", json={
            "title": "Worktree test",
            "baseRepoPath": str(repo),
            "baseBranch": "main",
        })).json()
        node = (await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={"title": "Node A"})).json()

        created = await c.post(f"/api/orchestration/tasks/{task['id']}/worktrees", json={
            "nodeId": node["id"],
            "repoPath": str(repo),
            "baseBranch": "main",
            "branchName": "orchestration/worktree-test/node-a",
            "worktreePath": str(worktree_path),
        })
        assert created.status_code == 200
        worktree = created.json()
        assert worktree["node_id"] == node["id"]
        assert worktree["status"] == "clean"
        assert worktree["dirty_count"] == 0
        assert worktree_path.exists()

        (worktree_path / "README.md").write_text("# changed\n", encoding="utf-8")
        refreshed = await c.post(f"/api/orchestration/worktrees/{worktree['id']}/refresh")
        assert refreshed.status_code == 200
        assert refreshed.json()["status"] == "dirty"
        assert refreshed.json()["dirty_count"] == 1
        assert refreshed.json()["dirty_summary"][0]["path"] == "README.md"

        (worktree_path / "README.md").write_text("# test\n", encoding="utf-8")
        clean = await c.post(f"/api/orchestration/worktrees/{worktree['id']}/refresh")
        assert clean.status_code == 200
        assert clean.json()["status"] == "clean"

        removed = await c.delete(f"/api/orchestration/worktrees/{worktree['id']}")
        assert removed.status_code == 200
        assert removed.json()["status"] == "removed"
        assert not worktree_path.exists()

        detail = (await c.get(f"/api/orchestration/tasks/{task['id']}")).json()
        assert detail["worktrees"][0]["status"] == "removed"
        event_types = {event["type"] for event in (await c.get(f"/api/orchestration/tasks/{task['id']}/events")).json()}
        assert {"worktree_created", "worktree_updated", "worktree_removed"} <= event_types


@pytest.mark.asyncio
async def test_orchestration_runs_command_steps_inside_node_worktree(tmp_path: Path):
    setup_app(tmp_path)
    repo = create_git_repo(tmp_path / "repo")
    worktree_path = tmp_path / "worktrees" / "command-node"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        task = (await c.post("/api/orchestration/tasks", json={
            "title": "Command worktree test",
            "baseRepoPath": str(repo),
            "baseBranch": "main",
        })).json()
        node = (await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={"title": "Command Node"})).json()
        worktree = (await c.post(f"/api/orchestration/tasks/{task['id']}/worktrees", json={
            "nodeId": node["id"],
            "repoPath": str(repo),
            "baseBranch": "main",
            "branchName": "orchestration/command-worktree-test/command-node",
            "worktreePath": str(worktree_path),
        })).json()
        step = (await c.post(f"/api/orchestration/nodes/{node['id']}/steps", json={
            "title": "Write marker",
            "type": "command",
            "config": {"command": "printf marker > marker.txt && pwd"},
        })).json()

        result = await c.post(f"/api/orchestration/steps/{step['id']}/run-command", json={
            "conversationId": "conv-command",
        })
        assert result.status_code == 200
        body = result.json()
        assert body["step"]["status"] == "complete"
        assert body["run"]["cwd"] == str(worktree_path)
        assert str(worktree_path) in body["run"]["stdout"]
        assert body["worktree"]["id"] == worktree["id"]
        assert body["worktree"]["status"] == "dirty"
        assert body["worktree"]["dirty_summary"][0]["path"] == "marker.txt"
        assert (worktree_path / "marker.txt").read_text(encoding="utf-8") == "marker"

        runs = await c.get("/api/commands/runs", params={"conversationId": "conv-command"})
        assert runs.status_code == 200
        assert runs.json()[0]["id"] == body["run"]["id"]

        events = await c.get(f"/api/orchestration/tasks/{task['id']}/events")
        event_types = {event["type"] for event in events.json()}
        assert {"command_step_started", "command_step_finished"} <= event_types


@pytest.mark.asyncio
async def test_orchestration_runs_agent_steps_inside_node_worktree(tmp_path: Path, monkeypatch):
    setup_app(tmp_path)
    repo = create_git_repo(tmp_path / "repo")
    worktree_path = tmp_path / "worktrees" / "agent-node"

    class FakeAgent:
        def __init__(self, slot_id, workdir, model_id=None):
            self.workdir = Path(workdir)
            self.model_id = model_id
            self.prompt = ""

        async def start(self):
            return None

        async def send(self, text: str):
            self.prompt = text
            (self.workdir / "agent.txt").write_text("agent touched\n", encoding="utf-8")

        async def stream(self):
            yield "Changed agent.txt\n"

        async def kill(self):
            return None

    from nidavellir.agents import registry as agent_registry
    from nidavellir.routers import orchestration as orchestration_router

    monkeypatch.setitem(
        agent_registry.PROVIDER_REGISTRY,
        "fake-agent",
        agent_registry.ProviderManifest(
            id="fake-agent",
            display_name="Fake Agent",
            binary="fake-agent",
            description="test fake",
            agent_class=FakeAgent,
            supports_worktree_isolation=True,
        ),
    )
    monkeypatch.setattr(orchestration_router._agent_registry, "PROVIDER_REGISTRY", agent_registry.PROVIDER_REGISTRY)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        task = (await c.post("/api/orchestration/tasks", json={
            "title": "Agent worktree test",
            "baseRepoPath": str(repo),
            "baseBranch": "main",
        })).json()
        node = (await c.post(f"/api/orchestration/tasks/{task['id']}/nodes", json={
            "title": "Agent Node",
            "provider": "fake-agent",
            "model": "fake-model",
        })).json()
        worktree = (await c.post(f"/api/orchestration/tasks/{task['id']}/worktrees", json={
            "nodeId": node["id"],
            "repoPath": str(repo),
            "baseBranch": "main",
            "branchName": "orchestration/agent-worktree-test/agent-node",
            "worktreePath": str(worktree_path),
        })).json()
        step = (await c.post(f"/api/orchestration/nodes/{node['id']}/steps", json={
            "title": "Ask fake agent",
            "type": "agent",
            "config": {"prompt": "Touch agent.txt"},
        })).json()

        result = await c.post(f"/api/orchestration/steps/{step['id']}/run-agent", json={
            "conversationId": "conv-agent",
        })
        assert result.status_code == 200
        body = result.json()
        assert body["step"]["status"] == "complete"
        assert body["run_attempt"]["provider"] == "fake-agent"
        assert body["run_attempt"]["model"] == "fake-model"
        assert body["run_attempt"]["worktree_path"] == str(worktree_path)
        assert body["worktree"]["id"] == worktree["id"]
        assert body["worktree"]["status"] == "dirty"
        assert body["worktree"]["dirty_summary"][0]["path"] == "agent.txt"
        assert "Changed agent.txt" in body["transcript"]

        events = await c.get(f"/api/orchestration/tasks/{task['id']}/events")
        event_types = {event["type"] for event in events.json()}
        assert {"agent_step_started", "agent_step_finished", "run_attempt_created", "run_attempt_updated"} <= event_types


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
