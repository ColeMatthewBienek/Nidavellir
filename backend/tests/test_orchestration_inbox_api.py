from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.agents.events import AgentActivityEvent
from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.orchestration import OrchestrationStore
from nidavellir.routers import orchestration as orchestration_router
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.permissions.tool_requests import ToolRequestStore
from nidavellir.skills.builtin import ensure_builtin_skills
from nidavellir.skills.store import SkillStore
from nidavellir.tokens.store import TokenUsageStore


def create_git_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-b", "main"], cwd=path, check=True, capture_output=True, text=True)
    subprocess.run(["git", "config", "user.email", "nidavellir@example.test"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.name", "Nidavellir Test"], cwd=path, check=True)
    (path / "README.md").write_text("# test\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=path, check=True)
    subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=path, check=True, capture_output=True, text=True)
    return path


class PlannerPmFakeAgent:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.killed = False

    async def start(self) -> None:
        return None

    async def send(self, text: str) -> None:
        self.sent.append(text)

    async def stream(self):
        yield AgentActivityEvent.progress(provider="codex", content="Reviewing planning gates")
        yield "As Nidavellir PM, agent-backed planning reply."

    async def kill(self) -> None:
        self.killed = True


class PlannerPmGateLockAgent(PlannerPmFakeAgent):
    async def stream(self):
        yield (
            "Repo target is now locked: new repo, not initialized yet, at `/tmp/NewProject`.\n\n"
            "Scope gate locked: V1 scope is the smallest useful PM planning slice. "
            "Out of scope: autonomous task execution.\n"
            "<nidavellir-pm-actions>"
            "{\"actions\":["
            "{\"type\":\"lock_gate\",\"gate\":\"repo_target\",\"summary\":\"Repo target locked.\",\"evidence\":\"PM selected new repo path.\",\"repo_path\":\"/tmp/NewProject\",\"base_branch\":\"main\"},"
            "{\"type\":\"lock_gate\",\"gate\":\"scope\",\"summary\":\"Scope and non-goals locked.\",\"evidence\":\"User confirmed the V1 PM planning slice.\",\"in_scope\":[\"PM planning slice\"],\"non_goals\":[\"autonomous task execution\"]}"
            "]}"
            "</nidavellir-pm-actions>"
        )


class PlannerPmAcceptanceThenVerificationProposalAgent(PlannerPmFakeAgent):
    async def stream(self):
        yield (
            "Acceptance criteria locked.\n\n"
            "Active gate: `verification`.\n\n"
            "Proposed verification plan:\n"
            "- `pnpm install`\n"
            "- `pnpm test`\n"
            "- `sec doctor`\n\n"
            "Focused question: should I lock this verification plan as written?\n"
            "<nidavellir-pm-actions>"
            "{\"actions\":["
            "{\"type\":\"lock_gate\",\"gate\":\"acceptance\",\"summary\":\"Acceptance criteria locked.\",\"evidence\":\"User confirmed proposed acceptance criteria.\",\"criteria\":[\"Repo and scope gates must update from PM discussion.\"]}"
            "]}"
            "</nidavellir-pm-actions>"
        )


class PlannerPmInvalidSidecarAgent(PlannerPmFakeAgent):
    async def stream(self):
        yield (
            "Verification plan proposed, but not locked yet.\n"
            "<nidavellir-pm-actions>"
            "{\"actions\":[{\"type\":\"lock_gate\",\"gate\":\"verification\",\"summary\":\"Verification locked.\",\"evidence\":\"Missing commands should invalidate this.\"}]}"
            "</nidavellir-pm-actions>"
        )


class PlannerPmDuplicateResponseAgent(PlannerPmFakeAgent):
    async def stream(self):
        response = (
            "Step 1 — Stack Detection\n"
            "This is a shell-based project.\n\n"
            "Step 2 — Requirements Clarification\n"
            "Lock the next focused planning question."
        )
        yield f"{response}\n{response}"


def test_planner_pm_relative_repo_name_stays_unresolved(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    default_repo = tmp_path / "nidavellir"
    default_repo.mkdir()
    monkeypatch.setattr(orchestration_router, "effective_default_working_directory", lambda: str(default_repo))

    workdir = orchestration_router._planner_pm_workdir({"repo_path": "security-workstation"})

    assert workdir == default_repo
    assert not (tmp_path / "security-workstation").exists()


def test_planner_pm_absolute_new_repo_workdir_resolves_and_creates_target(tmp_path: Path):
    target = tmp_path / "security-workstation"

    workdir = orchestration_router._planner_pm_workdir({"repo_path": str(target)})

    assert workdir == target
    assert workdir.is_dir()


def test_planner_pm_repo_gate_requires_resolved_path():
    action = orchestration_router._planner_gate_confirmation_action(
        {},
        {
            "role": "planner",
            "metadata": {"active_gate": "repo_target"},
            "content": "Repo target is a new standalone repo: `security-workstation`. Base branch: `main`.",
        },
        "Lock it",
    )

    assert action is None


def setup_app(tmp_path: Path):
    app.state.memory_store = MemoryStore(str(tmp_path / "memory.db"))
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    app.state.skill_store = SkillStore(str(tmp_path / "skills.db"))
    ensure_builtin_skills(app.state.skill_store)
    app.state.permission_evaluator = PermissionEvaluator()
    app.state.permission_audit_store = PermissionAuditStore(str(tmp_path / "permissions.db"))
    app.state.command_store = CommandRunStore(str(tmp_path / "commands.db"))
    app.state.command_runner = CommandRunner()
    app.state.orchestration_store = OrchestrationStore(str(tmp_path / "orchestration.db"))
    app.state.tool_request_store = ToolRequestStore(str(tmp_path / "tool_requests.db"))


@pytest.mark.asyncio
async def test_plan_inbox_spec_and_readiness_report_flow(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        created = await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Automate orchestration planning and task execution.",
            "repoPath": str(tmp_path / "repo"),
            "baseBranch": "main",
            "provider": "codex",
            "model": "gpt-5.5",
            "automationMode": "supervised",
            "maxConcurrency": 1,
            "priority": 1,
            "constraints": ["Do not start execution before readiness."],
            "acceptanceCriteria": ["Vague specs are blocked."],
        })
        assert created.status_code == 200
        item = created.json()
        assert item["status"] == "new"
        assert item["entry_mode"] == "new_project"
        assert item["constraints"] == ["Do not start execution before readiness."]
        assert item["acceptance_criteria"] == ["Vague specs are blocked."]

        existing_project = await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Fix a flaky test in an established repo.",
            "entryMode": "existing_project",
            "repoPath": str(tmp_path / "repo"),
            "baseBranch": "main",
        })
        assert existing_project.status_code == 200
        assert existing_project.json()["entry_mode"] == "existing_project"

        claimed = await c.post(f"/api/orchestration/plan-inbox/{item['id']}/claim", json={"lockedBy": "daemon-1"})
        assert claimed.status_code == 200
        assert claimed.json()["status"] == "claimed"
        assert claimed.json()["locked_by"] == "daemon-1"
        assert claimed.json()["locked_at"]

        report = await c.post(f"/api/orchestration/plan-inbox/{item['id']}/readiness-reports", json={
            "verdict": "needs_clarification",
            "report": {
                "missing_fields": ["verification_strategy"],
                "vague_fields": [{
                    "field": "scope",
                    "reason": "Too broad",
                    "required_clarification": "Name the first execution slice.",
                }],
                "blocking_questions": [{
                    "id": "q1",
                    "question": "Which repo should be modified?",
                    "why_it_matters": "Worktree execution needs a target repo.",
                }],
            },
        })
        assert report.status_code == 200
        assert report.json()["verdict"] == "needs_clarification"
        assert report.json()["report"]["missing_fields"] == ["verification_strategy"]

        spec = await c.post(f"/api/orchestration/plan-inbox/{item['id']}/specs", json={
            "content": "# Goal\nAutomate orchestration.\n# Verification Strategy\nRun tests.",
            "metadata": {"source": "planner"},
            "status": "ready",
        })
        assert spec.status_code == 200
        assert spec.json()["version"] == 1
        assert spec.json()["status"] == "ready"

        detail = await c.get(f"/api/orchestration/plan-inbox/{item['id']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["status"] == "spec_ready"
        assert body["final_spec_id"] == spec.json()["id"]
        assert body["specs"][0]["content"].startswith("# Goal")
        assert body["readiness_reports"][0]["verdict"] == "needs_clarification"
        assert body["discussion_messages"][0]["role"] == "user"
        assert body["discussion_messages"][0]["content"] == "Automate orchestration planning and task execution."

        archived = await c.post(f"/api/orchestration/plan-inbox/{item['id']}/archive")
        assert archived.status_code == 200
        assert archived.json()["archived"] is True
        assert archived.json()["status"] == "cancelled"
        assert archived.json()["deleted_at"]

        active_list = await c.get("/api/orchestration/plan-inbox")
        assert active_list.status_code == 200
        assert all(plan["id"] != item["id"] for plan in active_list.json())

        archived_list = await c.get("/api/orchestration/plan-inbox", params={"includeArchived": True})
        assert archived_list.status_code == 200
        assert any(plan["id"] == item["id"] for plan in archived_list.json())

        deleted = await c.delete(f"/api/orchestration/plan-inbox/{item['id']}")
        assert deleted.status_code == 200
        assert deleted.json() == {"id": item["id"], "deleted": True}

        missing = await c.get(f"/api/orchestration/plan-inbox/{item['id']}")
        assert missing.status_code == 404


@pytest.mark.asyncio
async def test_plan_inbox_planner_discussion_flow(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    setup_app(tmp_path)
    agent = PlannerPmFakeAgent()
    monkeypatch.setattr("nidavellir.routers.orchestration._agent_registry.make_agent", lambda *args, **kwargs: agent)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build autonomous orchestration.",
            "repoPath": "/repo/nidavellir",
            "baseBranch": "main",
            "acceptanceCriteria": ["Planner gates cannot be bypassed from the UI."],
        })).json()

        seeded = await c.get(f"/api/orchestration/plan-inbox/{plan['id']}/discussion")
        assert seeded.status_code == 200
        assert seeded.json()[0]["role"] == "user"
        assert seeded.json()[0]["kind"] == "message"
        assert seeded.json()[0]["content"] == "Build autonomous orchestration."

        checkpoints = await c.get(f"/api/orchestration/plan-inbox/{plan['id']}/checkpoints")
        assert checkpoints.status_code == 200
        assert [item["key"] for item in checkpoints.json()][:3] == ["intake", "repo_target", "scope"]
        assert checkpoints.json()[0]["status"] == "agreed"
        assert checkpoints.json()[1]["status"] == "agreed"
        assert checkpoints.json()[3]["status"] == "agreed"

        question = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/discussion", json={
            "role": "planner",
            "kind": "question",
            "content": "Which repo should autonomous worktrees target?",
            "metadata": {"why_it_matters": "Worktree creation requires a Git baseline."},
        })
        assert question.status_code == 200
        assert question.json()["role"] == "planner"
        assert question.json()["kind"] == "question"

        decision = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/discussion", json={
            "role": "planner",
            "kind": "decision",
            "content": "Decomposer consumes only the approved agentic-forward spec, not raw intake.",
        })
        assert decision.status_code == 200

        turn = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn", json={
            "content": "The repo is local and verification should run the orchestration API tests.",
            "provider": "codex",
            "model": "gpt-5.5",
        })
        assert turn.status_code == 200
        turn_body = turn.json()
        assert turn_body["messages"][0]["role"] == "user"
        assert turn_body["messages"][0]["metadata"]["provider"] == "codex"
        assert turn_body["messages"][1]["metadata"]["model"] == "gpt-5.5"
        assert turn_body["messages"][1]["metadata"]["skill"] == "planner-pm"
        assert turn_body["messages"][1]["metadata"]["harness"] == "main_chat_prompt_assembly"
        assert turn_body["messages"][1]["metadata"]["agent_status"] == "completed"
        assert "planner-pm" in turn_body["messages"][1]["metadata"]["injected_skill_ids"]
        assert "activated skills" in turn_body["messages"][1]["metadata"]["prompt_section_names"]
        assert turn_body["structured"]["harness"]["conversation_id"] == f"planner-pm:{plan['id']}"
        assert turn_body["structured"]["agent"]["status"] == "completed"
        assert "Planner PM skill" in agent.sent[0]
        assert "Read-only repo discovery is allowed" in agent.sent[0]
        assert "Do not run implementation or test loops as the PM" in agent.sent[0]
        assert "do not proceed into Step 4/write tests/implement" in agent.sent[0]
        assert turn_body["messages"][1]["metadata"]["active_gate"] == "scope"
        assert turn_body["structured"]["active_gate"] == "scope"
        assert turn_body["structured"]["checkpoint_updates"] == []
        assert turn_body["structured"]["spec_deltas"] == []
        assert turn_body["messages"][1]["role"] == "planner"
        assert turn_body["messages"][1]["content"].startswith("As Nidavellir PM")

        detail = await c.get(f"/api/orchestration/plan-inbox/{plan['id']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["status"] == "planning"
        assert body["planning_checkpoints"][1]["status"] == "agreed"
        assert body["planning_checkpoints"][3]["status"] == "agreed"
        assert body["planning_checkpoints"][4]["status"] == "missing"
        discussion_contents = [message["content"] for message in body["discussion_messages"]]
        assert "As Nidavellir PM, agent-backed planning reply." in discussion_contents
        assert any(content.startswith("Decomposer consumes") for content in discussion_contents)


@pytest.mark.asyncio
async def test_pm_turn_generates_draft_spec_when_gate_evidence_is_complete(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    setup_app(tmp_path)
    monkeypatch.setattr("nidavellir.routers.orchestration._agent_registry.make_agent", lambda *args, **kwargs: PlannerPmFakeAgent())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build autonomous orchestration.",
            "repoPath": "/repo/nidavellir",
            "baseBranch": "main",
            "acceptanceCriteria": ["Planner gates cannot be bypassed from the UI."],
        })).json()

        turn = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn", json={
            "content": (
                "Scope: first autonomous slice is PM spec drafting only; non-goal is execution. "
                "Verification: run orchestration API tests and typecheck. "
                "Risks: dependency ordering and guardrails must be explicit. Please draft the spec."
            ),
            "provider": "codex",
            "model": "gpt-5.5",
        })

        assert turn.status_code == 200
        body = turn.json()
        assert body["structured"]["active_gate"] == "spec_draft"
        assert body["structured"]["draft_spec"]["status"] == "draft"
        assert body["structured"]["draft_spec"]["content"].startswith("# Agentic Forward Spec")
        assert "PM spec drafting only" in body["structured"]["draft_spec"]["content"]
        assert {item["key"] for item in body["structured"]["checkpoint_updates"]} >= {"scope", "verification", "risks", "spec_draft"}
        assert body["plan"]["specs"][0]["id"] == body["structured"]["draft_spec"]["id"]
        assert body["plan"]["planning_checkpoints"][6]["status"] == "agreed"
        assert body["messages"][1]["metadata"]["draft_spec_id"] == body["structured"]["draft_spec"]["id"]


