from __future__ import annotations

import base64
import binascii
import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from nidavellir.workspace import effective_default_working_directory, normalize_working_directory
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest
from nidavellir.routers.permissions import evaluate_and_audit

router = APIRouter(prefix="/api/conversations", tags=["conversations"])
VALID_BLOB_FILE_SOURCES = {"file_picker", "clipboard", "drag_drop", "clipboard_paste", "mixed"}


class ConversationCreateRequest(BaseModel):
    title: str | None = None
    provider: str | None = None
    model: str | None = None


class ConversationRenameRequest(BaseModel):
    title: str


class ConversationPinRequest(BaseModel):
    pinned: bool


class ConversationWorkspaceRequest(BaseModel):
    path: str


class ConversationFilesRequest(BaseModel):
    paths: list[str]
    provider: str = "anthropic"
    model: str = "claude-sonnet-4-6"


class ConversationBlobFile(BaseModel):
    fileName: str
    contentBase64: str
    mimeType: str | None = None


class ConversationBlobFilesRequest(BaseModel):
    files: list[ConversationBlobFile]
    provider: str = "anthropic"
    model: str = "claude-sonnet-4-6"
    source: str = "drag_drop"


def _store(request: Request):
    try:
        return request.app.state.memory_store
    except AttributeError:
        raise HTTPException(503, "Memory store unavailable")


def _list_item(row: dict) -> dict:
    effective_cwd = row.get("working_directory") or effective_default_working_directory()
    return {
        "id": row["id"],
        "title": row.get("title") or "New Conversation",
        "updatedAt": row.get("updated_at"),
        "createdAt": row.get("created_at"),
        "activeProvider": row.get("active_provider"),
        "activeModel": row.get("active_model"),
        "workingDirectory": effective_cwd,
        "workingDirectoryDisplay": row.get("working_directory_display") or effective_cwd,
        "messageCount": row.get("message_count", 0),
        "pinned": bool(row.get("pinned", 0)),
        "archived": bool(row.get("archived", 0)),
    }


def _message(row: dict) -> dict:
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "status": row.get("status", "completed"),
        "createdAt": row.get("created_at"),
    }


def _file_item(row: dict) -> dict:
    return {
        "id": row["id"],
        "conversationId": row["conversation_id"],
        "fileName": row["file_name"],
        "originalPath": row["original_path"],
        "fileKind": row["file_kind"],
        "mimeType": row.get("mime_type"),
        "sizeBytes": row["size_bytes"],
        "estimatedTokens": row.get("estimated_tokens"),
        "lineCount": row.get("line_count"),
        "imageWidth": row.get("image_width"),
        "imageHeight": row.get("image_height"),
        "imageFormat": row.get("image_format"),
        "source": row.get("source"),
        "active": bool(row.get("active", 0)),
        "addedAt": row.get("added_at"),
    }


def _redacted_command_run(row: dict, *, include_output: bool) -> dict:
    item = dict(row)
    stdout = item.get("stdout") or ""
    stderr = item.get("stderr") or ""
    item["output_redacted"] = not include_output
    item["stdout_bytes"] = len(stdout.encode("utf-8"))
    item["stderr_bytes"] = len(stderr.encode("utf-8"))
    if not include_output:
        item["stdout"] = ""
        item["stderr"] = ""
    return item


