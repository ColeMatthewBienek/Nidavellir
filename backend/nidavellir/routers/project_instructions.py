from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest
from nidavellir.project_instructions.discovery import (
    INSTRUCTION_FILENAMES,
    default_global_instruction_files,
    discover_project_instructions,
)
from nidavellir.resources.events import broadcast_resource_event
from nidavellir.routers.permissions import audit_store, evaluate_and_audit
from nidavellir.workspace import effective_default_working_directory, normalize_working_directory

router = APIRouter(prefix="/api/project-instructions", tags=["project-instructions"])


class ProjectInstructionWriteRequest(BaseModel):
    workspace: str
    filename: str
    content: str
    provider: str | None = None
    path: str | None = None
    permissionOverride: str | None = None


def _resolve_workspace(path_value: str | None) -> Path:
    normalized = normalize_working_directory(path_value or effective_default_working_directory())
    if not normalized.exists:
        raise HTTPException(status_code=400, detail="directory_not_found")
    if not normalized.is_directory:
        raise HTTPException(status_code=400, detail="not_a_directory")
    return Path(normalized.path)


def _safe_instruction_path(workspace: Path, filename: str) -> Path:
    if filename not in INSTRUCTION_FILENAMES:
        raise HTTPException(status_code=400, detail="unsupported_instruction_file")
    target = (workspace / filename).resolve(strict=False)
    try:
        target.relative_to(workspace.resolve(strict=False))
    except ValueError:
        raise HTTPException(status_code=400, detail="path_outside_workspace") from None
    if target.exists() and target.is_symlink():
        raise HTTPException(status_code=400, detail="symlink_instruction_file_unsupported")
    return target


def _instruction_target_path(workspace: Path, filename: str, path_value: str | None = None) -> Path:
    global_path = default_global_instruction_files().get(filename)
    if path_value is not None:
        target = Path(path_value).expanduser().resolve(strict=False)
        if global_path and target == global_path.expanduser().resolve(strict=False):
            return target
        project_target = _safe_instruction_path(workspace, filename)
        if target == project_target:
            return target
        raise HTTPException(status_code=400, detail="unsupported_instruction_path")
    if filename in {"AGENTS.md", "CLAUDE.md"} and global_path is not None:
        return global_path.expanduser().resolve(strict=False)
    return _safe_instruction_path(workspace, filename)


def _editable_file(workspace: Path, filename: str) -> dict:
    global_path = default_global_instruction_files().get(filename)
    scope = "project"
    if filename in {"AGENTS.md", "CLAUDE.md"} and global_path is not None:
        path = global_path.expanduser().resolve(strict=False)
        scope = "global"
    else:
        path = _safe_instruction_path(workspace, filename)
    exists = path.is_file()
    content = ""
    modified_at = None
    size_bytes = 0
    if exists:
        stat = path.stat()
        modified_at = stat.st_mtime
        size_bytes = stat.st_size
        content = path.read_text(encoding="utf-8")
    return {
        "name": filename,
        "path": str(path),
        "exists": exists,
        "content": content,
        "sizeBytes": size_bytes,
        "modifiedAt": modified_at,
        "scope": scope,
    }


@router.get("")
def get_project_instructions(request: Request, workspace: str | None = None, provider: str | None = None) -> dict:
    workspace_path = _resolve_workspace(workspace)
    result = discover_project_instructions(
        cwd=workspace_path,
        provider=provider,
        global_instruction_files=default_global_instruction_files(),
    )
    return {
        "workspace": str(workspace_path),
        "provider": provider,
        "instructions": [item.model_dump(mode="json") for item in result.instructions],
        "discovered": [item.model_dump(mode="json") for item in result.discovered],
        "suppressed": [item.model_dump(mode="json") for item in result.suppressed],
        "renderedText": result.rendered_text,
        "tokenEstimate": result.token_estimate,
        "editableFiles": [_editable_file(workspace_path, filename) for filename in INSTRUCTION_FILENAMES],
    }


@router.put("")
def write_project_instruction(body: ProjectInstructionWriteRequest, request: Request, background_tasks: BackgroundTasks) -> dict:
    workspace_path = _resolve_workspace(body.workspace)
    target = _instruction_target_path(workspace_path, body.filename, body.path)
    decision = evaluate_and_audit(
        request,
        PermissionEvaluationRequest(
            action="file_write",
            actor="user",
            path=str(target),
            workspace=str(workspace_path),
            metadata={"source": "project_instructions.write", "filename": body.filename},
        ),
    )
    if decision.decision == PermissionDecision.ASK:
        if body.permissionOverride == PermissionDecision.ALLOW_ONCE.value:
            audit_store(request).log(
                PermissionEvaluationRequest(
                    action="file_write",
                    actor="user",
                    path=str(target),
                    workspace=str(workspace_path),
                    metadata={
                        "source": "project_instructions.write",
                        "filename": body.filename,
                        "override": "allow_once",
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
    target.write_text(body.content, encoding="utf-8")
    background_tasks.add_task(broadcast_resource_event, request.app, {
        "kind": "project_instructions",
        "action": "updated",
        "workspace": str(workspace_path),
        "path": str(target),
        "filename": body.filename,
        "provider": body.provider,
        "message": "Project instructions updated",
    })
    return get_project_instructions(request, workspace=str(workspace_path), provider=body.provider)
