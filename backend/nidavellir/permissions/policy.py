from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


PermissionAction = Literal[
    "file_read",
    "file_write",
    "file_delete",
    "shell_command",
    "network_request",
    "package_import",
    "skill_enable",
    "extension_enable",
    "write_outside_workspace",
]


class PermissionDecision(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"
    ALLOW_ONCE = "allow_once"
    ALLOW_FOR_CONVERSATION = "allow_for_conversation"
    ALLOW_FOR_PROJECT = "allow_for_project"


class PermissionPolicy(BaseModel):
    id: str
    scope: Literal["global", "project", "conversation"]
    action: PermissionAction
    path_pattern: str | None = None
    decision: PermissionDecision
    created_at: str


class PermissionEvaluationRequest(BaseModel):
    action: PermissionAction
    path: str | None = None
    command: str | None = None
    workspace: str | None = None
    conversation_id: str | None = None
    project_id: str | None = None
    actor: Literal["user", "agent", "system"] = "agent"
    metadata: dict = Field(default_factory=dict)


class PermissionEvaluationResult(BaseModel):
    action: PermissionAction
    decision: PermissionDecision
    reason: str
    path: str | None = None
    normalized_path: str | None = None
    protected: bool = False
    outside_workspace: bool = False
    matched_rule: str | None = None
    requires_user_choice: bool = False
