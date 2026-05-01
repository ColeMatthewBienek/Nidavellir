from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest
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

    result = await _runner(request).run(command=command, cwd=str(cwd), timeout_seconds=body.timeoutSeconds)
    return _store(request).create_run(
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


@router.get("/runs")
def list_command_runs(request: Request, conversationId: str | None = None, limit: int = 50) -> list[dict]:
    return _store(request).list_runs(conversation_id=conversationId, limit=limit)
