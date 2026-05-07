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


def create_git_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-b", "main"], path)
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
        target_repo = create_git_repo(root / "small-project")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            plan_response = await client.post("/api/orchestration/plan-inbox", json={
                "rawPlan": "Run an autonomous existing-project smoke verification.",
                "entryMode": "existing_project",
                "workLane": "chore",
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

            brief_response = await client.post(
                f"/api/orchestration/plan-inbox/{plan['id']}/brief-task",
                json={
                    "maxVerificationSteps": 1,
                    "skipAgentStep": True,
                },
            )
            require(
                brief_response.status_code == 200,
                "existing-project brief failed",
                brief_response.json(),
            )
            brief = brief_response.json()
            require(
                brief["task_inbox_item"]["payload"]["verification_steps"] == [
                    {"type": "command", "command": "npm run test"}
                ],
                "repo inspection did not detect npm test",
                brief["task_inbox_item"]["payload"],
            )

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

            print("orchestration smoke passed")
            print(f"repo: {target_repo}")
            print(f"plan: {plan['id']}")
            print(f"task: {final_task['id']}")
            print(f"output: {final_task['steps'][0]['output_summary']}")


if __name__ == "__main__":
    asyncio.run(main())
