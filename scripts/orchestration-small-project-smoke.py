from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from httpx import ASGITransport, AsyncClient

from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.orchestration import OrchestrationStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.permissions.tool_requests import ToolRequestStore
from nidavellir.skills.builtin import ensure_builtin_skills
from nidavellir.skills.store import SkillStore
from nidavellir.tokens.store import TokenUsageStore


def run(command: list[str], cwd: Path) -> None:
    subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)


def configure_git_repo(path: Path) -> Path:
    run(["git", "config", "user.email", "nidavellir@example.test"], path)
    run(["git", "config", "user.name", "Nidavellir Smoke"], path)
    (path / "README.md").write_text("# smoke\n", encoding="utf-8")
    (path / "package.json").write_text(
        json.dumps(
            {"scripts": {"test": "node -e \"console.log('orchestration-smoke-ok')\""}},
            indent=2,
        ),
        encoding="utf-8",
    )
    run(["git", "add", "README.md", "package.json"], path)
    run(["git", "commit", "-m", "Initial smoke project"], path)
    return path


def setup_isolated_app(data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    app.state.memory_store = MemoryStore(str(data_dir / "memory.db"))
    app.state.token_store = TokenUsageStore(str(data_dir / "tokens.db"))
    app.state.skill_store = SkillStore(str(data_dir / "skills.db"))
    ensure_builtin_skills(app.state.skill_store)
    app.state.permission_evaluator = PermissionEvaluator()
    app.state.permission_audit_store = PermissionAuditStore(str(data_dir / "permissions.db"))
    app.state.command_store = CommandRunStore(str(data_dir / "commands.db"))
    app.state.command_runner = CommandRunner()
    app.state.orchestration_store = OrchestrationStore(str(data_dir / "orchestration.db"))
    app.state.tool_request_store = ToolRequestStore(str(data_dir / "tool_requests.db"))


def require(condition: bool, message: str, payload: Any | None = None) -> None:
    if condition:
        return
    print(f"FAIL: {message}", file=sys.stderr)
    if payload is not None:
        print(json.dumps(payload, indent=2, sort_keys=True), file=sys.stderr)
    raise SystemExit(1)


async def main() -> None:
    with tempfile.TemporaryDirectory(prefix="nidavellir-orchestration-smoke-") as temp:
        root = Path(temp)
        setup_isolated_app(root / "data")
        target_repo = root / "small-project"

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            plan_response = await client.post("/api/orchestration/plan-inbox", json={
                "rawPlan": "Create and verify a tiny autonomous new-project smoke.",
                "entryMode": "new_project",
                "workLane": "project",
                "repoPath": str(target_repo),
                "baseBranch": "main",
                "provider": "codex",
                "model": "gpt-5.5",
            })
            require(
                plan_response.status_code == 200,
                "plan inbox create failed",
                plan_response.json(),
            )
            plan = plan_response.json()

            preview_response = await client.post("/api/orchestration/plan-inbox/repo-target/preview", json={
                "repoPath": str(target_repo),
                "entryMode": "new_project",
                "baseBranch": "main",
            })
            require(
                preview_response.status_code == 200,
                "repo target preview failed",
                preview_response.json(),
            )
            preview = preview_response.json()
            require(preview["can_create"] is True, "new project target should be creatable", preview)

            readiness_before_response = await client.get("/api/orchestration/readiness")
            require(
                readiness_before_response.status_code == 200,
                "readiness before setup failed",
                readiness_before_response.json(),
            )
            readiness_before = readiness_before_response.json()
            require(
                readiness_before["counts"]["repo_setup_required_count"] == 1,
                "readiness should flag repo setup before initialization",
                readiness_before,
            )

            setup_response = await client.post(
                f"/api/orchestration/plan-inbox/{plan['id']}/repo-target/setup",
                json={
                    "createDirectory": True,
                    "initializeGit": True,
                    "baseBranch": "main",
                    "lockedBy": "orchestration-smoke",
                },
            )
            require(
                setup_response.status_code == 200,
                "new-project repo setup failed",
                setup_response.json(),
            )
            setup = setup_response.json()
            require(target_repo.exists(), "setup did not create target repo")
            require((target_repo / ".git").exists(), "setup did not initialize git", setup)

            configure_git_repo(target_repo)

            readiness_after_response = await client.get("/api/orchestration/readiness")
            require(
                readiness_after_response.status_code == 200,
                "readiness after setup failed",
                readiness_after_response.json(),
            )
            readiness_after = readiness_after_response.json()
            require(
                readiness_after["counts"]["repo_setup_required_count"] == 0,
                "readiness should clear repo setup blocker after initialization",
                readiness_after,
            )

            for gate in ["repo_target", "scope", "acceptance", "verification", "risks", "spec_draft", "spec_approved"]:
                checkpoint_response = await client.patch(
                    f"/api/orchestration/plan-inbox/{plan['id']}/checkpoints/{gate}",
                    json={
                        "status": "agreed",
                        "summary": f"{gate} satisfied by orchestration smoke fixture.",
                    },
                )
                require(
                    checkpoint_response.status_code == 200,
                    f"checkpoint {gate} failed",
                    checkpoint_response.json(),
                )

            spec_response = await client.post(f"/api/orchestration/plan-inbox/{plan['id']}/specs", json={
                "status": "ready",
                "content": "\n".join([
                    "# Agentic Forward Spec",
                    "",
                    "## Task Breakdown",
                    "- Run tiny verification",
                    "",
                    "## Acceptance Criteria",
                    "- The autonomous queue executes the verification command.",
                    "- The evidence bundle captures command output and artifacts.",
                    "",
                    "## Verification Strategy",
                    "- `npm run test`",
                    "",
                    "## Risks and Dependencies",
                    "- The target repo must be initialized before worktree provisioning.",
                ]),
            })
            require(
                spec_response.status_code == 200,
                "ready spec creation failed",
                spec_response.json(),
            )
            spec = spec_response.json()
            require(spec.get("artifact_id"), "spec artifact missing", spec)

            decompose_response = await client.post(f"/api/orchestration/plan-inbox/{plan['id']}/decompose", json={
                "specId": spec["id"],
                "maxTasks": 2,
                "createTaskInboxItems": True,
            })
            require(
                decompose_response.status_code == 200,
                "spec decomposition failed",
                decompose_response.json(),
            )
            decomposed = decompose_response.json()
            require(
                decomposed["decomposition_run"].get("artifact_id"),
                "decomposition artifact missing",
                decomposed["decomposition_run"],
            )
            require(
                len(decomposed["task_inbox_items"]) == 1,
                "decomposition should create one task inbox item",
                decomposed,
            )
            task_inbox_item = decomposed["task_inbox_items"][0]
            task_payload = dict(task_inbox_item["payload"])
            task_payload["skip_agent_step"] = True
            task_update_response = await client.patch(f"/api/orchestration/task-inbox/{task_inbox_item['id']}", json={
                "payload": task_payload,
            })
            require(
                task_update_response.status_code == 200,
                "task inbox payload update failed",
                task_update_response.json(),
            )
            task_inbox_item = task_update_response.json()

            state_response = await client.patch("/api/orchestration/daemon/state", json={
                "status": "active",
                "autonomyMode": "supervised",
                "maxInboxItems": 1,
                "maxQueuedTasks": 1,
                "maxStepsPerTask": 3,
            })
            require(
                state_response.status_code == 200,
                "daemon state enable failed",
                state_response.json(),
            )

            supervised_response = await client.post("/api/orchestration/daemon/tick", json={
                "lockedBy": "orchestration-smoke",
                "permissionOverride": "allow_once",
            })
            require(
                supervised_response.status_code == 200,
                "supervised daemon tick failed",
                supervised_response.json(),
            )
            supervised = supervised_response.json()
            require(
                supervised["execution_queue"]["processed"][0]["waiting_for_autonomy"] is True,
                "supervised mode should queue without executing",
                supervised,
            )
            require(
                supervised["task_inbox"]["processed"][0]["task_inbox_item"]["id"] == task_inbox_item["id"],
                "daemon did not process the expected task inbox item",
                supervised,
            )

            await client.patch(
                "/api/orchestration/daemon/state",
                json={"autonomyMode": "autonomous"},
            )
            autonomous_response = await client.post("/api/orchestration/daemon/tick", json={
                "lockedBy": "orchestration-smoke",
                "permissionOverride": "allow_once",
            })
            require(
                autonomous_response.status_code == 200,
                "autonomous daemon tick failed",
                autonomous_response.json(),
            )
            autonomous = autonomous_response.json()
            processed = autonomous["execution_queue"]["processed"][0]
            final_task = processed["task"]

            require(
                processed["executed"] == 1,
                "autonomous mode did not execute the queued command",
                autonomous,
            )
            require(final_task["status"] == "review", "final task did not move to review", final_task)
            require(
                "orchestration-smoke-ok" in final_task["steps"][0]["output_summary"],
                "verification command output missing expected marker",
                final_task["steps"][0],
            )
            evidence_response = await client.get(f"/api/orchestration/tasks/{final_task['id']}/evidence")
            require(
                evidence_response.status_code == 200,
                "task execution evidence fetch failed",
                evidence_response.json(),
            )
            evidence = evidence_response.json()
            require(
                evidence["summary"]["step_count"] >= 1,
                "execution evidence did not include completed step output",
                evidence,
            )
            require(
                evidence["summary"]["event_count"] >= 2,
                "execution evidence did not include command execution events",
                evidence,
            )
            require(
                evidence["summary"].get("artifact_count", 0) >= 1,
                "execution evidence did not include run artifact",
                evidence,
            )
            require(
                "orchestration-smoke-ok" in evidence["steps"][0]["output_summary"],
                "execution evidence missing verification marker",
                evidence,
            )

            print("orchestration smoke passed")
            print(f"repo: {target_repo}")
            print(f"plan: {plan['id']}")
            print(f"task: {final_task['id']}")
            print(f"output: {final_task['steps'][0]['output_summary']}")
            print(f"evidence: {evidence['summary']['step_count']} steps, {evidence['summary'].get('artifact_count', 0)} artifacts, {evidence['summary']['event_count']} events")


if __name__ == "__main__":
    asyncio.run(main())
