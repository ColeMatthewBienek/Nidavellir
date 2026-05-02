from __future__ import annotations

from pathlib import Path
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from nidavellir.commands.events import broadcast_command_event
from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest
from nidavellir.resources.events import broadcast_resource_event
from nidavellir.routers.permissions import audit_store, evaluate_and_audit
from nidavellir.workspace import effective_default_working_directory, normalize_working_directory

router = APIRouter(prefix="/api/commands", tags=["commands"])


class CommandRunRequest(BaseModel):
    command: str
    cwd: str | None = None
    conversationId: str | None = None
    includeInChat: bool = False
    addToWorkingSet: bool = False
    timeoutSeconds: int = Field(default=120, ge=1, le=600)
    permissionOverride: str | None = None


class CommandAttachmentRequest(BaseModel):
    includeInChat: bool = True


def _preset_exists(cwd: Path, marker: str) -> bool:
    return (cwd / marker).exists()


def _default_presets(cwd: Path) -> list[dict]:
    presets: list[dict] = []
    if _preset_exists(cwd, "frontend/package.json"):
        presets.extend([
            {"id": "frontend-typecheck", "label": "FE typecheck", "command": "cd frontend && npm run typecheck"},
            {"id": "frontend-test", "label": "FE tests", "command": "cd frontend && npm run test -- --run"},
            {"id": "frontend-build", "label": "FE build", "command": "cd frontend && npm run build"},
        ])
    elif _preset_exists(cwd, "package.json"):
        presets.extend([
            {"id": "npm-test", "label": "npm test", "command": "npm test"},
            {"id": "npm-build", "label": "npm build", "command": "npm run build"},
        ])
    if _preset_exists(cwd, "backend/pyproject.toml"):
        presets.append({"id": "backend-tests", "label": "BE tests", "command": "cd backend && uv run python -m pytest"})
    elif _preset_exists(cwd, "pyproject.toml"):
        presets.append({"id": "pytest", "label": "pytest", "command": "uv run python -m pytest"})
    if _preset_exists(cwd, "fallow.json") or _preset_exists(cwd, "frontend/package.json") or _preset_exists(cwd, "package.json"):
        presets.append({"id": "fallow-dead-code", "label": "Fallow", "command": "npx fallow dead-code --format json --quiet"})
    return presets


def _store(request: Request) -> CommandRunStore:
    store = getattr(request.app.state, "command_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="command_store_not_available")
    return store


def _runner(request: Request) -> CommandRunner:
    runner = getattr(request.app.state, "command_runner", None)
    if runner is None:
        runner = CommandRunner()
        request.app.state.command_runner = runner
    return runner


def _resolve_cwd(path_value: str | None) -> Path:
    normalized = normalize_working_directory(path_value or effective_default_working_directory())
    if not normalized.exists:
        raise HTTPException(status_code=400, detail="directory_not_found")
    if not normalized.is_directory:
        raise HTTPException(status_code=400, detail="not_a_directory")
    return Path(normalized.path)


@router.post("/run")
async def run_command(body: CommandRunRequest, request: Request) -> dict:
    command = body.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="command_required")
    cwd = _resolve_cwd(body.cwd)
    run_id = str(uuid.uuid4())
    decision = evaluate_and_audit(
        request,
        PermissionEvaluationRequest(
            action="shell_command",
            command=command,
            actor="user",
            workspace=str(cwd),
            conversation_id=body.conversationId,
            metadata={"source": "commands.run"},
        ),
    )
    if decision.decision == PermissionDecision.ASK:
        if body.permissionOverride == PermissionDecision.ALLOW_ONCE.value:
            audit_store(request).log(
                PermissionEvaluationRequest(
                    action="shell_command",
                    command=command,
                    actor="user",
                    workspace=str(cwd),
                    conversation_id=body.conversationId,
                    metadata={"source": "commands.run", "override": "allow_once"},
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

    async def emit(event: dict) -> None:
        await broadcast_command_event(request.app, {
            **event,
            "run_id": run_id,
            "conversation_id": body.conversationId,
            "command": command,
            "cwd": str(cwd),
        })

    result = await _runner(request).run(
        command=command,
        cwd=str(cwd),
        timeout_seconds=body.timeoutSeconds,
        on_event=emit,
    )
    run = _store(request).create_run(
        run_id=run_id,
        conversation_id=body.conversationId,
        command=command,
        cwd=str(cwd),
        exit_code=result["exit_code"],
        stdout=result["stdout"],
        stderr=result["stderr"],
        timed_out=result["timed_out"],
        include_in_chat=body.includeInChat,
        added_to_working_set=body.addToWorkingSet,
        duration_ms=result["duration_ms"],
    )
    await broadcast_resource_event(request.app, {
        "kind": "commands",
        "action": "captured",
        "conversation_id": body.conversationId,
        "run_id": run_id,
        "message": "Command run captured",
    })
    return run


@router.get("/runs")
def list_command_runs(request: Request, conversationId: str | None = None, limit: int = 50) -> list[dict]:
    return _store(request).list_runs(conversation_id=conversationId, limit=limit)


@router.get("/presets")
def list_command_presets(cwd: str | None = None) -> list[dict]:
    return _default_presets(_resolve_cwd(cwd))


@router.post("/runs/{run_id}/chat-attachment")
async def set_command_chat_attachment(run_id: str, body: CommandAttachmentRequest, request: Request) -> dict:
    run = _store(request).set_include_in_chat(run_id, body.includeInChat)
    if run is None:
        raise HTTPException(status_code=404, detail="command_run_not_found")
    await broadcast_resource_event(request.app, {
        "kind": "command_attachments",
        "action": "attached" if body.includeInChat else "detached",
        "conversation_id": run.get("conversation_id"),
        "run_id": run_id,
        "message": "Command attachment updated",
    })
    return run