@pytest.mark.asyncio
async def test_pm_turn_stream_emits_activity_and_answer_chunks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    setup_app(tmp_path)
    monkeypatch.setattr("nidavellir.routers.orchestration._agent_registry.make_agent", lambda *args, **kwargs: PlannerPmFakeAgent())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build autonomous orchestration.",
            "repoPath": "/repo/nidavellir",
            "baseBranch": "main",
            "acceptanceCriteria": ["Planner gates cannot be bypassed from the UI."],
        })).json()

        response = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn/stream", json={
            "content": "Verification should run orchestration API tests.",
            "provider": "codex",
            "model": "gpt-5.5",
        })

        assert response.status_code == 200
        events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        assert events[0]["type"] == "start"
        assert events[-2]["type"] == "result"
        assert events[-1]["type"] == "done"
        assert events[1]["event"]["type"] == "progress"
        assert events[1]["event"]["content"] == "Reviewing planning gates"
        assert "".join(event["content"] for event in events if event["type"] == "chunk") == "As Nidavellir PM, agent-backed planning reply."
        assert events[-2]["result"]["messages"][1]["content"] == "As Nidavellir PM, agent-backed planning reply."


@pytest.mark.asyncio
async def test_pm_turn_locks_repo_target_from_user_evidence(tmp_path: Path):
    setup_app(tmp_path)
    target = tmp_path / "NewProject"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build a new autonomous project.",
            "acceptanceCriteria": ["Repo target must be durable."],
        })).json()

        turn = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn", json={
            "content": f"Repo target is now locked: new repo, not initialized yet, at `{target}`. Use `main` as the initial branch.",
            "agentMode": "deterministic",
        })

        assert turn.status_code == 200
        body = turn.json()
        assert body["plan"]["repo_path"] == str(target)
        assert body["plan"]["base_branch"] == "main"
        repo_checkpoint = next(item for item in body["plan"]["planning_checkpoints"] if item["key"] == "repo_target")
        assert repo_checkpoint["status"] == "agreed"
        assert repo_checkpoint["summary"] == f"{target} @ main"
        assert body["structured"]["checkpoint_updates"][0]["key"] == "repo_target"


