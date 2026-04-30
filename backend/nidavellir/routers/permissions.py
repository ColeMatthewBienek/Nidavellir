from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Request

from nidavellir.permissions import PermissionEvaluator
from nidavellir.permissions.audit import PermissionAuditStore
from nidavellir.permissions.policy import PermissionEvaluationRequest

router = APIRouter(prefix="/api/permissions", tags=["permissions"])


def evaluator(request: Request) -> PermissionEvaluator:
    existing = getattr(request.app.state, "permission_evaluator", None)
    if existing is None:
        existing = PermissionEvaluator()
        request.app.state.permission_evaluator = existing
    return existing


def audit_store(request: Request) -> PermissionAuditStore:
    store = getattr(request.app.state, "permission_audit_store", None)
    if store is None:
        path = Path(tempfile.gettempdir()) / f"nidavellir-permissions-{uuid.uuid4().hex}.db"
        store = PermissionAuditStore(str(path))
        request.app.state.permission_audit_store = store
    return store


def evaluate_and_audit(request: Request, body: PermissionEvaluationRequest):
    result = evaluator(request).evaluate(body)
    audit_store(request).log(body, result)
    return result


@router.post("/evaluate")
def evaluate_permission(body: PermissionEvaluationRequest, request: Request) -> dict:
    return evaluate_and_audit(request, body).model_dump(mode="json")


@router.get("/audit")
def list_permission_audit(request: Request, limit: int = 100) -> list[dict]:
    return audit_store(request).list_events(limit=limit)
