from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from nidavellir.permissions.policy import PermissionAction, PermissionDecision, PermissionEvaluationRequest
from nidavellir.permissions.tool_requests import ToolRequestStore
from nidavellir.routers.permissions import audit_store, evaluate_and_audit

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
    elif permission.decision == PermissionDecision.ASK:
        status = "pending"
    else:
        status = "approved"
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
def approve_tool_request(request_id: str, body: ToolRequestResolve, request: Request) -> dict:
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
    resolved = _store(request).resolve(request_id, "approved", body.reason or "approved by user")
    return resolved or item


@router.post("/{request_id}/deny")
def deny_tool_request(request_id: str, body: ToolRequestResolve, request: Request) -> dict:
    item = _store(request).get(request_id)
    if item is None:
        raise HTTPException(status_code=404, detail="tool_request_not_found")
    if item["status"] != "pending":
        return item
    resolved = _store(request).resolve(request_id, "denied", body.reason or "denied by user")
    return resolved or item