@pytest.mark.asyncio
async def test_pm_turn_locks_repo_and_scope_from_agent_gate_response(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    setup_app(tmp_path)
    monkeypatch.setattr("nidavellir.routers.orchestration._agent_registry.make_agent", lambda *args, **kwargs: PlannerPmGateLockAgent())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build a new autonomous project.",
            "acceptanceCriteria": ["Repo and scope gates must update from PM discussion."],
        })).json()

        turn = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn", json={
            "content": "That repo target and scope work for me.",
            "provider": "codex",
            "model": "gpt-5.5",
        })

        assert turn.status_code == 200
        body = turn.json()
        checkpoints = {item["key"]: item for item in body["plan"]["planning_checkpoints"]}
        assert body["plan"]["repo_path"] == "/tmp/NewProject"
        assert checkpoints["repo_target"]["status"] == "agreed"
        assert checkpoints["scope"]["status"] == "agreed"
        updated_keys = {item["key"] for item in body["structured"]["checkpoint_updates"]}
        assert {"repo_target", "scope"} <= updated_keys


@pytest.mark.asyncio
async def test_pm_turn_locks_acceptance_without_locking_proposed_verification(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    setup_app(tmp_path)
    monkeypatch.setattr(
        "nidavellir.routers.orchestration._agent_registry.make_agent",
        lambda *args, **kwargs: PlannerPmAcceptanceThenVerificationProposalAgent(),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build a new autonomous project.",
            "repoPath": "/mnt/c/Users/colebienek/projects/security-workstation",
            "baseBranch": "main",
        })).json()

        turn = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn", json={
            "content": "Lock them",
            "provider": "codex",
            "model": "gpt-5.5",
        })

        assert turn.status_code == 200
        body = turn.json()
        checkpoints = {item["key"]: item for item in body["plan"]["planning_checkpoints"]}
        assert checkpoints["repo_target"]["status"] == "agreed"
        assert checkpoints["acceptance"]["status"] == "agreed"
        assert checkpoints["verification"]["status"] == "missing"
        assert checkpoints["risks"]["status"] == "missing"

        checkpoint_response = await c.get(f"/api/orchestration/plan-inbox/{plan['id']}/checkpoints")
        assert checkpoint_response.status_code == 200
        checkpoint_body = {item["key"]: item for item in checkpoint_response.json()}
        assert checkpoint_body["acceptance"]["status"] == "agreed"
        assert checkpoint_body["verification"]["status"] == "missing"
        assert checkpoint_body["risks"]["status"] == "missing"
        updated_keys = {item["key"] for item in body["structured"]["checkpoint_updates"]}
        assert "acceptance" in updated_keys
        assert "verification" not in updated_keys


