from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.commands.events import broadcast_command_event
from nidavellir.orchestration import OrchestrationStore
from nidavellir.orchestration.worktrees import (
    WorktreeError,
    create_git_worktree,
    current_branch,
    default_worktree_path,
    git_status,
    remove_git_worktree,
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


class WorktreeCreateRequest(BaseModel):
    nodeId: str | None = None
    repoPath: str | None = None
    baseBranch: str | None = None
    branchName: str | None = None
    worktreePath: str | None = None


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
