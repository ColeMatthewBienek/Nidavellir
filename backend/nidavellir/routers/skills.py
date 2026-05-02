from __future__ import annotations

import tempfile
from pathlib import Path
import sqlite3

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from nidavellir.skills.activation import activate_skills
from nidavellir.skills.compatibility import compatibility_for_skill
from nidavellir.skills.compilers.generic import GenericSkillCompiler
from nidavellir.skills.importer import import_skill_from_markdown, import_skill_from_path
from nidavellir.skills.models import SkillTaskContext
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest
from nidavellir.routers.permissions import evaluate_and_audit
from nidavellir.workspace import effective_default_working_directory

router = APIRouter(tags=["skills"])


class EnableSkillRequest(BaseModel):
    enabled: bool


class ShowInSlashRequest(BaseModel):
    showInSlash: bool


class UpdateSkillTextRequest(BaseModel):
    name: str
    slug: str | None = None
    instructions: str
    scope: str | None = None
    activationMode: str | None = None
    triggers: list[dict] | None = Field(default=None)


class ImportLocalRequest(BaseModel):
    path: str


class ImportMarkdownRequest(BaseModel):
    markdown: str
    name: str | None = None
    slug: str | None = None
    scope: str | None = None
    activationMode: str | None = None
    triggers: list[dict] | None = Field(default=None)
    enabled: bool | None = None
    showInSlash: bool | None = None


class CompilePreviewRequest(BaseModel):
    provider: str
    model: str | None = None
    user_message: str = ""
    conversation_id: str | None = None