@pytest.mark.asyncio
async def test_planner_gate_frontier_replays_confirmations_and_clears_future_false_locks(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build Security Workstation.",
        })).json()

        async def add_message(role: str, content: str, active_gate: str | None = None) -> None:
            response = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/discussion", json={
                "role": role,
                "kind": "question" if role == "planner" else "message",
                "content": content,
                "metadata": {"active_gate": active_gate} if active_gate else {},
            })
            assert response.status_code == 200

        await add_message(
            "planner",
            "Active gate: `repo_target`.\n\nWhich repo/path should this work target?",
            "repo_target",
        )
        await add_message("user", "new repo (not initiated yet) in /projects/NewProject")
        await add_message(
            "planner",
            (
                "Active gate: `repo_target`.\n\n"
                "Recommended lock:\n"
                "`/mnt/c/Users/colebienek/projects/security-workstation`\n\n"
                "Baseline:\n"
                "- initialize a new git repo there\n"
                "- default branch: `main`\n\n"
                "Focused question: should I replace `/projects/NewProject` with "
                "`/mnt/c/Users/colebienek/projects/security-workstation` as the final repo target?"
            ),
            "repo_target",
        )
        await add_message("user", "yes, lock it")
        await add_message(
            "planner",
            (
                "Active gate: `scope`.\n\n"
                "Proposed V1 scope:\n"
                "- global installer\n"
                "- generated `sec` CLI\n\n"
                "Explicit non-goals:\n"
                "- desktop app\n"
                "- browser UI\n\n"
                "Focused question: should I lock this V1 scope as written?"
            ),
            "scope",
        )
        await add_message("user", "Lock as wreitten")
        await add_message(
            "planner",
            (
                "Active gate: `acceptance`.\n\n"
                "Proposed acceptance criteria:\n"
                "- New repo initialized at `/mnt/c/Users/colebienek/projects/security-workstation` on `main`.\n"
                "- `sec doctor` reports local dependency/config health.\n\n"
                "Focused question: should I lock these acceptance criteria as written?"
            ),
            "acceptance",
        )
        await add_message("user", "Lock them")
        await add_message(
            "planner",
            (
                "Acceptance criteria locked.\n\n"
                "Active gate: `verification`.\n\n"
                "Proposed verification plan:\n"
                "- `pnpm install`\n"
                "- `pnpm test`\n\n"
                "Focused question: should I lock this verification plan as written?"
            ),
            "verification",
        )

        store = app.state.orchestration_store
        store.update_planning_checkpoint(
            plan_inbox_item_id=plan["id"],
            key="verification",
            status="agreed",
            summary="Legacy false positive.",
            source_message_ids=["legacy"],
        )
        store.update_planning_checkpoint(
            plan_inbox_item_id=plan["id"],
            key="risks",
            status="agreed",
            summary="Legacy false positive.",
            source_message_ids=["legacy"],
        )

        detail = await c.get(f"/api/orchestration/plan-inbox/{plan['id']}")
        assert detail.status_code == 200
        body = detail.json()
        checkpoints = {item["key"]: item for item in body["planning_checkpoints"]}
        assert body["repo_path"] == "/mnt/c/Users/colebienek/projects/security-workstation"
        assert body["base_branch"] == "main"
        assert checkpoints["repo_target"]["status"] == "agreed"
        assert checkpoints["scope"]["status"] == "agreed"
        assert checkpoints["acceptance"]["status"] == "agreed"
        assert checkpoints["verification"]["status"] == "missing"
        assert checkpoints["risks"]["status"] == "missing"


