from __future__ import annotations

from pathlib import Path
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from nidavellir.commands import CommandRunner
from nidavellir.commands.events import broadcast_command_event
from nidavellir.permissions.policy import PermissionAction, PermissionDecision, PermissionEvaluationRequest
from nidavellir.permissions.tool_requests import ToolRequestStore
from nidavellir.resources.events import broadcast_resource_event
from nidavellir.routers.permissions import audit_store, evaluate_and_audit
from nidavellir.workspace import effective_default_working_directory

router = APIRouter(prefix="/api/tool-requests", tags=["tool-requests"])


class ToolRequestCreate(BaseModel):
    conversationId: str | None = None
    provider: str
    toolName: str
    action: PermissionAction
    path: str | None = None
    command: str | None = None
    workspace: str | None = None
    arguments: dict = Field(default_factory=dict)


class ToolRequestResolve(BaseModel):
    reason: str | None = None


def _store(request: Request) -> ToolRequestStore:
    store = getattr(request.app.state, "tool_request_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="tool_request_store_not_available")
    return store


def _command_store(request: Request):
    return getattr(request.app.state, "command_store", None)


def _runner(request: Request) -> CommandRunner:
    runner = getattr(request.app.state, "command_runner", None)
    if runner is None:
        runner = CommandRunner()
        request.app.state.command_runner = runner
    return runner


def _workspace(item: dict) -> Path:
    return Path(item.get("workspace") or effective_default_working_directory()).expanduser().resolve(strict=False)


def _target_path(item: dict) -> Path:
    path = item.get("path") or (item.get("arguments") or {}).get("path")
    if not path:
        raise HTTPException(status_code=400, detail="tool_request_path_required")
    raw = Path(str(path)).expanduser()
    if not raw.is_absolute():
        raw = _workspace(item) / raw
    return raw.resolve(strict=False)


async def _execute_tool_request(item: dict, request: Request) -> dict:
    action = item["action"]
    args = item.get("arguments") or {}
    conversation_id = item.get("conversation_id")
    if action == "shell_command":
        command = item.get("command") or args.get("command")
        if not command:
            raise HTTPException(status_code=400, detail="tool_request_command_required")
        cwd = _workspace(item)
        run_id = str(uuid.uuid4())

        async def emit(event: dict) -> None:
            await broadcast_command_event(request.app, {
                **event,
                "run_id": run_id,
                "conversation_id": conversation_id,
                "command": command,
                "cwd": str(cwd),
            })

        result = await _runner(request).run(
            command=str(command),
            cwd=str(cwd),
            timeout_seconds=int(args.get("timeoutSeconds") or 120),
            on_event=emit,
        )
        command_store = _command_store(request)
        run = None
        if command_store:
            run = command_store.create_run(
                run_id=run_id,
                conversation_id=conversation_id,
                command=str(command),
                cwd=str(cwd),
                exit_code=result["exit_code"],
                stdout=result["stdout"],
                stderr=result["stderr"],
                timed_out=result["timed_out"],
                include_in_chat=bool(args.get("includeInChat")),
                added_to_working_set=False,
                duration_ms=result["duration_ms"],
            )
        await broadcast_resource_event(request.app, {
            "kind": "commands",
            "action": "captured",
            "conversation_id": conversation_id,
            "run_id": run_id,
            "message": "Approved tool command executed",
        })
        return {"type": "command", "run_id": run_id, "run": run, "result": result}

    if action == "file_read":
        target = _target_path(item)
        if not target.is_file():
            raise HTTPException(status_code=404, detail="tool_request_file_not_found")
        content = target.read_text(encoding=str(args.get("encoding") or "utf-8"))
        limit = int(args.get("maxChars") or 64_000)
        truncated = len(content) > limit
        return {
            "type": "file_read",
            "path": str(target),
            "content": content[:limit],
            "truncated": truncated,
            "bytes": target.stat().st_size,
        }

    if action == "file_write":
        target = _target_path(item)
        content = args.get("content")
        if not isinstance(content, str):
            raise HTTPException(status_code=400, detail="tool_request_content_required")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding=str(args.get("encoding") or "utf-8"))
        await broadcast_resource_event(request.app, {
            "kind": "workspace",
            "action": "file_written",
            "conversation_id": conversation_id,
            "path": str(target),
            "message": "Approved tool file write executed",
        })
        return {"type": "file_write", "path": str(target), "bytes": len(content.encode("utf-8"))}

    if action == "file_delete":
        target = _target_path(item)
        if not target.exists():
            return {"type": "file_delete", "path": str(target), "deleted": False, "reason": "not_found"}
        if target.is_dir():
            raise HTTPException(status_code=400, detail="tool_request_delete_directory_unsupported")
        target.unlink()
        await broadcast_resource_event(request.app, {
            "kind": "workspace",
            "action": "file_deleted",
            "conversation_id": conversation_id,
            "path": str(target),
            "message": "Approved tool file delete executed",
        })
        return {"type": "file_delete", "path": str(target), "deleted": True}

    raise HTTPException(status_code=400, detail="tool_request_action_not_executable")


