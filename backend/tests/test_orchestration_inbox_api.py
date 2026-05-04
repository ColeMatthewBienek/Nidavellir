from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.agents.events import AgentActivityEvent
from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.orchestration import OrchestrationStore
from nidavellir.permissions import PermissionAuditStore, PermissionEvaluator
from nidavellir.permissions.tool_requests import ToolRequestStore
from nidavellir.skills.builtin import ensure_builtin_skills
from nidavellir.skills.store import SkillStore
from nidavellir.tokens.store import TokenUsageStore


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
            "Repo target is now locked: new repo, not initialized yet, at `/projects/NewProject`.\n\n"
            "Scope gate locked: V1 scope is the smallest useful PM planning slice. "
            "Out of scope: autonomous task execution.\n"
            "<nidavellir-pm-actions>"
            "{\"actions\":["
            "{\"type\":\"lock_gate\",\"gate\":\"repo_target\",\"summary\":\"Repo target locked.\",\"evidence\":\"PM selected new repo path.\",\"repo_path\":\"/projects/NewProject\",\"base_branch\":\"main\"},"
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
        assert item["constraints"] == ["Do not start execution before readiness."]
        assert item["acceptance_criteria"] == ["Vague specs are blocked."]

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
        assert turn_body["messages"][1]["metadata"]["active_gate"] == "scope"
        assert turn_body["structured"]["active_gate"] == "scope"
        assert turn_body["structured"]["checkpoint_updates"][0]["key"] == "verification"
        assert turn_body["structured"]["checkpoint_updates"][0]["source_message_ids"] == [turn_body["messages"][0]["id"]]
        assert turn_body["structured"]["spec_deltas"][0]["section"] == "Verification Strategy"
        assert turn_body["messages"][1]["role"] == "planner"
        assert turn_body["messages"][1]["content"].startswith("As Nidavellir PM")

        detail = await c.get(f"/api/orchestration/plan-inbox/{plan['id']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["status"] == "planning"
        assert body["planning_checkpoints"][1]["status"] == "agreed"
        assert body["planning_checkpoints"][3]["status"] == "agreed"
        assert body["planning_checkpoints"][4]["status"] == "agreed"
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

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build a new autonomous project.",
            "acceptanceCriteria": ["Repo target must be durable."],
        })).json()

        turn = await c.post(f"/api/orchestration/plan-inbox/{plan['id']}/pm-turn", json={
            "content": "Repo target is now locked: new repo, not initialized yet, at `/projects/NewProject`. Use `main` as the initial branch.",
            "agentMode": "deterministic",
        })

        assert turn.status_code == 200
        body = turn.json()
        assert body["plan"]["repo_path"] == "/projects/NewProject"
        assert body["plan"]["base_branch"] == "main"
        repo_checkpoint = next(item for item in body["plan"]["planning_checkpoints"] if item["key"] == "repo_target")
        assert repo_checkpoint["status"] == "agreed"
        assert repo_checkpoint["summary"] == "/projects/NewProject @ main"
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
        assert body["plan"]["repo_path"] == "/projects/NewProject"
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
        updated_keys = {item["key"] for item in body["structured"]["checkpoint_updates"]}
        assert "acceptance" in updated_keys
        assert "verification" not in updated_keys


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
async def test_task_inbox_shape_and_em_review_flow(tmp_path: Path):
    setup_app(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        plan = (await c.post("/api/orchestration/plan-inbox", json={
            "rawPlan": "Build queue-backed orchestration intake.",
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

        rejected = (await c.post("/api/orchestration/task-inbox", json={
            "title": "Refactor orchestration backend",
            "objective": "Improve everything",
        })).json()
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