@pytest.mark.asyncio
async def test_pm_turn_rejects_invalid_sidecar_gate_action(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    setup_app(tmp_path)
    monkeypatch.setattr(
        "nidavellir.routers.orchestration._agent_registry.make_agent",
        lambda *args, **kwargs: PlannerPmInvalidSidecarAgent(),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build a new autonomous project.",
            "repoPath": "/mnt/c/Users/colebienek/projects/security-workstation",
            "baseBranch": "main",
            "acceptanceCriteria": ["Repo and scope gates must update from PM discussion."],
        })).json()

        turn = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn", json={
            "content": "Please continue.",
            "provider": "codex",
            "model": "gpt-5.5",
        })

        assert turn.status_code == 200
        body = turn.json()
        checkpoints = {item["key"]: item for item in body["plan"]["planning_checkpoints"]}
        assert checkpoints["verification"]["status"] == "missing"
        assert "nidavellir-pm-actions" not in body["messages"][1]["content"]


@pytest.mark.asyncio
async def test_pm_turn_collapses_duplicate_provider_response(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    setup_app(tmp_path)
    monkeypatch.setattr(
        "nidavellir.routers.orchestration._agent_registry.make_agent",
        lambda *args, **kwargs: PlannerPmDuplicateResponseAgent(),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build a shell workstation.",
            "repoPath": str(tmp_path / "security-workstation"),
            "baseBranch": "main",
        })).json()

        turn = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn", json={
            "content": "Continue planning.",
            "provider": "codex",
            "model": "gpt-5.5",
        })

        assert turn.status_code == 200
        content = turn.json()["messages"][1]["content"]
        assert content.count("Step 1 — Stack Detection") == 1
        assert content.count("Step 2 — Requirements Clarification") == 1