def _conversation_audit_bundle(
    conversation_id: str,
    request: Request,
    *,
    include_command_output: bool = False,
    include_memory_snapshots: bool = False,
) -> dict:
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")

    command_store = getattr(request.app.state, "command_store", None)
    permission_audit_store = getattr(request.app.state, "permission_audit_store", None)
    session_id = conv.get("active_session_id") or conversation_id
    warnings: list[str] = []
    if not conv.get("active_session_id"):
        warnings.append("conversation has no active_session_id; conversation id was used as the session id")
    if not command_store:
        warnings.append("command store unavailable; command_runs omitted")
    if not permission_audit_store:
        warnings.append("permission audit store unavailable; permission_audit_events omitted")

    messages = [_message(row) for row in store.get_conversation_messages(conversation_id)]
    files = [_file_item(row) for row in store.list_conversation_files(conversation_id, active_only=False)]
    command_runs = [
        _redacted_command_run(row, include_output=include_command_output)
        for row in (command_store.list_runs(conversation_id=conversation_id, limit=500) if command_store else [])
    ]
    permission_events = (
        permission_audit_store.list_events(limit=500, conversation_id=conversation_id)
        if permission_audit_store else []
    )
    memory_activity = store.export_activity_events(
        hours=0,
        workflow=conv.get("workflow") or "chat",
        session_id=session_id,
        include_snapshots=include_memory_snapshots,
    )

    return {
        "schema_version": "conversation_audit_bundle.v1",
        "exported_at": datetime.now(UTC).isoformat(),
        "manifest": {
            "conversation_id": conversation_id,
            "session_id": session_id,
            "provider": conv.get("active_provider") or conv.get("provider_id"),
            "model": conv.get("active_model") or conv.get("model_id"),
            "working_directory": conv.get("working_directory") or effective_default_working_directory(),
            "counts": {
                "messages": len(messages),
                "working_set_files": len(files),
                "command_runs": len(command_runs),
                "permission_audit_events": len(permission_events),
                "memory_activity": len(memory_activity),
            },
            "redaction": {
                "messages": "included",
                "working_set_file_contents": "omitted",
                "command_output": "included" if include_command_output else "omitted",
                "memory_snapshots": "included" if include_memory_snapshots else "omitted",
            },
            "warnings": warnings,
        },
        "conversation": {
            "id": conv["id"],
            "title": conv.get("title") or "New Conversation",
            "workflow": conv.get("workflow"),
            "status": conv.get("status"),
            "parent_id": conv.get("parent_id"),
            "continuity_mode": conv.get("continuity_mode"),
            "active_session_id": session_id,
            "active_provider": conv.get("active_provider") or conv.get("provider_id"),
            "active_model": conv.get("active_model") or conv.get("model_id"),
            "working_directory": conv.get("working_directory") or effective_default_working_directory(),
            "working_directory_display": conv.get("working_directory_display") or conv.get("working_directory"),
            "created_at": conv.get("created_at"),
            "updated_at": conv.get("updated_at"),
        },
        "messages": messages,
        "working_set_files": files,
        "command_runs": command_runs,
        "permission_audit_events": permission_events,
        "memory_activity": memory_activity,
    }


@router.get("")
def list_conversations(request: Request):
    return [_list_item(row) for row in _store(request).list_conversation_summaries()]


@router.post("")
def create_conversation(body: ConversationCreateRequest, request: Request):
    store = _store(request)
    conversation_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    title = body.title or "New Conversation"
    effective_cwd = effective_default_working_directory()
    store.create_conversation(
        conversation_id,
        workflow="chat",
        model_id=body.model,
        provider_id=body.provider,
        title=title,
        active_session_id=session_id,
        working_directory=effective_cwd,
        working_directory_display=effective_cwd,
    )
    return {
        "conversationId": conversation_id,
        "sessionId": session_id,
        "title": title,
        "workingDirectory": effective_cwd,
        "workingDirectoryDisplay": effective_cwd,
    }


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    effective_cwd = conv.get("working_directory") or effective_default_working_directory()
    return {
        "id": conv["id"],
        "title": conv.get("title") or "New Conversation",
        "activeSessionId": conv.get("active_session_id") or conv["id"],
        "activeProvider": conv.get("active_provider") or conv.get("provider_id"),
        "activeModel": conv.get("active_model") or conv.get("model_id"),
        "workingDirectory": effective_cwd,
        "workingDirectoryDisplay": conv.get("working_directory_display") or effective_cwd,
        "messages": [_message(row) for row in store.get_conversation_messages(conversation_id)],
        "selectedFiles": [],
    }


