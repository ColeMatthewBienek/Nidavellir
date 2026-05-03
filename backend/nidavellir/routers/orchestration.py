from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.commands.events import broadcast_command_event
from nidavellir.agents import registry as _agent_registry
from nidavellir.agents.events import frontend_event
from nidavellir.orchestration import OrchestrationStore
from nidavellir.orchestration.worktrees import (
    WorktreeError,
    checkpoint_worktree,
    create_git_worktree,
    create_integration_worktree,
    current_branch,
    default_integration_worktree_path,
    default_worktree_path,
    git_status,
    preflight_worktree_merge,
    remove_git_worktree,
    review_worktree,
    repo_root,
    slugify,
)
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest
from nidavellir.resources.events import broadcast_resource_event
from nidavellir.routers.permissions import audit_store, evaluate_and_audit

router = APIRouter(prefix="/api/orchestration", tags=["orchestration"])


class TaskCreateRequest(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    status: str = "backlog"
    priority: int | None = None
    labels: list[str] = Field(default_factory=list)
    conversationId: str | None = None
    baseRepoPath: str | None = None
    baseBranch: str | None = None
    taskBranch: str | None = None
    worktreePath: str | None = None


class TaskUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: int | None = None
    labels: list[str] | None = None
    conversationId: str | None = None
    baseRepoPath: str | None = None
    baseBranch: str | None = None
    taskBranch: str | None = None
    worktreePath: str | None = None


class NodeCreateRequest(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    status: str = "not_started"
    provider: str | None = None
    model: str | None = None
    skillIds: list[str] = Field(default_factory=list)
    positionX: float = 0
    positionY: float = 0


class NodeUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    provider: str | None = None
    model: str | None = None
    skillIds: list[str] | None = None
    positionX: float | None = None
    positionY: float | None = None


class EdgeCreateRequest(BaseModel):
    fromNodeId: str
    toNodeId: str


class StepCreateRequest(BaseModel):
    title: str = Field(min_length=1)
    type: str = "manual"
    description: str = ""
    status: str = "pending"
    config: dict[str, Any] = Field(default_factory=dict)
    outputSummary: str = ""
    orderIndex: int | None = None


class StepStatusRequest(BaseModel):
    status: str
    outputSummary: str | None = None


class StepRunCommandRequest(BaseModel):
    command: str | None = None
    conversationId: str | None = None
    includeInChat: bool = False
    timeoutSeconds: int = Field(default=120, ge=1, le=600)
    permissionOverride: str | None = None


class StepRunAgentRequest(BaseModel):
    prompt: str | None = None
    provider: str | None = None
    model: str | None = None
    conversationId: str | None = None


class TaskRunReadyRequest(BaseModel):
    conversationId: str | None = None
    includeInChat: bool = False
    timeoutSeconds: int = Field(default=120, ge=1, le=600)
    maxSteps: int = Field(default=10, ge=1, le=50)
    permissionOverride: str | None = None


class WorktreeCreateRequest(BaseModel):
    nodeId: str | None = None
    repoPath: str | None = None
    baseBranch: str | None = None
    branchName: str | None = None
    worktreePath: str | None = None


class WorktreeCheckpointRequest(BaseModel):
    message: str | None = None


class WorktreeIntegrationRequest(BaseModel):
    branchName: str | None = None
    worktreePath: str | None = None
    message: str | None = None


def _store(request: Request) -> OrchestrationStore:
    store = getattr(request.app.state, "orchestration_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="orchestration_store_not_available")
    return store


def _command_store(request: Request) -> CommandRunStore:
    store = getattr(request.app.state, "command_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="command_store_not_available")
    return store


def _command_runner(request: Request) -> CommandRunner:
    runner = getattr(request.app.state, "command_runner", None)
    if runner is None:
        runner = CommandRunner()
        request.app.state.command_runner = runner
    return runner


def _handle_store_error(err: Exception) -> None:
    if isinstance(err, KeyError):
        raise HTTPException(status_code=404, detail=str(err).strip("'")) from err
    if isinstance(err, ValueError):
        raise HTTPException(status_code=400, detail=str(err)) from err
    if isinstance(err, sqlite3.IntegrityError):
        raise HTTPException(status_code=400, detail="orchestration_integrity_error") from err
    if isinstance(err, WorktreeError):
        raise HTTPException(status_code=400, detail=str(err)) from err
    raise err


def _default_branch_name(task: dict, node: dict | None) -> str:
    task_slug = slugify(task["title"])
    suffix = slugify(node["title"]) if node else "task"
    unique = uuid.uuid4().hex[:8]
    return f"orchestration/{task_slug}/{suffix}-{unique}"


def _command_from_step(step: dict, command_override: str | None) -> str:
    command = (command_override or step.get("config", {}).get("command") or "").strip()
    if not command:
        raise HTTPException(status_code=400, detail="command_required")
    return command


def _prompt_from_step(step: dict, prompt_override: str | None) -> str:
    prompt = (prompt_override or step.get("config", {}).get("prompt") or step.get("description") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt_required")
    return prompt


def _stringify_agent_event(item: object) -> str:
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        return ""
    to_frontend = getattr(item, "to_frontend", None)
    if callable(to_frontend):
        event = frontend_event(item)
        content = event.get("content") or event.get("detail") or event.get("summary") or event.get("message")
        return f"[{event.get('type', 'activity')}] {content}\n" if content else ""
    return str(item)


def _step_by_id(task: dict, step_id: str) -> dict | None:
    return next((step for step in task.get("steps", []) if step.get("id") == step_id), None)


@router.get("/tasks")
def list_tasks(request: Request) -> list[dict]:
    return _store(request).list_tasks()


@router.post("/tasks")
def create_task(body: TaskCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_task(
            title=body.title,
            description=body.description,
            status=body.status,
            priority=body.priority,
            labels=body.labels,
            conversation_id=body.conversationId,
            base_repo_path=body.baseRepoPath,
            base_branch=body.baseBranch,
            task_branch=body.taskBranch,
            worktree_path=body.worktreePath,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.get("/tasks/{task_id}")
def get_task(task_id: str, request: Request) -> dict:
    task = _store(request).get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    return task


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, body: TaskUpdateRequest, request: Request) -> dict:
    updates = {
        "title": body.title,
        "description": body.description,
        "status": body.status,
        "priority": body.priority,
        "labels": body.labels,
        "conversation_id": body.conversationId,
        "base_repo_path": body.baseRepoPath,
        "base_branch": body.baseBranch,
        "task_branch": body.taskBranch,
        "worktree_path": body.worktreePath,
    }
    try:
        task = _store(request).update_task(task_id, {key: value for key, value in updates.items() if value is not None})
    except Exception as err:
        _handle_store_error(err)
        raise
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    return task


@router.post("/tasks/{task_id}/nodes")
def create_node(task_id: str, body: NodeCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_node(
            task_id=task_id,
            title=body.title,
            description=body.description,
            status=body.status,
            provider=body.provider,
            model=body.model,
            skill_ids=body.skillIds,
            position_x=body.positionX,
            position_y=body.positionY,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.patch("/nodes/{node_id}")
def update_node(node_id: str, body: NodeUpdateRequest, request: Request) -> dict:
    updates = {
        "title": body.title,
        "description": body.description,
        "status": body.status,
        "provider": body.provider,
        "model": body.model,
        "skill_ids": body.skillIds,
        "position_x": body.positionX,
        "position_y": body.positionY,
    }
    try:
        node = _store(request).update_node(node_id, {key: value for key, value in updates.items() if value is not None})
    except Exception as err:
        _handle_store_error(err)
        raise
    if node is None:
        raise HTTPException(status_code=404, detail="node_not_found")
    return node


@router.post("/tasks/{task_id}/edges")
def create_edge(task_id: str, body: EdgeCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_edge(
            task_id=task_id,
            from_node_id=body.fromNodeId,
            to_node_id=body.toNodeId,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.delete("/edges/{edge_id}", status_code=204)
def delete_edge(edge_id: str, request: Request) -> None:
    deleted = _store(request).delete_edge(edge_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="edge_not_found")


@router.post("/nodes/{node_id}/steps")
def create_step(node_id: str, body: StepCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_step(
            node_id=node_id,
            title=body.title,
            type=body.type,
            description=body.description,
            status=body.status,
            config=body.config,
            output_summary=body.outputSummary,
            order_index=body.orderIndex,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.patch("/steps/{step_id}/status")
def update_step_status(step_id: str, body: StepStatusRequest, request: Request) -> dict:
    try:
        step = _store(request).update_step_status(
            step_id,
            status=body.status,
            output_summary=body.outputSummary,
        )
    except Exception as err:
        _handle_store_error(err)
        raise
    if step is None:
        raise HTTPException(status_code=404, detail="step_not_found")
    return step


@router.post("/steps/{step_id}/run-command")
async def run_command_step(step_id: str, body: StepRunCommandRequest, request: Request) -> dict:
    store = _store(request)
    step = store.get_step(step_id)
    if step is None:
        raise HTTPException(status_code=404, detail="step_not_found")
    if step["type"] != "command":
        raise HTTPException(status_code=400, detail="step_not_command")
    node = store.get_node(step["node_id"])
    if node is None:
        raise HTTPException(status_code=404, detail="node_not_found")
    task = store.get_task(node["task_id"])
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    worktree = store.find_worktree_for_node(task_id=task["id"], node_id=node["id"])
    if worktree is None:
        raise HTTPException(status_code=400, detail="worktree_required")
    command = _command_from_step(step, body.command)
    cwd = Path(worktree["worktree_path"]).expanduser().resolve()
    if not cwd.exists() or not cwd.is_dir():
        store.update_worktree(worktree["id"], {"status": "missing", "dirty_count": 0, "dirty_summary": []})
        raise HTTPException(status_code=400, detail="worktree_missing")

    decision = evaluate_and_audit(
        request,
        PermissionEvaluationRequest(
            action="shell_command",
            command=command,
            actor="agent",
            workspace=str(cwd),
            conversation_id=body.conversationId or task.get("conversation_id"),
            metadata={
                "source": "orchestration.command_step",
                "task_id": task["id"],
                "node_id": node["id"],
                "step_id": step_id,
                "worktree_id": worktree["id"],
            },
        ),
    )
    if decision.decision == PermissionDecision.ASK:
        if body.permissionOverride == PermissionDecision.ALLOW_ONCE.value:
            audit_store(request).log(
                PermissionEvaluationRequest(
                    action="shell_command",
                    command=command,
                    actor="agent",
                    workspace=str(cwd),
                    conversation_id=body.conversationId or task.get("conversation_id"),
                    metadata={
                        "source": "orchestration.command_step",
                        "override": "allow_once",
                        "task_id": task["id"],
                        "node_id": node["id"],
                        "step_id": step_id,
                        "worktree_id": worktree["id"],
                    },
                ),
                decision.model_copy(update={
                    "decision": PermissionDecision.ALLOW_ONCE,
                    "reason": f"allow_once override: {decision.reason}",
                    "requires_user_choice": False,
                }),
            )
        else:
            raise HTTPException(status_code=403, detail={
                "code": "permission_required",
                "permission": decision.model_dump(mode="json"),
            })
    elif decision.decision == PermissionDecision.DENY:
        raise HTTPException(status_code=403, detail={
            "code": "permission_denied",
            "permission": decision.model_dump(mode="json"),
        })

    run_id = str(uuid.uuid4())
    conversation_id = body.conversationId or task.get("conversation_id")
    store.update_step_status(step_id, "running", output_summary="Command running.")
    store.append_event(
        task_id=task["id"],
        node_id=node["id"],
        step_id=step_id,
        type="command_step_started",
        payload={"command": command, "worktree_id": worktree["id"], "run_id": run_id},
    )

    async def emit(event: dict) -> None:
        await broadcast_command_event(request.app, {
            **event,
            "run_id": run_id,
            "conversation_id": conversation_id,
            "command": command,
            "cwd": str(cwd),
            "orchestration_task_id": task["id"],
            "orchestration_node_id": node["id"],
            "orchestration_step_id": step_id,
        })

    result = await _command_runner(request).run(
        command=command,
        cwd=str(cwd),
        timeout_seconds=body.timeoutSeconds,
        on_event=emit,
    )
    run = _command_store(request).create_run(
        run_id=run_id,
        conversation_id=conversation_id,
        command=command,
        cwd=str(cwd),
        exit_code=result["exit_code"],
        stdout=result["stdout"],
        stderr=result["stderr"],
        timed_out=result["timed_out"],
        include_in_chat=body.includeInChat,
        added_to_working_set=False,
        duration_ms=result["duration_ms"],
    )
    output = result["stdout"] or result["stderr"]
    summary = output.strip().splitlines()[-1][:240] if output.strip() else f"Command exited {result['exit_code']}"
    status = "failed" if result["timed_out"] or result["exit_code"] not in (0, None) else "complete"
    updated_step = store.update_step_status(step_id, status, output_summary=summary)
    try:
        info = git_status(cwd)
        worktree = store.update_worktree(worktree["id"], {
            "head_commit": info["head_commit"],
            "status": info["status"],
            "dirty_count": info["dirty_count"],
            "dirty_summary": info["dirty_summary"],
        }) or worktree
    except Exception:
        worktree = store.update_worktree(worktree["id"], {"status": "error"}) or worktree
    store.append_event(
        task_id=task["id"],
        node_id=node["id"],
        step_id=step_id,
        type="command_step_finished",
        payload={"run_id": run_id, "exit_code": result["exit_code"], "status": status, "worktree_id": worktree["id"]},
    )
    await broadcast_resource_event(request.app, {
        "kind": "orchestration",
        "action": "command_step_finished",
        "conversation_id": conversation_id,
        "run_id": run_id,
        "message": "Orchestration command step captured",
    })
    return {"step": updated_step, "run": run, "worktree": worktree}


@router.post("/steps/{step_id}/run-agent")
async def run_agent_step(step_id: str, body: StepRunAgentRequest, request: Request) -> dict:
    store = _store(request)
    step = store.get_step(step_id)
    if step is None:
        raise HTTPException(status_code=404, detail="step_not_found")
    if step["type"] != "agent":
        raise HTTPException(status_code=400, detail="step_not_agent")
    node = store.get_node(step["node_id"])
    if node is None:
        raise HTTPException(status_code=404, detail="node_not_found")
    task = store.get_task(node["task_id"])
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    worktree = store.find_worktree_for_node(task_id=task["id"], node_id=node["id"])
    if worktree is None:
        raise HTTPException(status_code=400, detail="worktree_required")
    cwd = Path(worktree["worktree_path"]).expanduser().resolve()
    if not cwd.exists() or not cwd.is_dir():
        store.update_worktree(worktree["id"], {"status": "missing", "dirty_count": 0, "dirty_summary": []})
        raise HTTPException(status_code=400, detail="worktree_missing")

    provider = body.provider or node.get("provider") or step.get("config", {}).get("provider") or "codex"
    model = body.model or node.get("model") or step.get("config", {}).get("model")
    manifest = _agent_registry.PROVIDER_REGISTRY.get(provider)
    if manifest is None:
        raise HTTPException(status_code=400, detail="provider_not_found")
    if not manifest.supports_worktree_isolation:
        raise HTTPException(status_code=400, detail="provider_does_not_support_worktree_isolation")
    prompt = _prompt_from_step(step, body.prompt)
    conversation_id = body.conversationId or task.get("conversation_id")
    handoff_prompt = (
        "You are executing a Nidavellir orchestration agent step.\n"
        f"Task: {task['title']}\n"
        f"Node: {node['title']}\n"
        f"Worktree: {cwd}\n\n"
        "Rules:\n"
        "- Work only inside the provided worktree.\n"
        "- Do not switch branches or create/delete worktrees.\n"
        "- Report the files changed and tests run.\n\n"
        f"Step instructions:\n{prompt}"
    )

    attempt = store.create_run_attempt(
        task_id=task["id"],
        node_id=node["id"],
        step_id=step_id,
        conversation_id=conversation_id,
        provider=provider,
        model=model,
        worktree_path=str(cwd),
        status="running",
    )
    store.update_step_status(step_id, "running", output_summary="Agent running.")
    store.append_event(
        task_id=task["id"],
        node_id=node["id"],
        step_id=step_id,
        run_attempt_id=attempt["id"],
        type="agent_step_started",
        payload={"provider": provider, "model": model, "worktree_id": worktree["id"]},
    )

    agent = None
    transcript_parts: list[str] = []
    try:
        agent = _agent_registry.make_agent(provider, slot_id=0, workdir=cwd, model_id=model)
        await agent.start()
        await agent.send(handoff_prompt)
        async for item in agent.stream():
            text = _stringify_agent_event(item)
            if text:
                transcript_parts.append(text)
        transcript = "".join(transcript_parts).strip()
        summary = transcript.splitlines()[-1][:240] if transcript else "Agent step completed."
        updated_step = store.update_step_status(step_id, "complete", output_summary=summary)
        attempt = store.update_run_attempt(attempt["id"], status="completed") or attempt
        try:
            info = git_status(cwd)
            worktree = store.update_worktree(worktree["id"], {
                "head_commit": info["head_commit"],
                "status": info["status"],
                "dirty_count": info["dirty_count"],
                "dirty_summary": info["dirty_summary"],
            }) or worktree
        except Exception:
            worktree = store.update_worktree(worktree["id"], {"status": "error"}) or worktree
        store.append_event(
            task_id=task["id"],
            node_id=node["id"],
            step_id=step_id,
            run_attempt_id=attempt["id"],
            type="agent_step_finished",
            payload={"provider": provider, "model": model, "status": "complete", "worktree_id": worktree["id"]},
        )
        await broadcast_resource_event(request.app, {
            "kind": "orchestration",
            "action": "agent_step_finished",
            "conversation_id": conversation_id,
            "message": "Orchestration agent step completed",
        })
        return {
            "step": updated_step,
            "run_attempt": attempt,
            "worktree": worktree,
            "transcript": transcript,
        }
    except Exception as exc:
        error = str(exc)
        updated_step = store.update_step_status(step_id, "failed", output_summary=error[:240])
        attempt = store.update_run_attempt(attempt["id"], status="failed", error=error) or attempt
        store.append_event(
            task_id=task["id"],
            node_id=node["id"],
            step_id=step_id,
            run_attempt_id=attempt["id"],
            type="agent_step_failed",
            payload={"provider": provider, "model": model, "error": error},
        )
        return {
            "step": updated_step,
            "run_attempt": attempt,
            "worktree": worktree,
            "transcript": "".join(transcript_parts).strip(),
        }
    finally:
        if agent is not None:
            try:
                await agent.kill()
            except Exception:
                pass


@router.post("/tasks/{task_id}/run-ready")
async def run_ready_steps(task_id: str, body: TaskRunReadyRequest, request: Request) -> dict:
    store = _store(request)
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    results: list[dict] = []
    pending_manual: list[dict] = []
    executed = 0

    while executed < body.maxSteps:
        task = store.get_task(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="task_not_found")
        runnable = task.get("readiness", {}).get("runnable", [])
        next_item = None
        pending_manual = []
        for item in runnable:
            step = _step_by_id(task, item["step_id"])
            if step is None:
                continue
            if step["type"] in {"command", "agent"}:
                next_item = item
                break
            pending_manual.append({
                "node_id": item["node_id"],
                "step_id": item["step_id"],
                "step_type": step["type"],
                "title": step["title"],
            })
        if next_item is None:
            break

        step = _step_by_id(task, next_item["step_id"])
        if step is None:
            break
        if step["type"] == "command":
            result = await run_command_step(
                step["id"],
                StepRunCommandRequest(
                    conversationId=body.conversationId or task.get("conversation_id"),
                    includeInChat=body.includeInChat,
                    timeoutSeconds=body.timeoutSeconds,
                    permissionOverride=body.permissionOverride,
                ),
                request,
            )
        else:
            result = await run_agent_step(
                step["id"],
                StepRunAgentRequest(
                    conversationId=body.conversationId or task.get("conversation_id"),
                ),
                request,
            )
        results.append({
            "node_id": next_item["node_id"],
            "step_id": step["id"],
            "step_type": step["type"],
            "status": result.get("step", {}).get("status"),
            "result": result,
        })
        executed += 1
        if result.get("step", {}).get("status") == "failed":
            break

    final_task = store.get_task(task_id)
    store.append_event(
        task_id=task_id,
        type="run_ready_finished",
        payload={
            "executed": executed,
            "pending_manual": pending_manual,
            "max_steps": body.maxSteps,
        },
    )
    return {
        "task": final_task,
        "executed": executed,
        "results": results,
        "pending_manual": pending_manual,
    }


@router.get("/tasks/{task_id}/worktrees")
def list_task_worktrees(task_id: str, request: Request) -> list[dict]:
    if _store(request).get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    return _store(request).list_worktrees(task_id=task_id)


@router.post("/tasks/{task_id}/worktrees")
def create_worktree(task_id: str, body: WorktreeCreateRequest, request: Request) -> dict:
    store = _store(request)
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    node = None
    if body.nodeId:
        node = store.get_node(body.nodeId)
        if node is None:
            raise HTTPException(status_code=404, detail="node_not_found")
        if node["task_id"] != task_id:
            raise HTTPException(status_code=400, detail="worktree_node_must_belong_to_task")
    try:
        source_repo = Path(body.repoPath or task.get("base_repo_path") or ".").expanduser().resolve()
        root = repo_root(source_repo)
        base_branch = body.baseBranch or task.get("task_branch") or task.get("base_branch") or current_branch(root)
        branch_name = body.branchName or _default_branch_name(task, node)
        target_path = Path(body.worktreePath).expanduser().resolve() if body.worktreePath else default_worktree_path(root, branch_name)
        git_info = create_git_worktree(
            repo_path=root,
            worktree_path=target_path,
            branch_name=branch_name,
            base_ref=base_branch,
        )
        return store.create_worktree(
            task_id=task_id,
            node_id=body.nodeId,
            repo_path=git_info["repo_path"],
            worktree_path=git_info["worktree_path"],
            kind="execution" if body.nodeId else "task",
            base_branch=base_branch,
            branch_name=branch_name,
            base_commit=git_info["base_commit"],
            head_commit=git_info["head_commit"],
            status=git_info["status"],
            dirty_count=git_info["dirty_count"],
            dirty_summary=git_info["dirty_summary"],
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.post("/worktrees/{worktree_id}/refresh")
def refresh_worktree(worktree_id: str, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    try:
        info = git_status(Path(worktree["worktree_path"]))
        updated = store.update_worktree(worktree_id, {
            "head_commit": info["head_commit"],
            "status": info["status"],
            "dirty_count": info["dirty_count"],
            "dirty_summary": info["dirty_summary"],
        })
    except Exception as err:
        _handle_store_error(err)
        raise
    if updated is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    return updated


@router.post("/worktrees/{worktree_id}/checkpoint")
async def checkpoint_orchestration_worktree(worktree_id: str, body: WorktreeCheckpointRequest, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    message = body.message or f"Checkpoint {worktree['branch_name']}"
    try:
        result = checkpoint_worktree(
            worktree_path=Path(worktree["worktree_path"]),
            message=message,
        )
        info = result["status"]
        updated = store.update_worktree(worktree_id, {
            "head_commit": info["head_commit"],
            "status": info["status"],
            "dirty_count": info["dirty_count"],
            "dirty_summary": info["dirty_summary"],
        })
    except Exception as err:
        _handle_store_error(err)
        raise
    if updated is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_checkpointed",
        payload={
            "worktree_id": worktree_id,
            "branch_name": worktree["branch_name"],
            "commit": result["commit"],
            "message": result["message"],
        },
    )
    await broadcast_resource_event(request.app, {
        "kind": "orchestration",
        "action": "worktree_checkpointed",
        "conversation_id": None,
        "message": "Orchestration worktree checkpoint committed",
    })
    return {"worktree": updated, "commit": result["commit"], "message": result["message"]}


@router.get("/worktrees/{worktree_id}/review")
def review_orchestration_worktree(worktree_id: str, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    base_ref = worktree.get("base_commit") or worktree.get("base_branch")
    if not base_ref:
        raise HTTPException(status_code=400, detail="worktree_base_ref_missing")
    try:
        review = review_worktree(
            worktree_path=Path(worktree["worktree_path"]),
            base_ref=base_ref,
        )
        updated = store.update_worktree(worktree_id, {
            "head_commit": review["head_commit"],
            "status": review["status"],
            "dirty_count": review["dirty_count"],
            "dirty_summary": review["dirty_summary"],
        })
    except Exception as err:
        _handle_store_error(err)
        raise
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_reviewed",
        payload={
            "worktree_id": worktree_id,
            "branch_name": worktree["branch_name"],
            "commit_count": review["commit_count"],
            "file_count": len(review["files"]),
            "ready_to_merge": review["ready_to_merge"],
        },
    )
    return {"worktree": updated or worktree, "review": review}


@router.get("/worktrees/{worktree_id}/integration-proposal")
def propose_worktree_integration(worktree_id: str, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    task = store.get_task(worktree["task_id"])
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    node = store.get_node(worktree["node_id"]) if worktree.get("node_id") else None
    base_ref = worktree.get("base_commit") or worktree.get("base_branch")
    if not base_ref:
        raise HTTPException(status_code=400, detail="worktree_base_ref_missing")
    try:
        review = review_worktree(
            worktree_path=Path(worktree["worktree_path"]),
            base_ref=base_ref,
        )
    except Exception as err:
        _handle_store_error(err)
        raise
    title_subject = node["title"] if node else task["title"]
    title = f"Integrate orchestration work: {title_subject}"
    commit_lines = "\n".join(f"- `{item['short_sha']}` {item['subject']}" for item in review["commits"][:10]) or "- No commits"
    file_lines = "\n".join(f"- `{item['status']}` {item['path']}" for item in review["files"][:20]) or "- No changed files"
    body = (
        "## Orchestration Integration\n"
        f"- Task: {task['title']}\n"
        f"- Node: {(node or {}).get('title') or 'Task branch'}\n"
        f"- Source branch: `{worktree['branch_name']}`\n"
        f"- Target branch: `{worktree['base_branch']}`\n"
        f"- Commit range: `{base_ref}..{review['head_commit']}`\n"
        f"- Status: {'ready' if review['ready_to_merge'] else 'needs attention'}\n\n"
        "## Commits\n"
        f"{commit_lines}\n\n"
        "## Files\n"
        f"{file_lines}\n\n"
        "## Diff Stat\n"
        f"{review['shortstat'] or 'No diff'}\n"
    )
    proposal = {
        "title": title,
        "body": body,
        "source_branch": worktree["branch_name"],
        "target_branch": worktree["base_branch"],
        "base_ref": base_ref,
        "head_commit": review["head_commit"],
        "ready_to_merge": review["ready_to_merge"],
        "review": review,
    }
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_integration_proposed",
        payload={
            "worktree_id": worktree_id,
            "source_branch": proposal["source_branch"],
            "target_branch": proposal["target_branch"],
            "ready_to_merge": proposal["ready_to_merge"],
        },
    )
    return {"worktree": worktree, "proposal": proposal}


@router.get("/worktrees/{worktree_id}/integration-preflight")
def preflight_worktree_integration(worktree_id: str, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    target_ref = worktree.get("base_branch")
    source_ref = worktree.get("branch_name")
    if not target_ref or not source_ref:
        raise HTTPException(status_code=400, detail="worktree_merge_refs_missing")
    try:
        preflight = preflight_worktree_merge(
            worktree_path=Path(worktree["worktree_path"]),
            target_ref=target_ref,
            source_ref=source_ref,
        )
        updated = store.update_worktree(worktree_id, {
            "head_commit": preflight["source_commit"],
            "status": preflight["status"],
            "dirty_count": preflight["dirty_count"],
            "dirty_summary": preflight["dirty_summary"],
        })
    except Exception as err:
        _handle_store_error(err)
        raise
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_integration_preflighted",
        payload={
            "worktree_id": worktree_id,
            "source_branch": source_ref,
            "target_branch": target_ref,
            "can_merge": preflight["can_merge"],
            "conflict_count": len(preflight["conflicts"]),
        },
    )
    return {"worktree": updated or worktree, "preflight": preflight}


@router.post("/worktrees/{worktree_id}/integration-worktree")
def stage_worktree_integration(worktree_id: str, request: Request, body: WorktreeIntegrationRequest | None = None) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    target_ref = worktree.get("base_branch")
    source_ref = worktree.get("branch_name")
    if not target_ref or not source_ref:
        raise HTTPException(status_code=400, detail="worktree_merge_refs_missing")
    body = body or WorktreeIntegrationRequest()
    branch_name = body.branchName or f"integration/{slugify(source_ref)}-{uuid.uuid4().hex[:8]}"
    target_path = (
        Path(body.worktreePath).expanduser().resolve()
        if body.worktreePath
        else default_integration_worktree_path(Path(worktree["repo_path"]), branch_name)
    )
    message = body.message or f"Integrate {source_ref}"
    try:
        integration = create_integration_worktree(
            repo_path=Path(worktree["repo_path"]),
            worktree_path=target_path,
            branch_name=branch_name,
            target_ref=target_ref,
            source_ref=source_ref,
            message=message,
        )
        integration_worktree = store.create_worktree(
            task_id=worktree["task_id"],
            node_id=worktree["node_id"],
            repo_path=worktree["repo_path"],
            worktree_path=integration["worktree_path"],
            kind="integration",
            base_branch=target_ref,
            branch_name=integration["branch_name"],
            base_commit=integration["base_commit"],
            head_commit=integration["head_commit"],
            status=integration["status"],
            dirty_count=integration["dirty_count"],
            dirty_summary=integration["dirty_summary"],
        )
    except Exception as err:
        _handle_store_error(err)
        raise
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_integration_staged",
        payload={
            "source_worktree_id": worktree_id,
            "source_branch": source_ref,
            "target_branch": target_ref,
            "integration_branch": integration["branch_name"],
            "integration_worktree_path": integration["worktree_path"],
            "merged": integration["merged"],
        },
    )
    return {"source_worktree": worktree, "integration_worktree": integration_worktree, "integration": integration}


@router.delete("/worktrees/{worktree_id}")
def delete_worktree(worktree_id: str, request: Request, removeGitWorktree: bool = True) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    try:
        if removeGitWorktree:
            remove_git_worktree(repo_path=Path(worktree["repo_path"]), worktree_path=Path(worktree["worktree_path"]))
        updated = store.mark_worktree_removed(worktree_id)
    except Exception as err:
        _handle_store_error(err)
        raise
    if updated is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    return updated


@router.get("/tasks/{task_id}/events")
def list_task_events(task_id: str, request: Request, limit: int = 100) -> list[dict]:
    return _store(request).list_events(task_id=task_id, limit=limit)