@pytest.mark.asyncio
async def test_task_inbox_shape_and_em_review_flow(tmp_path: Path):
    setup_app(tmp_path)
    target_repo = tmp_path / "security-workstation"
    target_repo.mkdir()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build queue-backed orchestration intake.",
            "repoPath": str(target_repo),
            "baseBranch": "main",
        })).json()
        spec = (await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/specs", json={
            "content": "# Goal\nBuild queue-backed orchestration intake.",
            "status": "ready",
        })).json()
        decomposition = (await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/decomposition-runs", json={
            "specId": spec["id"],
            "decomposerOutput": {"candidate_tasks": ["task-1"]},
            "status": "created",
        })).json()

        task = await c.post("/api/orchestration/task-inbox", json={
            "planInboxItemId": plan["id"],
            "decompositionRunId": decomposition["id"],
            "candidateTaskId": "task-1",
            "title": "Add durable PlanInbox store methods and API endpoints",
            "objective": "Persist raw user orchestration intake and expose CRUD endpoints.",
            "payload": {
                "single_objective": "PlanInbox persistence and API",
                "affected_areas": ["backend/nidavellir/orchestration/store.py"],
                "verification_steps": [{"type": "command", "command": "uv run pytest backend/tests/test_orchestration_inbox_api.py"}],
            },
            "dependencies": [],
            "priority": 1,
        })
        assert task.status_code == 200
        task_body = task.json()
        assert task_body["status"] == "new"
        assert task_body["payload"]["single_objective"] == "PlanInbox persistence and API"
        assert task_body["payload"]["base_repo_path"] == str(target_repo)
        assert task_body["payload"]["base_branch"] == "main"
        assert task_body["payload"]["implementation_cwd"] == str(target_repo)

        claimed = await c.post(f"/api/orchestration/task-inbox/{task_body['id']}/claim", json={"lockedBy": "em-1"})
        assert claimed.status_code == 200
        assert claimed.json()["status"] == "claimed_by_em"

        shape = await c.post(f"/api/orchestration/task-inbox/{task_body['id']}/shape-reports", json={
            "verdict": "valid",
            "report": {
                "reasons": [],
                "theme_like_indicators": [],
            },
        })
        assert shape.status_code == 200
        assert shape.json()["verdict"] == "valid"

        review = await c.post(f"/api/orchestration/task-inbox/{task_body['id']}/em-reviews", json={
            "verdict": "atomic",
            "report": {
                "bounded_worktree_scope": True,
                "dependency_status": "explicit",
                "blast_radius": "low",
                "verification_independence": "independent",
                "reasons": ["One backend slice with independent tests."],
            },
        })
        assert review.status_code == 200
        assert review.json()["verdict"] == "atomic"

        detail = await c.get(f"/api/orchestration/task-inbox/{task_body['id']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["status"] == "accepted_atomic"
        assert body["shape_reports"][0]["verdict"] == "valid"
        assert body["em_reviews"][0]["verdict"] == "atomic"

        materialized = await c.post(f"/api/orchestration/task-inbox/{task_body['id']}/materialize", json={})
        assert materialized.status_code == 200
        materialized_body = materialized.json()
        assert materialized_body["task"]["base_repo_path"] == str(target_repo)
        assert materialized_body["task"]["base_branch"] == "main"
        assert [node["title"] for node in materialized_body["task"]["nodes"]] == ["Implementation"]
        assert [step["type"] for step in materialized_body["task"]["steps"]] == ["agent", "command"]
        assert materialized_body["task"]["steps"][0]["config"]["requires_worktree"] is True
        assert materialized_body["task"]["steps"][1]["config"]["command"] == "uv run pytest backend/tests/test_orchestration_inbox_api.py"
        assert materialized_body["task"]["readiness"]["runnable"] == [{
            "node_id": materialized_body["task"]["nodes"][0]["id"],
            "step_id": materialized_body["task"]["steps"][0]["id"],
            "step_type": "agent",
        }]
        assert materialized_body["task_inbox_item"]["status"] == "materialized"
        assert materialized_body["task_inbox_item"]["materialized_task_id"] == materialized_body["task"]["id"]

        rejected = (await c.post("/api/orchestration/task-inbox", json={
            "title": "Refactor orchestration backend",
            "objective": "Improve everything",
        })).json()
        premature_materialize = await c.post(f"/api/orchestration/task-inbox/{rejected['id']}/materialize", json={})
        assert premature_materialize.status_code == 400
        assert premature_materialize.json()["detail"] == "task_inbox_item_not_atomic"
        invalid_shape = await c.post(f"/api/orchestration/task-inbox/{rejected['id']}/shape-reports", json={
            "verdict": "invalid",
            "report": {
                "reasons": ["Task is a theme, not an executable unit."],
                "required_rewrite": ["Split into persistence, API, daemon, and UI tasks."],
                "theme_like_indicators": ["refactor", "backend"],
            },
        })
        assert invalid_shape.status_code == 200
        assert invalid_shape.json()["report"]["required_rewrite"] == ["Split into persistence, API, daemon, and UI tasks."]

        em_reject = await c.post(f"/api/orchestration/task-inbox/{rejected['id']}/em-reviews", json={
            "verdict": "not_atomic",
            "report": {
                "blast_radius": "high",
                "required_split": [
                    {"suggested_title": "Add PlanInbox persistence", "reason": "Separate data model from daemon execution."}
                ],
            },
        })
        assert em_reject.status_code == 200
        assert (await c.get(f"/api/orchestration/task-inbox/{rejected['id']}")).json()["status"] == "needs_more_decomposition"


@pytest.mark.asyncio
async def test_decompose_approved_plan_creates_task_inbox_candidates(tmp_path: Path):
    setup_app(tmp_path)
    target_repo = tmp_path / "security-workstation"
    target_repo.mkdir()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build queue-backed orchestration intake.",
            "repoPath": str(target_repo),
            "baseBranch": "main",
            "acceptanceCriteria": ["Plan decomposition produces Task Inbox candidates."],
        })).json()
        for gate in ["repo_target", "scope", "acceptance", "verification", "risks", "spec_draft", "spec_approved"]:
            checkpoint = await c.patch(f"/api/orchestration/plan-inbox/{plan['id']}/checkpoints/{gate}", json={
                "status": "agreed",
                "summary": f"{gate} locked for decomposition.",
            })
            assert checkpoint.status_code == 200
        spec = (await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/specs", json={
            "content": "\n".join([
                "# Agentic Forward Spec",
                "",
                "## Task Breakdown",
                "- Add durable Plan Inbox persistence",
                "- Add Task Inbox EM processing endpoint",
                "",
                "## Acceptance Criteria",
                "- Plan items are decomposed into Task Inbox candidates.",
                "",
                "## Verification Strategy",
                "- `uv run pytest tests/test_orchestration_inbox_api.py`",
            ]),
            "status": "ready",
        })).json()

        decomposed = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/decompose", json={
            "specId": spec["id"],
            "maxTasks": 5,
            "createTaskInboxItems": True,
        })

        assert decomposed.status_code == 200
        body = decomposed.json()
        assert body["plan"]["status"] == "decomposed"
        assert body["decomposition_run"]["spec_id"] == spec["id"]
        assert body["decomposition_run"]["decomposer_output"]["source"] == "deterministic_markdown_decomposer"
        assert [item["title"] for item in body["task_inbox_items"]] == [
            "Add durable Plan Inbox persistence",
            "Add Task Inbox EM processing endpoint",
        ]
        first = body["task_inbox_items"][0]
        assert first["plan_inbox_item_id"] == plan["id"]
        assert first["decomposition_run_id"] == body["decomposition_run"]["id"]
        assert first["payload"]["base_repo_path"] == str(target_repo)
        assert first["payload"]["base_branch"] == "main"
        assert first["payload"]["verification_steps"] == [{
            "type": "command",
            "command": "uv run pytest tests/test_orchestration_inbox_api.py",
        }]