def _store(request: Request):
    store = getattr(request.app.state, "skill_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="skill_store_not_available")
    return store


def skill_summary(skill) -> dict:
    return {
        "id": skill.id,
        "slug": skill.slug,
        "name": skill.name,
        "description": skill.description,
        "scope": skill.scope.value,
        "activationMode": skill.activation_mode.value,
        "triggers": [trigger.model_dump(mode="json") for trigger in skill.triggers],
        "instructions": skill.instructions.model_dump(mode="json"),
        "requiredCapabilities": skill.required_capabilities.model_dump(mode="json"),
        "priority": skill.priority,
        "enabled": skill.enabled,
        "showInSlash": skill.show_in_slash,
        "version": skill.version,
        "status": skill.status.value,
        "source": skill.source.model_dump(mode="json"),
        "createdAt": skill.created_at,
        "updatedAt": skill.updated_at,
    }


def _apply_import_options(skill, body: ImportMarkdownRequest):
    data = skill.model_dump(mode="json")
    if body.slug is not None:
        data["slug"] = body.slug
        data["id"] = body.slug
    if body.scope is not None:
        data["scope"] = body.scope
    if body.activationMode is not None:
        data["activation_mode"] = body.activationMode
    if body.triggers is not None:
        data["triggers"] = body.triggers
    if body.enabled is not None:
        data["enabled"] = body.enabled
    if body.showInSlash is not None:
        data["show_in_slash"] = body.showInSlash
    return skill.__class__.model_validate(data)


@router.get("/api/skills")
def list_skills(request: Request) -> list[dict]:
    return [skill_summary(skill) for skill in _store(request).list_skills()]


@router.get("/api/skills/activations")
def list_activations(request: Request) -> list[dict]:
    return _store(request).list_activations()


@router.get("/api/skills/{skill_id}")
def get_skill(skill_id: str, request: Request) -> dict:
    skill = _store(request).get_skill(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill_not_found")
    return skill_summary(skill)


@router.post("/api/skills/{skill_id}/enabled")
def set_skill_enabled(skill_id: str, body: EnableSkillRequest, request: Request) -> dict:
    store = _store(request)
    skill = store.get_skill(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill_not_found")
    if body.enabled:
        decision = evaluate_and_audit(
            request,
            PermissionEvaluationRequest(
                action="skill_enable",
                actor="user",
                workspace=effective_default_working_directory(),
                metadata={
                    "skill_id": skill.id,
                    "skill_name": skill.name,
                    "required_capabilities": skill.required_capabilities.model_dump(mode="json"),
                },
            ),
        )
        if decision.decision == PermissionDecision.ASK:
            raise HTTPException(status_code=403, detail={
                "code": "permission_required",
                "permission": decision.model_dump(mode="json"),
            })
    try:
        return skill_summary(store.set_enabled(skill_id, body.enabled))
    except KeyError:
        raise HTTPException(status_code=404, detail="skill_not_found") from None


@router.post("/api/skills/{skill_id}/slash")
def set_skill_show_in_slash(skill_id: str, body: ShowInSlashRequest, request: Request) -> dict:
    try:
        return skill_summary(_store(request).set_show_in_slash(skill_id, body.showInSlash))
    except KeyError:
        raise HTTPException(status_code=404, detail="skill_not_found") from None


@router.patch("/api/skills/{skill_id}")
def update_skill_text(skill_id: str, body: UpdateSkillTextRequest, request: Request) -> dict:
    try:
        return skill_summary(
            _store(request).update_skill_details(
                skill_id,
                name=body.name,
                slug=body.slug,
                core_instructions=body.instructions,
                scope=body.scope,
                activation_mode=body.activationMode,
                triggers=body.triggers,
            )
        )
    except sqlite3.IntegrityError as exc:
        if "skills.slug" in str(exc) or "UNIQUE constraint failed" in str(exc):
            raise HTTPException(status_code=409, detail="skill_slug_already_exists") from exc
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError:
        raise HTTPException(status_code=404, detail="skill_not_found") from None


@router.delete("/api/skills/{skill_id}")
def delete_skill(skill_id: str, request: Request) -> dict:
    if not _store(request).delete_skill(skill_id):
        raise HTTPException(status_code=404, detail="skill_not_found")
    return {"ok": True, "deletedSkillId": skill_id}


@router.post("/api/skills/import/local")
def import_local_skill(body: ImportLocalRequest, request: Request) -> dict:
    store = _store(request)
    decision = evaluate_and_audit(
        request,
        PermissionEvaluationRequest(
            action="package_import",
            path=body.path,
            actor="user",
            workspace=effective_default_working_directory(),
            metadata={"source": "skills.import.local"},
        ),
    )
    if decision.decision == PermissionDecision.ASK:
        raise HTTPException(status_code=403, detail={
            "code": "permission_required",
            "permission": decision.model_dump(mode="json"),
        })
    result = import_skill_from_path(body.path)
    skill = None
    if result.skill is not None:
        try:
            skill = store.create_skill(result.skill, change_reason="import")
        except Exception as exc:
            result.errors.append(str(exc))
            result.ok = False
            skill = result.skill
    store.log_import(
        source_path=body.path,
        repository_url=None,
        detected_format=result.detected_format,
        status="ok" if result.ok else "failed",
        error="; ".join(result.errors) if result.errors else None,
        imported_skill_id=skill.id if skill and result.ok else None,
    )
    return {
        "ok": result.ok,
        "importId": result.import_id,
        "detectedFormat": result.detected_format,
        "skill": skill_summary(skill) if skill else None,
        "warnings": result.warnings,
        "errors": result.errors,
    }


@router.post("/api/skills/import/markdown")
def import_markdown_skill(body: ImportMarkdownRequest, request: Request) -> dict:
    store = _store(request)
    result = import_skill_from_markdown(body.markdown, name=body.name)
    skill = None
    if result.skill is not None:
        try:
            result.skill = _apply_import_options(result.skill, body)
            skill = store.create_skill(result.skill, change_reason="paste markdown import")
        except Exception as exc:
            result.errors.append(str(exc))
            result.ok = False
            skill = result.skill
    store.log_import(
        source_path=None,
        repository_url=None,
        detected_format=result.detected_format,
        status="ok" if result.ok else "failed",
        error="; ".join(result.errors) if result.errors else None,
        imported_skill_id=skill.id if skill and result.ok else None,
    )
    return {
        "ok": result.ok,
        "importId": result.import_id,
        "detectedFormat": result.detected_format,
        "skill": skill_summary(skill) if skill else None,
        "warnings": result.warnings,
        "errors": result.errors,
    }


@router.post("/api/skills/validate/markdown")
def validate_markdown_skill(body: ImportMarkdownRequest) -> dict:
    result = import_skill_from_markdown(body.markdown, name=body.name)
    skill = None
    if result.skill is not None:
        try:
            skill = _apply_import_options(result.skill, body)
        except Exception as exc:
            result.errors.append(str(exc))
            result.ok = False
    return {
        "ok": result.ok and not result.errors,
        "importId": result.import_id,
        "detectedFormat": result.detected_format,
        "skill": skill_summary(skill) if skill else None,
        "warnings": result.warnings,
        "errors": result.errors,
    }


@router.post("/api/skills/import/upload")
async def import_upload_skill(request: Request) -> dict:
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "filename") or not hasattr(upload, "read"):
        raise HTTPException(status_code=400, detail="file_required")
    suffix = Path(str(upload.filename)).suffix or ".md"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await upload.read())
        tmp_path = tmp.name
    return import_local_skill(ImportLocalRequest(path=tmp_path), request)


@router.get("/api/skills/{skill_id}/compatibility")
def get_compatibility(skill_id: str, request: Request, provider: str = "codex", model: str | None = None) -> dict:
    skill = _store(request).get_skill(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill_not_found")
    return compatibility_for_skill(skill, provider, model).model_dump(mode="json")


@router.post("/api/skills/compile-preview")
def compile_preview(body: CompilePreviewRequest, request: Request) -> dict:
    store = _store(request)
    context = SkillTaskContext(
        conversation_id=body.conversation_id,
        user_message=body.user_message,
        provider=body.provider,
        model=body.model,
    )
    activation = activate_skills(store.list_skills(), context)
    compile_result = GenericSkillCompiler().compile(
        activation.activated,
        suppressed=[item.model_dump() for item in activation.suppressed],
    )
    for log in activation.logs:
        store.log_activation(
            skill_id=log.skill_id,
            conversation_id=body.conversation_id,
            session_id=None,
            provider=body.provider,
            model=body.model,
            trigger_reason=log.reason,
            score=log.score,
            matched_triggers=log.matched_triggers,
            compatibility_status=log.compatibility_status,
            diagnostics=[],
            token_estimate=log.token_estimate,
            injected=log.injected,
        )
    return compile_result.model_dump(mode="json")