@router.get("")
def list_tool_requests(request: Request, conversationId: str | None = None, limit: int = 100) -> list[dict]:
    return _store(request).list(conversation_id=conversationId, limit=limit)


@router.post("")
def create_tool_request(body: ToolRequestCreate, request: Request) -> dict:
    permission = evaluate_and_audit(
        request,
        PermissionEvaluationRequest(
            action=body.action,  # type: ignore[arg-type]
            path=body.path,
            command=body.command,
            workspace=body.workspace,
            conversation_id=body.conversationId,
            actor="agent",
            metadata={
                "source": "tool_requests.create",
                "provider": body.provider,
                "tool_name": body.toolName,
                "arguments": body.arguments,
            },
        ),
    )
    if permission.decision == PermissionDecision.DENY:
        status = "denied"
    else:
        status = "pending"
    return _store(request).create(
        conversation_id=body.conversationId,
        provider=body.provider,
        tool_name=body.toolName,
        action=body.action,
        status=status,  # type: ignore[arg-type]
        path=body.path,
        command=body.command,
        workspace=body.workspace,
        arguments=body.arguments,
        permission=permission,
        reason=permission.reason,
    )


@router.post("/{request_id}/approve")
async def approve_tool_request(request_id: str, body: ToolRequestResolve, request: Request) -> dict:
    item = _store(request).get(request_id)
    if item is None:
        raise HTTPException(status_code=404, detail="tool_request_not_found")
    if item["status"] != "pending":
        return item
    # Keep the permission audit event readable by logging a normal evaluation plus explicit override.
    permission = evaluate_and_audit(
        request,
        PermissionEvaluationRequest(
            action=item["action"],  # type: ignore[arg-type]
            path=item.get("path"),
            command=item.get("command"),
            workspace=item.get("workspace"),
            conversation_id=item.get("conversation_id"),
            actor="user",
            metadata={"source": "tool_requests.approve", "tool_request_id": request_id, "override": "allow_once"},
        ),
    )
    audit_store(request).log(
        PermissionEvaluationRequest(
            action=item["action"],  # type: ignore[arg-type]
            path=item.get("path"),
            command=item.get("command"),
            workspace=item.get("workspace"),
            conversation_id=item.get("conversation_id"),
            actor="user",
            metadata={"source": "tool_requests.approve", "tool_request_id": request_id, "override": "allow_once"},
        ),
        permission.model_copy(update={
            "decision": PermissionDecision.ALLOW_ONCE,
            "reason": body.reason or f"tool request approved: {permission.reason}",
            "requires_user_choice": False,
        }),
    )
    try:
        execution = await _execute_tool_request(item, request)
    except Exception as exc:
        _store(request).resolve(request_id, "failed", str(exc), {"error": str(exc)})
        raise
    resolved = _store(request).resolve(
        request_id,
        "approved",
        body.reason or "approved by user",
        execution,
    )
    await broadcast_resource_event(request.app, {
        "kind": "tool_requests",
        "action": "approved",
        "conversation_id": item.get("conversation_id"),
        "tool_request_id": request_id,
        "message": "Tool request approved and executed",
    })
    return resolved or item


@router.post("/{request_id}/deny")
async def deny_tool_request(request_id: str, body: ToolRequestResolve, request: Request) -> dict:
    item = _store(request).get(request_id)
    if item is None:
        raise HTTPException(status_code=404, detail="tool_request_not_found")
    if item["status"] != "pending":
        return item
    resolved = _store(request).resolve(request_id, "denied", body.reason or "denied by user")
    await broadcast_resource_event(request.app, {
        "kind": "tool_requests",
        "action": "denied",
        "conversation_id": item.get("conversation_id"),
        "tool_request_id": request_id,
        "message": "Tool request denied",
    })
    return resolved or item