@pytest.mark.asyncio
async def test_task_inbox_process_claims_em_reviews_and_materializes_atomic_items(tmp_path: Path):
    setup_app(tmp_path)
    target_repo = create_git_repo(tmp_path / "security-workstation")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build queue-backed orchestration intake.",
            "repoPath": str(target_repo),
            "baseBranch": "main",
        })).json()

        atomic = (await c.post("/api/orchestration/task-inbox", json={
            "planInboxItemId": plan["id"],
            "title": "Add daemon processing endpoint",
            "objective": "Process one new Task Inbox item through shape review, EM review, and materialization.",
            "payload": {
                "single_objective": "Task Inbox daemon processing endpoint",
                "affected_areas": ["backend/nidavellir/routers/orchestration.py"],
                "verification_steps": [{"type": "command", "command": "uv run pytest tests/test_orchestration_inbox_api.py"}],
            },
            "dependencies": [],
            "priority": 1,
        })).json()
        broad = (await c.post("/api/orchestration/task-inbox", json={
            "title": "Refactor orchestration backend",
            "objective": "Improve everything about orchestration.",
            "payload": {"affected_areas": ["backend/nidavellir/routers/orchestration.py"]},
            "priority": 2,
        })).json()
        missing_target = (await c.post("/api/orchestration/task-inbox", json={
            "title": "Add inbox status copy",
            "objective": "Update Task Inbox card status copy for daemon results.",
            "payload": {
                "single_objective": "Task Inbox status copy",
                "verification_steps": [{"type": "command", "command": "npm test -- src/__tests__/screens/PlanScreen.test.tsx"}],
            },
            "priority": 3,
        })).json()

        processed = await c.post("/api/orchestration/task-inbox/process", json={
            "lockedBy": "em-daemon-test",
            "maxItems": 3,
            "materialize": True,
            "provisionWorktrees": True,
            "queueExecution": True,
        })

        assert processed.status_code == 200
        body = processed.json()
        assert len(body["processed"]) == 3
        by_id = {item["task_inbox_item"]["id"]: item for item in body["processed"]}

        atomic_result = by_id[atomic["id"]]
        assert atomic_result["action"] == "queued_for_execution"
        assert atomic_result["shape_report"]["verdict"] == "valid"
        assert atomic_result["em_review"]["verdict"] == "atomic"
        assert atomic_result["materialization"]["task"]["base_repo_path"] == str(target_repo)
        assert [node["title"] for node in atomic_result["materialization"]["task"]["nodes"]] == ["Implementation"]
        assert [step["type"] for step in atomic_result["materialization"]["task"]["steps"]] == ["agent", "command"]
        assert atomic_result["materialization"]["task"]["readiness"]["runnable"][0]["step_type"] == "agent"
        assert len(atomic_result["worktree_provisioning"]["created"]) == 1
        worktree = atomic_result["worktree_provisioning"]["created"][0]
        assert worktree["kind"] == "execution"
        assert worktree["status"] == "clean"
        assert worktree["node_id"] == atomic_result["materialization"]["task"]["nodes"][0]["id"]
        assert Path(worktree["worktree_path"]).exists()
        prepared_task = atomic_result["materialization"]["task"]
        assert prepared_task["worktrees"][0]["id"] == worktree["id"]
        assert prepared_task["status"] == "queued_for_execution"
        assert atomic_result["execution_queue"]["queued"] is True
        assert atomic_result["task_inbox_item"]["status"] == "materialized"

        broad_result = by_id[broad["id"]]
        assert broad_result["action"] == "needs_more_decomposition"
        assert broad_result["shape_report"]["verdict"] == "invalid"
        assert broad_result["task_inbox_item"]["status"] == "needs_more_decomposition"

        missing_target_result = by_id[missing_target["id"]]
        assert missing_target_result["action"] == "blocked"
        assert missing_target_result["shape_report"]["verdict"] == "valid"
        assert missing_target_result["em_review"]["verdict"] == "blocked"
        assert missing_target_result["em_review"]["report"]["reason"] == "No valid implementation repo target is available."