@router.get("/{conversation_id}/audit-bundle")
def export_conversation_audit_bundle(
    conversation_id: str,
    request: Request,
    include_command_output: bool = False,
    include_memory_snapshots: bool = False,
):
    bundle = _conversation_audit_bundle(
        conversation_id,
        request,
        include_command_output=include_command_output,
        include_memory_snapshots=include_memory_snapshots,
    )
    payload = json.dumps(bundle, indent=2, sort_keys=True)
    filename = f"nidavellir-conversation-{conversation_id}-audit.json"
    return Response(
        payload,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{conversation_id}/workspace")
def set_conversation_workspace(conversation_id: str, body: ConversationWorkspaceRequest, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    if getattr(request.app.state, "agent_running", False):
        raise HTTPException(409, "agent_running")

    current = conv.get("working_directory") or None
    normalized = normalize_working_directory(body.path, base_dir=current)
    if not normalized.exists:
        raise HTTPException(400, "directory_not_found")
    if not normalized.is_directory:
        raise HTTPException(400, "not_a_directory")

    updated = store.update_conversation(
        conversation_id,
        {
            "working_directory": normalized.path,
            "working_directory_display": normalized.display,
        },
    )
    return {
        "conversationId": updated["id"],
        "workingDirectory": updated.get("working_directory"),
        "workingDirectoryDisplay": updated.get("working_directory_display"),
        "writable": normalized.writable,
        "warning": normalized.warning,
    }


@router.get("/{conversation_id}/files")
def list_conversation_files(conversation_id: str, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    return [_file_item(row) for row in store.list_conversation_files(conversation_id)]


@router.post("/{conversation_id}/files/preview")
def preview_conversation_files(conversation_id: str, body: ConversationFilesRequest, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    workspace = conv.get("working_directory") or effective_default_working_directory()
    for path in body.paths:
        decision = evaluate_and_audit(
            request,
            PermissionEvaluationRequest(
                action="file_read",
                path=path,
                actor="user",
                conversation_id=conversation_id,
                workspace=workspace,
                metadata={"source": "conversation_files.preview"},
            ),
        )
        if decision.decision == PermissionDecision.ASK:
            raise HTTPException(status_code=403, detail={
                "code": "permission_required",
                "permission": decision.model_dump(mode="json"),
            })
    preview = store.preview_conversation_files(conversation_id, body.paths, provider=body.provider, model=body.model)
    return {k: v for k, v in preview.items() if k != "_inspected"}


@router.post("/{conversation_id}/files")
def add_conversation_files(conversation_id: str, body: ConversationFilesRequest, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    workspace = conv.get("working_directory") or effective_default_working_directory()
    for path in body.paths:
        decision = evaluate_and_audit(
            request,
            PermissionEvaluationRequest(
                action="file_read",
                path=path,
                actor="user",
                conversation_id=conversation_id,
                workspace=workspace,
                metadata={"source": "conversation_files.add"},
            ),
        )
        if decision.decision == PermissionDecision.ASK:
            raise HTTPException(status_code=403, detail={
                "code": "permission_required",
                "permission": decision.model_dump(mode="json"),
            })
    result = store.add_conversation_files(conversation_id, body.paths, provider=body.provider, model=body.model)
    return {
        "added": [_file_item(row) for row in result["added"]],
        "skipped": result["skipped"],
        "contextBefore": result["contextBefore"],
        "contextAfter": result["contextAfter"],
    }


@router.post("/{conversation_id}/files/blob")
def add_conversation_blob_files(conversation_id: str, body: ConversationBlobFilesRequest, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    if body.source not in VALID_BLOB_FILE_SOURCES:
        raise HTTPException(400, "invalid_source")
    decoded = []
    for file in body.files:
        try:
            data = base64.b64decode(file.contentBase64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(400, "invalid_base64")
        decoded.append({
            "fileName": file.fileName,
            "mimeType": file.mimeType,
            "data": data,
        })
    result = store.add_conversation_file_blobs(
        conversation_id,
        decoded,
        provider=body.provider,
        model=body.model,
        source=body.source,
    )
    return {
        "added": [_file_item(row) for row in result["added"]],
        "skipped": result["skipped"],
        "contextBefore": result["contextBefore"],
        "contextAfter": result["contextAfter"],
    }


@router.delete("/{conversation_id}/files/{file_id}")
def delete_conversation_file(conversation_id: str, file_id: str, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    if not store.delete_conversation_file(conversation_id, file_id):
        raise HTTPException(404, "file_not_found")
    return {
        "ok": True,
        "contextAfter": store._context_usage_from_tokens(
            store.conversation_payload_tokens(conversation_id),
            conv.get("active_provider") or conv.get("provider_id") or "anthropic",
            conv.get("active_model") or conv.get("model_id") or "claude-sonnet-4-6",
        ),
    }


@router.patch("/{conversation_id}")
def rename_conversation(conversation_id: str, body: ConversationRenameRequest, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "title_required")
    if len(title) > 120:
        raise HTTPException(400, "title_too_long")
    updated = store.update_conversation(conversation_id, {"title": title, "title_manually_set": 1})
    return {"id": updated["id"], "title": updated.get("title") or "New Conversation"}


@router.post("/{conversation_id}/pin")
def pin_conversation(conversation_id: str, body: ConversationPinRequest, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv or conv.get("archived"):
        raise HTTPException(404, "conversation_not_found")
    updated = store.update_conversation(conversation_id, {"pinned": 1 if body.pinned else 0})
    return _list_item(updated)


@router.post("/{conversation_id}/archive")
def archive_conversation(conversation_id: str, request: Request):
    store = _store(request)
    conv = store.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "conversation_not_found")
    store.update_conversation(
        conversation_id,
        {"archived": 1, "deleted_at": datetime.now(UTC).isoformat()},
    )
    return {"ok": True}
