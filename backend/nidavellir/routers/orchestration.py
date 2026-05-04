from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from nidavellir.agents.chat_harness import build_prompt_assembly
from nidavellir.agents import registry as _agent_registry
from nidavellir.agents.events import frontend_event
from nidavellir.commands import CommandRunner, CommandRunStore
from nidavellir.commands.events import broadcast_command_event
from nidavellir.orchestration import OrchestrationStore
from nidavellir.orchestration.worktrees import (
    WorktreeError,
    checkpoint_worktree,
    create_git_worktree,
    create_integration_worktree,
    current_branch,
    default_integration_worktree_path,
    default_worktree_path,
    git_status,
    preflight_worktree_merge,
    remove_git_worktree,
    review_worktree,
    repo_root,
    slugify,
)
from nidavellir.permissions.policy import PermissionDecision, PermissionEvaluationRequest
from nidavellir.permissions.tool_protocol import TOOL_PROTOCOL_INSTRUCTIONS, extract_tool_requests
from nidavellir.resources.events import broadcast_resource_event
from nidavellir.routers.permissions import audit_store, evaluate_and_audit
from nidavellir.routers.tool_requests import _continuation_content
from nidavellir.workspace import effective_default_working_directory, normalize_working_directory

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


class StepRunAgentRequest(BaseModel):
    prompt: str | None = None
    provider: str | None = None
    model: str | None = None
    conversationId: str | None = None


class TaskRunReadyRequest(BaseModel):
    conversationId: str | None = None
    includeInChat: bool = False
    timeoutSeconds: int = Field(default=120, ge=1, le=600)
    maxSteps: int = Field(default=10, ge=1, le=50)
    permissionOverride: str | None = None


class WorktreeCreateRequest(BaseModel):
    nodeId: str | None = None
    repoPath: str | None = None
    baseBranch: str | None = None
    branchName: str | None = None
    worktreePath: str | None = None


class WorktreeCheckpointRequest(BaseModel):
    message: str | None = None


class WorktreeIntegrationRequest(BaseModel):
    branchName: str | None = None
    worktreePath: str | None = None
    message: str | None = None


class PlanInboxCreateRequest(BaseModel):
    rawPlan: str = Field(min_length=1)
    repoPath: str | None = None
    baseBranch: str | None = None
    provider: str | None = None
    model: str | None = None
    automationMode: str = "supervised"
    maxConcurrency: int = Field(default=1, ge=1)
    priority: int | None = None
    source: str = "plan_tab"
    requestedBy: str | None = None
    constraints: list[str] = Field(default_factory=list)
    acceptanceCriteria: list[str] = Field(default_factory=list)
    status: str = "new"


class PlanInboxUpdateRequest(BaseModel):
    rawPlan: str | None = None
    repoPath: str | None = None
    baseBranch: str | None = None
    provider: str | None = None
    model: str | None = None
    automationMode: str | None = None
    maxConcurrency: int | None = Field(default=None, ge=1)
    priority: int | None = None
    source: str | None = None
    requestedBy: str | None = None
    constraints: list[str] | None = None
    acceptanceCriteria: list[str] | None = None
    status: str | None = None
    lockedBy: str | None = None
    lockedAt: str | None = None
    finalSpecId: str | None = None


class ClaimRequest(BaseModel):
    lockedBy: str = Field(default="daemon", min_length=1)


class PlannerDiscussionMessageCreateRequest(BaseModel):
    role: str = "user"
    kind: str = "message"
    content: str = Field(min_length=1)
    linkedArtifactId: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlannerPmTurnRequest(BaseModel):
    content: str = Field(min_length=1)
    provider: str | None = None
    model: str | None = None
    agentMode: str = "provider"


class PlanningCheckpointUpdateRequest(BaseModel):
    status: str | None = None
    summary: str | None = None
    sourceMessageIds: list[str] | None = None
    blockingQuestion: str | None = None


class AgenticSpecCreateRequest(BaseModel):
    content: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: str = "draft"


class SpecReadinessReportCreateRequest(BaseModel):
    verdict: str
    report: dict[str, Any] = Field(default_factory=dict)
    specId: str | None = None


class DecompositionRunCreateRequest(BaseModel):
    specId: str | None = None
    decomposerOutput: dict[str, Any] = Field(default_factory=dict)
    status: str = "created"


class TaskInboxCreateRequest(BaseModel):
    title: str = Field(min_length=1)
    objective: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    dependencies: list[str] = Field(default_factory=list)
    planInboxItemId: str | None = None
    decompositionRunId: str | None = None
    candidateTaskId: str | None = None
    status: str = "new"
    priority: int | None = None


class TaskInboxUpdateRequest(BaseModel):
    title: str | None = None
    objective: str | None = None
    payload: dict[str, Any] | None = None
    dependencies: list[str] | None = None
    status: str | None = None
    priority: int | None = None
    lockedBy: str | None = None
    lockedAt: str | None = None
    materializedTaskId: str | None = None
    materializedNodeId: str | None = None


class TaskShapeReportCreateRequest(BaseModel):
    verdict: str
    report: dict[str, Any] = Field(default_factory=dict)


class EmReviewCreateRequest(BaseModel):
    verdict: str
    report: dict[str, Any] = Field(default_factory=dict)


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


def _prompt_from_step(step: dict, prompt_override: str | None) -> str:
    prompt = (prompt_override or step.get("config", {}).get("prompt") or step.get("description") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt_required")
    return prompt


def _stringify_agent_event(item: object) -> str:
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        return ""
    to_frontend = getattr(item, "to_frontend", None)
    if callable(to_frontend):
        event = frontend_event(item)
        content = event.get("content") or event.get("detail") or event.get("summary") or event.get("message")
        return f"[{event.get('type', 'activity')}] {content}\n" if content else ""
    return str(item)


PLANNER_GATE_ORDER = [
    "intake",
    "repo_target",
    "scope",
    "acceptance",
    "verification",
    "risks",
    "spec_draft",
    "spec_approved",
]

PLANNER_PM_ACTION_OPEN = "<nidavellir-pm-actions>"
PLANNER_PM_ACTION_CLOSE = "</nidavellir-pm-actions>"

PLANNER_CONFIRMATION_PATTERN = re.compile(
    r"\b(?:yes|yep|correct|approved?|agree(?:d)?|lock(?:ed)?(?:\s+(?:it|this|them|as\s+written))?|looks\s+good|that\s+works)\b",
    re.IGNORECASE,
)


def _checkpoint_status(plan: dict, key: str) -> str:
    return next((item.get("status", "missing") for item in plan.get("planning_checkpoints", []) if item.get("key") == key), "missing")


def _next_open_planner_gate(plan: dict) -> str:
    return next((key for key in PLANNER_GATE_ORDER if _checkpoint_status(plan, key) != "agreed"), "spec_approved")


def _next_open_planner_gate_after_updates(plan: dict, checkpoint_updates: list[dict]) -> str:
    agreed_updates = {item["key"] for item in checkpoint_updates if item.get("status") == "agreed"}
    return next(
        (key for key in PLANNER_GATE_ORDER if key not in agreed_updates and _checkpoint_status(plan, key) != "agreed"),
        "spec_approved",
    )


def _latest_spec(plan: dict) -> dict | None:
    specs = plan.get("specs") or []
    return specs[0] if specs else None


def _build_agentic_spec_draft(plan: dict, spec_deltas: list[dict]) -> str:
    acceptance = plan.get("acceptance_criteria") or []
    constraints = plan.get("constraints") or []
    checkpoints = plan.get("planning_checkpoints") or []
    satisfied = [item["title"] for item in checkpoints if item.get("status") == "agreed"]
    pending = [f"{item['title']}: {item.get('status')}" for item in checkpoints if item.get("status") != "agreed"]
    deltas_by_section: dict[str, list[str]] = {}
    for delta in spec_deltas:
        deltas_by_section.setdefault(delta["section"], []).append(delta["content"])

    def bullets(values: list[str], fallback: str) -> str:
        return "\n".join(f"- {value}" for value in values) if values else f"- {fallback}"

    return "\n".join([
        "# Agentic Forward Spec",
        "",
        "## Goal",
        str(plan.get("raw_plan") or "").strip(),
        "",
        "## Target Repository",
        f"- Repo path: {plan.get('repo_path') or 'Not captured'}",
        f"- Base branch: {plan.get('base_branch') or 'Not captured'}",
        "",
        "## Scope",
        bullets(deltas_by_section.get("Scope", []), "Needs PM confirmation."),
        "",
        "## Acceptance Criteria",
        bullets(acceptance, "Needs testable acceptance criteria."),
        "",
        "## Verification Strategy",
        bullets(deltas_by_section.get("Verification Strategy", []), "Needs verification strategy."),
        "",
        "## Risks and Dependencies",
        bullets(deltas_by_section.get("Risks and Dependencies", []), "Needs risk and dependency review."),
        "",
        "## Constraints",
        bullets(constraints, "No additional constraints captured."),
        "",
        "## Satisfied Planning Gates",
        bullets(satisfied, "No gates satisfied yet."),
        "",
        "## Pending Planning Gates",
        bullets(pending, "No pending gates."),
    ])


def _planner_pm_memory_context(plan: dict) -> str:
    messages = plan.get("discussion_messages") or []
    discussion = []
    for message in messages[-12:]:
        role = message.get("role", "unknown")
        kind = message.get("kind", "message")
        content = str(message.get("content") or "").strip()
        if content:
            discussion.append(f"- {role}/{kind}: {content}")
    checkpoints = []
    for checkpoint in plan.get("planning_checkpoints") or []:
        summary = checkpoint.get("summary") or checkpoint.get("blocking_question") or ""
        checkpoints.append(f"- {checkpoint.get('key')}: {checkpoint.get('status')} - {summary}".rstrip(" -"))
    return "\n\n".join(part for part in [
        f"Plan inbox item: {plan.get('id')}",
        f"Raw intake:\n{plan.get('raw_plan') or ''}",
        f"Repo path: {plan.get('repo_path') or 'not captured'}",
        f"Base branch: {plan.get('base_branch') or 'not captured'}",
        "Acceptance criteria:\n" + "\n".join(f"- {item}" for item in plan.get("acceptance_criteria") or []),
        "Constraints:\n" + "\n".join(f"- {item}" for item in plan.get("constraints") or []),
        "Planning checkpoints:\n" + "\n".join(checkpoints),
        "Recent PM discussion:\n" + "\n".join(discussion),
    ] if part.strip())


def _planner_pm_current_content(user_content: str) -> str:
    return "\n\n".join([
        "Use the Planner PM skill for this focused planning turn.",
        "The goal is an agentic-forward spec that can safely move to decomposition.",
        "Act as Nidavellir PM: co-create, critique, capture evidence, and block decomposition until required gates are satisfied.",
        "Return the next PM chat message to the user first.",
        "If and only if a planning gate should be locked, append a machine-readable action sidecar after the visible message.",
        f"Wrap the sidecar exactly in {PLANNER_PM_ACTION_OPEN} and {PLANNER_PM_ACTION_CLOSE}.",
        "The sidecar JSON shape is: {\"actions\":[{\"type\":\"lock_gate\",\"gate\":\"repo_target|scope|acceptance|verification|risks\",\"summary\":\"...\",\"evidence\":\"...\",\"repo_path\":\"...\",\"base_branch\":\"...\",\"criteria\":[\"...\"],\"commands\":[\"...\"],\"risks\":[\"...\"]}]}",
        "Do not add lock_gate actions for proposed next gates. Only lock a gate after explicit user confirmation or concrete captured evidence.",
        f"User message:\n{user_content}",
    ])


def _planner_pm_workdir(plan: dict) -> Path:
    repo_path = str(plan.get("repo_path") or "").strip()
    if repo_path:
        target = Path(_resolve_planner_repo_path(repo_path)).expanduser()
        try:
            target.mkdir(parents=True, exist_ok=True)
            return target
        except OSError:
            if target.exists() and target.is_dir():
                return target
            existing_parent = next((parent for parent in target.parents if parent.exists() and parent.is_dir()), None)
            if existing_parent is not None and existing_parent != Path(target.anchor):
                return existing_parent
    default = Path(effective_default_working_directory()).expanduser()
    if default.exists():
        return default
    return Path.cwd()


def _planner_repo_base_dir() -> Path:
    default = Path(effective_default_working_directory()).expanduser().resolve(strict=False)
    return default.parent if default.name.lower() == "nidavellir" else default


def _resolve_planner_repo_path(repo_path: str) -> str:
    normalized = normalize_working_directory(repo_path, base_dir=_planner_repo_base_dir())
    return normalized.path


def _extract_repo_target_evidence(text: str) -> dict[str, str] | None:
    lowered = text.lower()
    if not any(token in lowered for token in ("repo", "repository", "project path", "worktree target", "target path")):
        return None
    backtick_candidates = [candidate.strip() for candidate in re.findall(r"`([^`]+)`", text)]
    backtick_paths = [candidate for candidate in backtick_candidates if re.match(r"^(?:~|/|[A-Za-z]:[\\/])", candidate)]
    if not backtick_paths:
        repo_named = re.search(r"\b(?:repo|repository)\b[^\n.]*`([^`]+)`", text, re.IGNORECASE)
        if repo_named:
            candidate = repo_named.group(1).strip()
            if candidate and candidate not in {"main", "master"} and re.match(r"^[A-Za-z0-9._/-]+$", candidate):
                backtick_paths.append(candidate)
    path_match = None
    if not backtick_paths:
        path_match = re.search(r"(?:at|path(?:\s+is)?|target(?:s| path)?(?:\s+is)?)\s+([~/A-Za-z]:?[\\/][^\s,.;]+)", text, re.IGNORECASE)
    repo_path = backtick_paths[-1] if backtick_paths else (path_match.group(1).strip() if path_match else "")
    branch_match = re.search(r"['`\"]?([A-Za-z0-9._/-]+)['`\"]?\s+as\s+the\s+(?:initial|default|base)\s+branch", text, re.IGNORECASE)
    if branch_match is None:
        branch_match = re.search(r"\b(?:branch|baseline|default branch|initial branch)\b[^A-Za-z0-9_-]*['`\"]?([A-Za-z0-9._/-]+)['`\"]?", text, re.IGNORECASE)
    base_branch = branch_match.group(1).strip() if branch_match else ""
    if base_branch and not re.search(r"[A-Za-z0-9]", base_branch):
        base_branch = ""
    if not repo_path and "new repo" not in lowered and "new project" not in lowered and "repo target" not in lowered:
        return None
    result: dict[str, str] = {}
    if repo_path:
        result["repo_path"] = repo_path
    if base_branch:
        result["base_branch"] = base_branch
    elif "main" in lowered:
        result["base_branch"] = "main"
    return result or None


def _latest_planner_message(plan: dict) -> dict | None:
    for message in reversed(plan.get("discussion_messages") or []):
        if message.get("role") == "planner":
            return message
    return None


def _planner_message_active_gate(message: dict | None) -> str | None:
    if not message:
        return None
    metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
    metadata_gate = str(metadata.get("active_gate") or "").strip()
    if metadata_gate in PLANNER_GATE_ORDER:
        return metadata_gate
    content = str(message.get("content") or "")
    match = re.search(r"\bActive gate:\s*`?([a-z_]+)`?", content, re.IGNORECASE)
    if match and match.group(1) in PLANNER_GATE_ORDER:
        return match.group(1)
    lowered = content.lower()
    if "final repo target" in lowered or "repo target" in lowered:
        return "repo_target"
    if "lock this v1 scope" in lowered or "lock this scope" in lowered:
        return "scope"
    if "lock these acceptance" in lowered or "acceptance criteria" in lowered:
        return "acceptance"
    if "lock this verification" in lowered or "verification plan" in lowered:
        return "verification"
    if "lock these risks" in lowered or "risks and dependencies" in lowered:
        return "risks"
    return None


def _user_confirms_planner_gate(text: str) -> bool:
    return PLANNER_CONFIRMATION_PATTERN.search(text) is not None


def _section_bullets(text: str, heading_pattern: str) -> list[str]:
    match = re.search(heading_pattern, text, re.IGNORECASE)
    if not match:
        return []
    remainder = text[match.end():]
    next_heading = re.search(r"\n\s*(?:Active gate|Focused question|Explicit non-goals|Proposed [A-Za-z ]+|Networked/live checks)\b", remainder, re.IGNORECASE)
    if next_heading:
        remainder = remainder[:next_heading.start()]
    bullets = []
    for line in remainder.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        bullet = re.sub(r"^[-*]\s+", "", stripped).strip()
        if bullet and not bullet.lower().startswith(("focused question", "active gate")):
            bullets.append(bullet)
    return bullets


def _planner_gate_confirmation_action(plan: dict, planner_message: dict, user_content: str) -> dict | None:
    if not _user_confirms_planner_gate(user_content):
        return None
    gate = _planner_message_active_gate(planner_message)
    if gate not in {"repo_target", "scope", "acceptance", "verification", "risks"}:
        return None
    content = str(planner_message.get("content") or "")
    lowered = content.lower()
    if gate == "repo_target":
        repo_evidence = _extract_repo_target_evidence(content) or {}
        repo_path = str(repo_evidence.get("repo_path") or plan.get("repo_path") or "").strip()
        base_branch = str(repo_evidence.get("base_branch") or plan.get("base_branch") or "").strip()
        if not repo_path:
            return None
        resolved_repo_path = _resolve_planner_repo_path(repo_path)
        summary = f"{resolved_repo_path} @ {base_branch}" if base_branch else resolved_repo_path
        return {
            "type": "lock_gate",
            "gate": "repo_target",
            "summary": summary,
            "evidence": "User confirmed the PM-proposed repo target.",
            "repo_path": resolved_repo_path,
            "base_branch": base_branch,
        }
    if gate == "scope":
        has_scope = "scope" in lowered or "v1" in lowered
        has_non_goals = "non-goal" in lowered or "non goal" in lowered or "out of scope" in lowered
        if not has_scope or not has_non_goals:
            return None
        return {
            "type": "lock_gate",
            "gate": "scope",
            "summary": "Scope and non-goals locked from PM-confirmed proposal.",
            "evidence": "User confirmed the PM-proposed scope and non-goals.",
            "in_scope": ["PM-proposed scope confirmed by user"],
            "non_goals": ["PM-proposed non-goals confirmed by user"],
        }
    if gate == "acceptance":
        criteria = _section_bullets(content, r"\bProposed acceptance criteria:\s*")
        if not criteria and "acceptance criteria" in lowered:
            criteria = ["PM-proposed acceptance criteria confirmed by user"]
        if not criteria:
            return None
        return {
            "type": "lock_gate",
            "gate": "acceptance",
            "summary": "Acceptance criteria locked from PM-confirmed proposal.",
            "evidence": "User confirmed the PM-proposed acceptance criteria.",
            "criteria": criteria,
        }
    if gate == "verification":
        commands = _section_bullets(content, r"\bProposed verification plan:\s*")
        if not commands and "verification plan" in lowered:
            commands = ["PM-proposed verification plan confirmed by user"]
        if not commands:
            return None
        return {
            "type": "lock_gate",
            "gate": "verification",
            "summary": "Verification strategy locked from PM-confirmed proposal.",
            "evidence": "User confirmed the PM-proposed verification plan.",
            "commands": commands,
        }
    if gate == "risks":
        risks = _section_bullets(content, r"\bProposed risks(?: and dependencies)?:\s*")
        dependencies = _section_bullets(content, r"\bProposed dependencies:\s*")
        if not risks and not dependencies and ("risk" in lowered or "dependencies" in lowered):
            risks = ["PM-proposed risks and dependencies confirmed by user"]
        if not risks and not dependencies:
            return None
        return {
            "type": "lock_gate",
            "gate": "risks",
            "summary": "Risks and dependencies locked from PM-confirmed proposal.",
            "evidence": "User confirmed the PM-proposed risks and dependencies.",
            "risks": risks,
            "dependencies": dependencies,
        }
    return None


def _planner_pm_confirmation_plan_updates(plan: dict, user_content: str) -> dict[str, str]:
    action = _planner_gate_confirmation_action(plan, _latest_planner_message(plan) or {}, user_content)
    if not action or action.get("gate") != "repo_target":
        return {}
    updates: dict[str, str] = {}
    repo_path = str(action.get("repo_path") or "").strip()
    base_branch = str(action.get("base_branch") or "").strip()
    if repo_path:
        updates["repo_path"] = _resolve_planner_repo_path(repo_path)
    if base_branch:
        updates["base_branch"] = base_branch
    return updates


def _planner_pm_confirmation_evidence(plan: dict, user_content: str, source_message_id: str) -> dict:
    action = _planner_gate_confirmation_action(plan, _latest_planner_message(plan) or {}, user_content)
    checkpoint_updates: list[dict] = []
    spec_deltas: list[dict] = []
    if action is not None:
        checkpoint, delta = _validate_planner_lock_action(plan, action, source_message_id)
        if checkpoint is not None:
            checkpoint_updates.append(checkpoint)
            if delta is not None:
                spec_deltas.append(delta)
    return {
        "kind": "message",
        "content": "",
        "active_gate": _next_open_planner_gate_after_updates(plan, checkpoint_updates),
        "draft_spec": False,
        "checkpoint_updates": checkpoint_updates,
        "decisions": [],
        "assumptions": [],
        "blockers": [],
        "spec_deltas": spec_deltas,
    }


def _replay_planner_gate_confirmations(plan: dict) -> dict[str, dict]:
    confirmed: dict[str, dict] = {}
    latest_planner: dict | None = None
    working_plan = dict(plan)
    for message in plan.get("discussion_messages") or []:
        role = message.get("role")
        if role == "planner":
            metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
            for update in metadata.get("checkpoint_updates") or []:
                if not isinstance(update, dict) or update.get("status") != "agreed":
                    continue
                gate = str(update.get("key") or "")
                if gate in {"repo_target", "scope", "acceptance", "verification", "risks"}:
                    checkpoint = next((item for item in plan.get("planning_checkpoints", []) if item.get("key") == gate), {})
                    confirmed[gate] = {
                        "key": gate,
                        "status": "agreed",
                        "summary": str(checkpoint.get("summary") or f"{gate} locked by PM sidecar."),
                        "source_message_ids": checkpoint.get("source_message_ids") or [str(message.get("id") or "")],
                    }
            latest_planner = message
            continue
        if role != "user" or latest_planner is None:
            continue
        action = _planner_gate_confirmation_action(working_plan, latest_planner, str(message.get("content") or ""))
        if action is None:
            continue
        gate = str(action.get("gate") or "")
        if gate not in {"repo_target", "scope", "acceptance", "verification", "risks"}:
            continue
        source_message_id = str(message.get("id") or "")
        confirmed[gate] = {
            "key": gate,
            "status": "agreed",
            "summary": str(action.get("summary") or ""),
            "source_message_ids": [source_message_id] if source_message_id else [],
        }
        if gate == "repo_target":
            repo_path = str(action.get("repo_path") or "").strip()
            base_branch = str(action.get("base_branch") or "").strip()
            if repo_path:
                working_plan["repo_path"] = repo_path
            if base_branch:
                working_plan["base_branch"] = base_branch
    return confirmed


def _repair_planner_gate_frontier(store: Any, item_id: str, plan: dict) -> dict:
    latest_active_gate = _planner_message_active_gate(_latest_planner_message(plan))
    if latest_active_gate not in {"repo_target", "scope", "acceptance", "verification", "risks", "spec_draft", "spec_approved"}:
        return plan
    confirmed = _replay_planner_gate_confirmations(plan)
    repo_confirmation = confirmed.get("repo_target")
    if repo_confirmation:
        latest_planner = None
        for message in plan.get("discussion_messages") or []:
            if message.get("role") == "planner":
                latest_planner = message
            elif message.get("role") == "user" and latest_planner is not None:
                action = _planner_gate_confirmation_action(plan, latest_planner, str(message.get("content") or ""))
                if action and action.get("gate") == "repo_target":
                    updates = {
                        "repo_path": _resolve_planner_repo_path(str(action.get("repo_path") or "").strip()),
                        "base_branch": str(action.get("base_branch") or "").strip(),
                    }
                    plan = store.update_plan_inbox_item(item_id, {key: value for key, value in updates.items() if value}) or plan

    active_index = PLANNER_GATE_ORDER.index(latest_active_gate)
    changed = False
    for gate in ("repo_target", "scope", "acceptance", "verification", "risks"):
        gate_index = PLANNER_GATE_ORDER.index(gate)
        confirmed_update = confirmed.get(gate)
        if confirmed_update:
            checkpoint = next((item for item in plan.get("planning_checkpoints", []) if item.get("key") == gate), {})
            if checkpoint.get("status") != "agreed" or checkpoint.get("summary") != confirmed_update["summary"]:
                store.update_planning_checkpoint(
                    plan_inbox_item_id=item_id,
                    key=gate,
                    status="agreed",
                    summary=confirmed_update["summary"],
                    source_message_ids=confirmed_update["source_message_ids"],
                )
                changed = True
            continue
        if gate_index < active_index:
            continue
        if gate == "repo_target" and str(plan.get("repo_path") or "").strip():
            continue
        if gate == "acceptance" and plan.get("acceptance_criteria"):
            continue
        checkpoint_status = _checkpoint_status(plan, gate)
        if checkpoint_status == "agreed":
            store.update_planning_checkpoint(
                plan_inbox_item_id=item_id,
                key=gate,
                status="missing",
                summary="Waiting for PM/user confirmation.",
                source_message_ids=[],
            )
            changed = True
    return store.get_plan_inbox_item(item_id) if changed else plan


def _merge_planner_structured_evidence(base: dict, extra: dict) -> dict:
    seen_updates = {item.get("key") for item in base["checkpoint_updates"]}
    for update in extra["checkpoint_updates"]:
        if update.get("key") not in seen_updates:
            base["checkpoint_updates"].append(update)
            seen_updates.add(update.get("key"))
    for key in ("decisions", "assumptions"):
        existing = set(base[key])
        for item in extra[key]:
            if item not in existing:
                base[key].append(item)
                existing.add(item)
    seen_deltas = {(item.get("section"), item.get("content")) for item in base["spec_deltas"]}
    for delta in extra["spec_deltas"]:
        marker = (delta.get("section"), delta.get("content"))
        if marker not in seen_deltas:
            base["spec_deltas"].append(delta)
            seen_deltas.add(marker)
    return base


def _split_planner_pm_sidecar(content: str) -> tuple[str, dict | None]:
    start = content.find(PLANNER_PM_ACTION_OPEN)
    if start < 0:
        return content.strip(), None
    end = content.find(PLANNER_PM_ACTION_CLOSE, start + len(PLANNER_PM_ACTION_OPEN))
    visible = content[:start].strip()
    if end < 0:
        return visible, None
    raw_json = content[start + len(PLANNER_PM_ACTION_OPEN):end].strip()
    try:
        parsed = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        return visible, None
    return visible, parsed if isinstance(parsed, dict) else None


def _planner_sidecar_plan_updates(sidecar: dict | None) -> dict[str, str]:
    updates: dict[str, str] = {}
    actions = sidecar.get("actions") if isinstance(sidecar, dict) else None
    if not isinstance(actions, list):
        return updates
    for action in actions:
        if not isinstance(action, dict):
            continue
        if action.get("type") != "lock_gate" or action.get("gate") != "repo_target":
            continue
        repo_path = str(action.get("repo_path") or "").strip()
        base_branch = str(action.get("base_branch") or "").strip()
        if repo_path:
            updates["repo_path"] = _resolve_planner_repo_path(repo_path)
        if base_branch:
            updates["base_branch"] = base_branch
    return updates


def _validate_planner_lock_action(plan: dict, action: dict, source_message_id: str) -> tuple[dict | None, dict | None]:
    gate = str(action.get("gate") or "").strip()
    if action.get("type") != "lock_gate" or gate not in PLANNER_GATE_ORDER:
        return None, None
    if gate in {"intake", "spec_draft", "spec_approved"}:
        return None, None
    if _checkpoint_status(plan, gate) == "agreed":
        return None, None

    summary = str(action.get("summary") or "").strip()
    evidence = str(action.get("evidence") or "").strip()
    if not summary or not evidence:
        return None, None

    if gate == "repo_target":
        repo_path = str(action.get("repo_path") or plan.get("repo_path") or "").strip()
        base_branch = str(action.get("base_branch") or plan.get("base_branch") or "").strip()
        if not repo_path:
            return None, None
        if base_branch and base_branch not in summary:
            summary = f"{summary} ({repo_path} @ {base_branch})"
        elif repo_path not in summary:
            summary = f"{summary} ({repo_path})"
    elif gate == "scope":
        in_scope = action.get("in_scope")
        non_goals = action.get("non_goals")
        if not isinstance(in_scope, list) or not in_scope or not isinstance(non_goals, list):
            return None, None
    elif gate == "acceptance":
        criteria = action.get("criteria")
        if not isinstance(criteria, list) or not any(str(item).strip() for item in criteria):
            return None, None
    elif gate == "verification":
        commands = action.get("commands")
        checks = action.get("checks")
        has_commands = isinstance(commands, list) and any(str(item).strip() for item in commands)
        has_checks = isinstance(checks, list) and any(str(item).strip() for item in checks)
        if not has_commands and not has_checks:
            return None, None
    elif gate == "risks":
        risks = action.get("risks")
        dependencies = action.get("dependencies")
        has_risks = isinstance(risks, list) and any(str(item).strip() for item in risks)
        has_dependencies = isinstance(dependencies, list) and any(str(item).strip() for item in dependencies)
        if not has_risks and not has_dependencies:
            return None, None

    checkpoint = {
        "key": gate,
        "status": "agreed",
        "summary": summary,
        "source_message_ids": [source_message_id],
    }
    section_by_gate = {
        "scope": "Scope",
        "acceptance": "Acceptance Criteria",
        "verification": "Verification Strategy",
        "risks": "Risks and Dependencies",
    }
    delta = None
    if gate in section_by_gate:
        delta = {
            "section": section_by_gate[gate],
            "source_message_id": source_message_id,
            "content": evidence,
        }
    return checkpoint, delta


def _planner_pm_sidecar_evidence(plan: dict, sidecar: dict | None, source_message_id: str) -> dict:
    checkpoint_updates: list[dict] = []
    spec_deltas: list[dict] = []
    actions = sidecar.get("actions") if isinstance(sidecar, dict) else None
    if isinstance(actions, list):
        for action in actions:
            if not isinstance(action, dict):
                continue
            checkpoint, delta = _validate_planner_lock_action(plan, action, source_message_id)
            if checkpoint is None:
                continue
            if any(item["key"] == checkpoint["key"] for item in checkpoint_updates):
                continue
            checkpoint_updates.append(checkpoint)
            if delta is not None:
                spec_deltas.append(delta)
    return {
        "kind": "message",
        "content": "",
        "active_gate": _next_open_planner_gate_after_updates(plan, checkpoint_updates),
        "draft_spec": False,
        "checkpoint_updates": checkpoint_updates,
        "decisions": [],
        "assumptions": [],
        "blockers": [],
        "spec_deltas": spec_deltas,
    }


def _planner_pm_locked_gate_evidence(plan: dict, content: str, source_message_id: str) -> dict:
    checkpoint_updates: list[dict] = []
    spec_deltas: list[dict] = []
    return {
        "kind": "message",
        "content": content,
        "active_gate": _next_open_planner_gate_after_updates(plan, checkpoint_updates),
        "draft_spec": False,
        "checkpoint_updates": checkpoint_updates,
        "decisions": [],
        "assumptions": [],
        "blockers": [],
        "spec_deltas": spec_deltas,
    }


def _planner_pm_harness_metadata(plan: dict, body: PlannerPmTurnRequest, request: Request, item_id: str) -> dict:
    provider = body.provider or plan.get("provider") or "claude"
    model = body.model or plan.get("model") or "claude-sonnet-4-6"
    conversation_id = f"planner-pm:{item_id}"
    assembly = build_prompt_assembly(
        store=getattr(request.app.state, "memory_store", None),
        skill_store=getattr(request.app.state, "skill_store", None),
        conversation_id=conversation_id,
        session_id=conversation_id,
        provider_id=provider,
        model_id=model,
        current_content=_planner_pm_current_content(body.content),
        memory_context=_planner_pm_memory_context(plan),
        workdir=_planner_pm_workdir(plan),
        command_store=getattr(request.app.state, "command_store", None),
    )
    return {
        "harness": "main_chat_prompt_assembly",
        "provider": provider,
        "model": model,
        "conversation_id": conversation_id,
        "prompt_section_names": [section.name for section in assembly.sections],
        "injected_skill_ids": assembly.injected_skill_ids,
        "suppressed_skill_ids": assembly.suppressed_skill_ids,
        "estimated_tokens": assembly.estimated_tokens,
        "_rendered_prompt": assembly.rendered_text,
    }


async def _run_planner_pm_agent(
    plan: dict,
    harness_metadata: dict,
    request: Request,
    on_chunk: Callable[[str], Awaitable[None]] | None = None,
    on_activity: Callable[[dict], Awaitable[None]] | None = None,
) -> dict:
    provider = harness_metadata["provider"]
    manifest = _agent_registry.PROVIDER_REGISTRY.get(provider)
    if manifest is None:
        return {"status": "failed", "content": "", "error": "provider_not_found"}
    agent = None
    raw_parts: list[str] = []
    visible_parts: list[str] = []
    pending_visible = ""
    sidecar_started = False

    async def emit_visible(chunk: str) -> None:
        if not chunk:
            return
        visible_parts.append(chunk)
        if on_chunk is not None:
            await on_chunk(chunk)

    async def handle_text_chunk(chunk: str) -> None:
        nonlocal pending_visible, sidecar_started
        raw_parts.append(chunk)
        if sidecar_started:
            return
        pending_visible += chunk
        marker_index = pending_visible.find(PLANNER_PM_ACTION_OPEN)
        if marker_index >= 0:
            await emit_visible(pending_visible[:marker_index])
            pending_visible = ""
            sidecar_started = True
            return
        keep = max(0, len(PLANNER_PM_ACTION_OPEN) - 1)
        if len(pending_visible) > keep:
            await emit_visible(pending_visible[:-keep])
            pending_visible = pending_visible[-keep:]

    try:
        safety_store = getattr(request.app.state, "provider_safety_store", None)
        dangerousness = safety_store.get_policy(provider).effective_dangerousness if safety_store else "restricted"
        agent = _agent_registry.make_agent(
            provider,
            slot_id=0,
            workdir=_planner_pm_workdir(plan),
            model_id=harness_metadata["model"],
            dangerousness=dangerousness,
        )
        await agent.start()
        await agent.send(harness_metadata["_rendered_prompt"])
        async for item in agent.stream():
            if isinstance(item, dict) or hasattr(item, "to_frontend"):
                if on_activity is not None:
                    await on_activity(frontend_event(item))
                continue
            text = _stringify_agent_event(item)
            if text:
                await handle_text_chunk(text)
        if not sidecar_started:
            await emit_visible(pending_visible)
        raw_content = "".join(raw_parts).strip()
        visible_content, sidecar = _split_planner_pm_sidecar(raw_content)
        return {"status": "completed", "content": visible_content, "raw_content": raw_content, "sidecar": sidecar, "error": None}
    except Exception as exc:
        raw_content = "".join(raw_parts).strip()
        visible_content, sidecar = _split_planner_pm_sidecar(raw_content)
        return {"status": "failed", "content": visible_content, "raw_content": raw_content, "sidecar": sidecar, "error": str(exc)}
    finally:
        if agent is not None:
            try:
                await agent.kill()
            except Exception:
                pass


def _planner_pm_structured_turn(plan: dict, user_content: str, user_message_id: str) -> dict:
    text = user_content.lower()
    checkpoint_updates: list[dict] = []
    decisions: list[str] = []
    assumptions: list[str] = []
    blockers: list[dict] = []
    spec_deltas: list[dict] = []
    repo_evidence = _extract_repo_target_evidence(user_content)
    explicit_repo_lock = re.search(r"\brepo(?:sitory)? target\b[^\n.]*\blocked\b", text) is not None

    if explicit_repo_lock and (repo_evidence or plan.get("repo_path")) and _checkpoint_status(plan, "repo_target") != "agreed":
        repo_summary = repo_evidence.get("repo_path") if repo_evidence else plan.get("repo_path")
        base_branch = (repo_evidence or {}).get("base_branch") or plan.get("base_branch")
        if base_branch:
            repo_summary = f"{repo_summary} @ {base_branch}" if repo_summary else f"Base branch: {base_branch}"
        checkpoint_updates.append({
            "key": "repo_target",
            "status": "agreed",
            "summary": repo_summary or "Repo target evidence captured in PM discussion.",
            "source_message_ids": [user_message_id],
        })
    if re.search(r"\bscope\s*:", user_content, re.IGNORECASE):
        checkpoint_updates.append({
            "key": "scope",
            "status": "agreed",
            "summary": "Scope/non-goals evidence captured in PM discussion.",
            "source_message_ids": [user_message_id],
        })
        spec_deltas.append({"section": "Scope", "source_message_id": user_message_id, "content": user_content})
    if re.search(r"\bverification\s*:", user_content, re.IGNORECASE):
        checkpoint_updates.append({
            "key": "verification",
            "status": "agreed",
            "summary": "Verification strategy evidence captured in PM discussion.",
            "source_message_ids": [user_message_id],
        })
        spec_deltas.append({"section": "Verification Strategy", "source_message_id": user_message_id, "content": user_content})
    if re.search(r"\brisks?\s*:", user_content, re.IGNORECASE):
        checkpoint_updates.append({
            "key": "risks",
            "status": "agreed",
            "summary": "Risks/dependencies evidence captured in PM discussion.",
            "source_message_ids": [user_message_id],
        })
        spec_deltas.append({"section": "Risks and Dependencies", "source_message_id": user_message_id, "content": user_content})
    if "decomposer" in text and "approved spec" in text:
        decisions.append("Decomposer consumes the approved agentic-forward spec artifact, not raw intake.")

    if not plan.get("repo_path") and not any(update["key"] == "repo_target" for update in checkpoint_updates):
        blockers.append({
            "gate": "repo_target",
            "question": "Which existing repo path or new-project setup path should autonomous work target?",
            "why_it_matters": "Worktree execution needs a reproducible Git baseline.",
        })
    if _checkpoint_status(plan, "scope") != "agreed" and not any(update["key"] == "scope" for update in checkpoint_updates):
        blockers.append({
            "gate": "scope",
            "question": "What is the first autonomous execution slice, and what is explicitly out of scope?",
            "why_it_matters": "The decomposer needs a bounded target before creating worktree tasks.",
        })
    if not plan.get("acceptance_criteria"):
        blockers.append({
            "gate": "acceptance",
            "question": "What testable acceptance criteria should prove this is done?",
            "why_it_matters": "The decomposer and EM need objective pass/fail signals.",
        })
    if _checkpoint_status(plan, "verification") != "agreed" and not any(update["key"] == "verification" for update in checkpoint_updates):
        blockers.append({
            "gate": "verification",
            "question": "What verification should Nidavellir run or inspect before handoff?",
            "why_it_matters": "The PM must validate independently instead of trusting agent self-report.",
        })
    if _checkpoint_status(plan, "risks") != "agreed" and not any(update["key"] == "risks" for update in checkpoint_updates):
        blockers.append({
            "gate": "risks",
            "question": "What dependencies, risk areas, or autonomy guardrails should the EM know before decomposition?",
            "why_it_matters": "Autonomous execution needs known ordering constraints and safety boundaries.",
        })

    if any(token in text for token in ("approved", "agreed", "ship it", "that's it", "thats it")):
        if blockers:
            active_gate = blockers[0]["gate"]
            content = (
                "I cannot approve this for decomposition yet. "
                f"The next gate is {active_gate}: {blockers[0]['question']}"
            )
            kind = "question"
        else:
            active_gate = "spec_draft" if _checkpoint_status(plan, "spec_draft") != "agreed" else "spec_approved"
            content = (
                "Accepted. I have enough evidence to draft the agentic-forward spec next. "
                "I will preserve the PM discussion decisions and keep decomposition pointed at the approved spec artifact."
            )
            kind = "approval"
            checkpoint_updates.append({
                "key": "spec_approved",
                "status": "proposed",
                "summary": "User approval signal captured; final approval waits for spec artifact evidence.",
                "source_message_ids": [user_message_id],
            })
        return {
            "kind": kind,
            "content": content,
            "active_gate": active_gate,
            "draft_spec": kind == "approval" and active_gate == "spec_draft" and _latest_spec(plan) is None,
            "checkpoint_updates": checkpoint_updates,
            "decisions": decisions,
            "assumptions": assumptions,
            "blockers": blockers,
            "spec_deltas": spec_deltas,
        }

    if blockers:
        active_gate = blockers[0]["gate"]
        return {
            "kind": "question",
            "content": (
                "As Nidavellir PM, I would not send this to decomposition yet. "
                f"The next gate is {active_gate}: {blockers[0]['question']}"
            ),
            "active_gate": active_gate,
            "draft_spec": False,
            "checkpoint_updates": checkpoint_updates,
            "decisions": decisions,
            "assumptions": assumptions,
            "blockers": blockers,
            "spec_deltas": spec_deltas,
        }

    active_gate = _next_open_planner_gate_after_updates(plan, checkpoint_updates)
    next_questions = {
        "scope": "What is the first autonomous execution slice, and what is explicitly out of scope?",
        "risks": "What dependencies, risk areas, or autonomy guardrails should the EM know before decomposition?",
        "spec_draft": "Should I draft the agentic-forward spec from the evidence captured so far?",
        "spec_approved": "After reviewing the spec, do you approve it for decomposition?",
    }
    wants_draft = "draft" in text or "spec" in text
    draft_spec = active_gate == "spec_draft" and wants_draft and _latest_spec(plan) is None
    content = (
        "As Nidavellir PM, I drafted the agentic-forward spec from the evidence captured so far. "
        "Review it before approving decomposition."
        if draft_spec
        else (
            "As Nidavellir PM, the planning evidence is improving. "
            f"The next gate is {active_gate}: {next_questions.get(active_gate, 'What evidence should we capture for this gate?')}"
        )
    )
    return {
        "kind": "message" if draft_spec else "question",
        "content": content,
        "active_gate": active_gate,
        "draft_spec": draft_spec,
        "checkpoint_updates": checkpoint_updates,
        "decisions": decisions,
        "assumptions": assumptions,
        "blockers": blockers,
        "spec_deltas": spec_deltas,
    }


def _step_by_id(task: dict, step_id: str) -> dict | None:
    return next((step for step in task.get("steps", []) if step.get("id") == step_id), None)


def _tool_request_store(request: Request):
    store = getattr(request.app.state, "tool_request_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="tool_request_store_not_available")
    return store


def _path_inside_workspace(path: str, workspace: Path) -> tuple[str | None, str | None]:
    raw = Path(path).expanduser()
    target = raw if raw.is_absolute() else workspace / raw
    resolved = target.resolve(strict=False)
    try:
        resolved.relative_to(workspace)
    except ValueError:
        return None, f"path outside worktree: {resolved}"
    return str(resolved), None


def _prepare_orchestration_tool_requests(
    *,
    requests: list[dict[str, Any]],
    cwd: Path,
    task: dict,
    node: dict,
    step_id: str,
    attempt_id: str,
    worktree: dict,
) -> tuple[list[dict[str, Any]], list[str]]:
    supported = {"shell_command", "file_read", "file_write", "file_delete"}
    prepared: list[dict[str, Any]] = []
    invalid: list[str] = []
    for index, item in enumerate(requests, start=1):
        action = str(item.get("action") or "").strip()
        if action not in supported:
            invalid.append(f"request {index}: unsupported action {action or '<missing>'}")
            continue

        args = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
        path = item.get("path") or args.get("path")
        normalized_path: str | None = None
        if action in {"file_read", "file_write", "file_delete"}:
            if not path:
                invalid.append(f"request {index}: path required for {action}")
                continue
            normalized_path, error = _path_inside_workspace(str(path), cwd)
            if error:
                invalid.append(f"request {index}: {error}")
                continue

        command = item.get("command") or args.get("command")
        if action == "shell_command" and not command:
            invalid.append(f"request {index}: command required for shell_command")
            continue

        arguments = {
            **args,
            "orchestration": {
                "task_id": task["id"],
                "node_id": node["id"],
                "step_id": step_id,
                "run_attempt_id": attempt_id,
                "worktree_id": worktree["id"],
                "worktree_path": str(cwd),
            },
        }
        if normalized_path:
            arguments["path"] = normalized_path
        if command:
            arguments["command"] = str(command)

        prepared.append({
            "provider": str(item.get("provider") or item.get("providerId") or ""),
            "tool_name": str(item.get("toolName") or item.get("tool_name") or action),
            "action": action,
            "path": normalized_path,
            "command": str(command) if command else None,
            "workspace": str(cwd),
            "arguments": arguments,
        })
    return prepared, invalid


@router.get("/plan-inbox")
def list_plan_inbox_items(request: Request, status: str | None = None) -> list[dict]:
    try:
        return _store(request).list_plan_inbox_items(status=status)
    except Exception as err:
        _handle_store_error(err)
        raise


@router.post("/plan-inbox")
def create_plan_inbox_item(body: PlanInboxCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_plan_inbox_item(
            raw_plan=body.rawPlan,
            repo_path=body.repoPath,
            base_branch=body.baseBranch,
            provider=body.provider,
            model=body.model,
            automation_mode=body.automationMode,
            max_concurrency=body.maxConcurrency,
            priority=body.priority,
            source=body.source,
            requested_by=body.requestedBy,
            constraints=body.constraints,
            acceptance_criteria=body.acceptanceCriteria,
            status=body.status,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.get("/plan-inbox/{item_id}")
def get_plan_inbox_item(item_id: str, request: Request) -> dict:
    store = _store(request)
    item = store.get_plan_inbox_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="plan_inbox_item_not_found")
    item = _repair_planner_gate_frontier(store, item_id, item)
    return item


@router.patch("/plan-inbox/{item_id}")
def update_plan_inbox_item(item_id: str, body: PlanInboxUpdateRequest, request: Request) -> dict:
    updates = {
        "raw_plan": body.rawPlan,
        "repo_path": body.repoPath,
        "base_branch": body.baseBranch,
        "provider": body.provider,
        "model": body.model,
        "automation_mode": body.automationMode,
        "max_concurrency": body.maxConcurrency,
        "priority": body.priority,
        "source": body.source,
        "requested_by": body.requestedBy,
        "constraints": body.constraints,
        "acceptance_criteria": body.acceptanceCriteria,
        "status": body.status,
        "locked_by": body.lockedBy,
        "locked_at": body.lockedAt,
        "final_spec_id": body.finalSpecId,
    }
    try:
        item = _store(request).update_plan_inbox_item(item_id, {key: value for key, value in updates.items() if value is not None})
    except Exception as err:
        _handle_store_error(err)
        raise
    if item is None:
        raise HTTPException(status_code=404, detail="plan_inbox_item_not_found")
    return item


@router.post("/plan-inbox/{item_id}/claim")
def claim_plan_inbox_item(item_id: str, body: ClaimRequest, request: Request) -> dict:
    try:
        item = _store(request).claim_plan_inbox_item(item_id, locked_by=body.lockedBy)
    except Exception as err:
        _handle_store_error(err)
        raise
    if item is None:
        raise HTTPException(status_code=404, detail="plan_inbox_item_not_found")
    return item


@router.get("/plan-inbox/{item_id}/discussion")
def list_planner_discussion_messages(item_id: str, request: Request) -> list[dict]:
    try:
        return _store(request).list_planner_discussion_messages(item_id)
    except Exception as err:
        _handle_store_error(err)
        raise


@router.post("/plan-inbox/{item_id}/discussion")
def create_planner_discussion_message(item_id: str, body: PlannerDiscussionMessageCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_planner_discussion_message(
            plan_inbox_item_id=item_id,
            role=body.role,
            kind=body.kind,
            content=body.content,
            linked_artifact_id=body.linkedArtifactId,
            metadata=body.metadata,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


async def _execute_planner_pm_turn(
    item_id: str,
    body: PlannerPmTurnRequest,
    request: Request,
    on_chunk: Callable[[str], Awaitable[None]] | None = None,
    on_activity: Callable[[dict], Awaitable[None]] | None = None,
) -> dict:
    store = _store(request)
    plan = store.get_plan_inbox_item(item_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="plan_inbox_item_not_found")
    try:
        harness_metadata = _planner_pm_harness_metadata(plan, body, request, item_id)
        user_message = store.create_planner_discussion_message(
            plan_inbox_item_id=item_id,
            role="user",
            kind="message",
            content=body.content,
            metadata={
                "source": "pm_turn",
                "provider": harness_metadata["provider"],
                "model": harness_metadata["model"],
            },
        )
        confirmation_plan_updates = _planner_pm_confirmation_plan_updates(plan, body.content)
        if confirmation_plan_updates:
            plan = store.update_plan_inbox_item(item_id, confirmation_plan_updates) or plan
        repo_evidence = _extract_repo_target_evidence(body.content)
        if repo_evidence:
            repo_path = repo_evidence.get("repo_path")
            plan_updates = {
                "repo_path": _resolve_planner_repo_path(repo_path) if repo_path else None,
                "base_branch": repo_evidence.get("base_branch"),
            }
            plan = store.update_plan_inbox_item(
                item_id,
                {key: value for key, value in plan_updates.items() if value},
            ) or plan
        structured = _planner_pm_structured_turn(plan, body.content, user_message["id"])
        structured = _merge_planner_structured_evidence(
            structured,
            _planner_pm_confirmation_evidence(plan, body.content, user_message["id"]),
        )
        agent_result = {"status": "skipped", "content": "", "error": None}
        if body.agentMode == "provider":
            agent_result = await _run_planner_pm_agent(
                plan,
                harness_metadata,
                request,
                on_chunk=on_chunk,
                on_activity=on_activity,
            )
        agent_content = str(agent_result.get("content") or "")
        sidecar = agent_result.get("sidecar") if isinstance(agent_result.get("sidecar"), dict) else None
        sidecar_plan_updates = _planner_sidecar_plan_updates(sidecar)
        if sidecar_plan_updates:
            plan = store.update_plan_inbox_item(
                item_id,
                sidecar_plan_updates,
            ) or plan
        if sidecar:
            structured = _merge_planner_structured_evidence(
                structured,
                _planner_pm_sidecar_evidence(plan, sidecar, user_message["id"]),
            )
        elif agent_content:
            agent_repo_evidence = _extract_repo_target_evidence(agent_content)
            if agent_repo_evidence:
                repo_path = agent_repo_evidence.get("repo_path")
                plan_updates = {
                    "repo_path": _resolve_planner_repo_path(repo_path) if repo_path else None,
                    "base_branch": agent_repo_evidence.get("base_branch"),
                }
                plan = store.update_plan_inbox_item(
                    item_id,
                    {key: value for key, value in plan_updates.items() if value},
                ) or plan
            structured = _merge_planner_structured_evidence(
                structured,
                _planner_pm_locked_gate_evidence(plan, agent_content, user_message["id"]),
            )
        checkpoint_updates: list[dict] = []
        for update in structured["checkpoint_updates"]:
            checkpoint = store.update_planning_checkpoint(
                plan_inbox_item_id=item_id,
                key=update["key"],
                status=update["status"],
                summary=update["summary"],
                source_message_ids=update["source_message_ids"],
            )
            if checkpoint is not None:
                checkpoint_updates.append(checkpoint)
        draft_spec = None
        if structured["draft_spec"]:
            draft_spec = store.create_agentic_spec(
                plan_inbox_item_id=item_id,
                content=_build_agentic_spec_draft(plan, structured["spec_deltas"]),
                metadata={
                    "source": "planner-pm",
                    "source_message_ids": [user_message["id"]],
                    "active_gate": structured["active_gate"],
                },
                status="draft",
            )
            checkpoint = store.update_planning_checkpoint(
                plan_inbox_item_id=item_id,
                key="spec_draft",
                status="agreed",
                summary=f"Draft spec v{draft_spec['version']} generated by Planner PM.",
                source_message_ids=[user_message["id"]],
            )
            if checkpoint is not None:
                checkpoint_updates.append(checkpoint)
        planner_content = (agent_result.get("content") or "").strip()
        if body.agentMode == "provider" and not planner_content:
            error_detail = agent_result.get("error") or agent_result.get("status") or "no_content"
            planner_content = f"Planner PM agent did not return a response. Agent status: {error_detail}."
        elif not planner_content:
            planner_content = structured["content"]
        pm_message = store.create_planner_discussion_message(
            plan_inbox_item_id=item_id,
            role="planner",
            kind=structured["kind"],
            content=planner_content,
            metadata={
                "source": "nidavellir_pm",
                "skill": "planner-pm",
                "provider": harness_metadata["provider"],
                "model": harness_metadata["model"],
                "agent_mode": body.agentMode,
                "agent_status": agent_result["status"],
                "agent_error": agent_result["error"],
                "harness": harness_metadata["harness"],
                "harness_conversation_id": harness_metadata["conversation_id"],
                "prompt_section_names": harness_metadata["prompt_section_names"],
                "injected_skill_ids": harness_metadata["injected_skill_ids"],
                "suppressed_skill_ids": harness_metadata["suppressed_skill_ids"],
                "estimated_tokens": harness_metadata["estimated_tokens"],
                "active_gate": structured["active_gate"],
                "checkpoint_updates": [{"key": item["key"], "status": item["status"]} for item in checkpoint_updates],
                "decisions": structured["decisions"],
                "assumptions": structured["assumptions"],
                "blockers": structured["blockers"],
                "spec_deltas": structured["spec_deltas"],
                "draft_spec_id": draft_spec["id"] if draft_spec else None,
            },
        )
        refreshed_plan = store.get_plan_inbox_item(item_id)
        if refreshed_plan is not None:
            refreshed_plan = _repair_planner_gate_frontier(store, item_id, refreshed_plan)
        return {
            "messages": [user_message, pm_message],
            "plan": refreshed_plan,
            "structured": {
                **structured,
                "checkpoint_updates": checkpoint_updates,
                "draft_spec": draft_spec,
                "harness": {key: value for key, value in harness_metadata.items() if not key.startswith("_")},
                "agent": agent_result,
            },
        }
    except Exception as err:
        _handle_store_error(err)
        raise


@router.post("/plan-inbox/{item_id}/pm-turn")
async def create_planner_pm_turn(item_id: str, body: PlannerPmTurnRequest, request: Request) -> dict:
    return await _execute_planner_pm_turn(item_id, body, request)


@router.post("/plan-inbox/{item_id}/pm-turn/stream")
async def stream_planner_pm_turn(item_id: str, body: PlannerPmTurnRequest, request: Request) -> StreamingResponse:
    async def events():
        queue: asyncio.Queue[dict] = asyncio.Queue()

        async def on_chunk(content: str) -> None:
            await queue.put({"type": "chunk", "content": content})

        async def on_activity(event: dict) -> None:
            await queue.put({"type": "activity", "event": event})

        yield json.dumps({"type": "start"}) + "\n"
        task = asyncio.create_task(_execute_planner_pm_turn(
            item_id,
            body,
            request,
            on_chunk=on_chunk,
            on_activity=on_activity,
        ))
        while not task.done() or not queue.empty():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=0.1)
                yield json.dumps(event) + "\n"
            except asyncio.TimeoutError:
                continue
        result = await task
        yield json.dumps({"type": "result", "result": result}) + "\n"
        yield json.dumps({"type": "done"}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.get("/plan-inbox/{item_id}/checkpoints")
def list_planning_checkpoints(item_id: str, request: Request) -> list[dict]:
    try:
        store = _store(request)
        item = store.get_plan_inbox_item(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="plan_inbox_item_not_found")
        repaired = _repair_planner_gate_frontier(store, item_id, item)
        return repaired.get("planning_checkpoints", [])
    except Exception as err:
        _handle_store_error(err)
        raise


@router.patch("/plan-inbox/{item_id}/checkpoints/{checkpoint_key}")
def update_planning_checkpoint(item_id: str, checkpoint_key: str, body: PlanningCheckpointUpdateRequest, request: Request) -> dict:
    try:
        checkpoint = _store(request).update_planning_checkpoint(
            plan_inbox_item_id=item_id,
            key=checkpoint_key,
            status=body.status,
            summary=body.summary,
            source_message_ids=body.sourceMessageIds,
            blocking_question=body.blockingQuestion,
        )
    except Exception as err:
        _handle_store_error(err)
        raise
    if checkpoint is None:
        raise HTTPException(status_code=404, detail="planning_checkpoint_not_found")
    return checkpoint


@router.post("/plan-inbox/{item_id}/specs")
def create_agentic_spec(item_id: str, body: AgenticSpecCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_agentic_spec(
            plan_inbox_item_id=item_id,
            content=body.content,
            metadata=body.metadata,
            status=body.status,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.post("/plan-inbox/{item_id}/readiness-reports")
def create_spec_readiness_report(item_id: str, body: SpecReadinessReportCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_spec_readiness_report(
            plan_inbox_item_id=item_id,
            spec_id=body.specId,
            verdict=body.verdict,
            report=body.report,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.post("/plan-inbox/{item_id}/decomposition-runs")
def create_decomposition_run(item_id: str, body: DecompositionRunCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_decomposition_run(
            plan_inbox_item_id=item_id,
            spec_id=body.specId,
            decomposer_output=body.decomposerOutput,
            status=body.status,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.get("/task-inbox")
def list_task_inbox_items(request: Request, status: str | None = None) -> list[dict]:
    try:
        return _store(request).list_task_inbox_items(status=status)
    except Exception as err:
        _handle_store_error(err)
        raise


@router.post("/task-inbox")
def create_task_inbox_item(body: TaskInboxCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_task_inbox_item(
            title=body.title,
            objective=body.objective,
            payload=body.payload,
            dependencies=body.dependencies,
            plan_inbox_item_id=body.planInboxItemId,
            decomposition_run_id=body.decompositionRunId,
            candidate_task_id=body.candidateTaskId,
            status=body.status,
            priority=body.priority,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.get("/task-inbox/{item_id}")
def get_task_inbox_item(item_id: str, request: Request) -> dict:
    item = _store(request).get_task_inbox_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="task_inbox_item_not_found")
    return item


@router.patch("/task-inbox/{item_id}")
def update_task_inbox_item(item_id: str, body: TaskInboxUpdateRequest, request: Request) -> dict:
    updates = {
        "title": body.title,
        "objective": body.objective,
        "payload": body.payload,
        "dependencies": body.dependencies,
        "status": body.status,
        "priority": body.priority,
        "locked_by": body.lockedBy,
        "locked_at": body.lockedAt,
        "materialized_task_id": body.materializedTaskId,
        "materialized_node_id": body.materializedNodeId,
    }
    try:
        item = _store(request).update_task_inbox_item(item_id, {key: value for key, value in updates.items() if value is not None})
    except Exception as err:
        _handle_store_error(err)
        raise
    if item is None:
        raise HTTPException(status_code=404, detail="task_inbox_item_not_found")
    return item


@router.post("/task-inbox/{item_id}/claim")
def claim_task_inbox_item(item_id: str, body: ClaimRequest, request: Request) -> dict:
    try:
        item = _store(request).claim_task_inbox_item(item_id, locked_by=body.lockedBy)
    except Exception as err:
        _handle_store_error(err)
        raise
    if item is None:
        raise HTTPException(status_code=404, detail="task_inbox_item_not_found")
    return item


@router.post("/task-inbox/{item_id}/shape-reports")
def create_task_shape_report(item_id: str, body: TaskShapeReportCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_task_shape_report(
            task_inbox_item_id=item_id,
            verdict=body.verdict,
            report=body.report,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


@router.post("/task-inbox/{item_id}/em-reviews")
def create_em_review(item_id: str, body: EmReviewCreateRequest, request: Request) -> dict:
    try:
        return _store(request).create_em_review(
            task_inbox_item_id=item_id,
            verdict=body.verdict,
            report=body.report,
        )
    except Exception as err:
        _handle_store_error(err)
        raise


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


@router.post("/tasks/{task_id}/archive")
def archive_task(task_id: str, request: Request) -> dict:
    task = _store(request).archive_task(task_id)
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


@router.post("/steps/{step_id}/run-agent")
async def run_agent_step(step_id: str, body: StepRunAgentRequest, request: Request) -> dict:
    store = _store(request)
    step = store.get_step(step_id)
    if step is None:
        raise HTTPException(status_code=404, detail="step_not_found")
    if step["type"] != "agent":
        raise HTTPException(status_code=400, detail="step_not_agent")
    node = store.get_node(step["node_id"])
    if node is None:
        raise HTTPException(status_code=404, detail="node_not_found")
    task = store.get_task(node["task_id"])
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    worktree = store.find_worktree_for_node(task_id=task["id"], node_id=node["id"])
    if worktree is None:
        raise HTTPException(status_code=400, detail="worktree_required")
    cwd = Path(worktree["worktree_path"]).expanduser().resolve()
    if not cwd.exists() or not cwd.is_dir():
        store.update_worktree(worktree["id"], {"status": "missing", "dirty_count": 0, "dirty_summary": []})
        raise HTTPException(status_code=400, detail="worktree_missing")

    provider = body.provider or node.get("provider") or step.get("config", {}).get("provider") or "codex"
    model = body.model or node.get("model") or step.get("config", {}).get("model")
    manifest = _agent_registry.PROVIDER_REGISTRY.get(provider)
    if manifest is None:
        raise HTTPException(status_code=400, detail="provider_not_found")
    if not manifest.supports_worktree_isolation:
        raise HTTPException(status_code=400, detail="provider_does_not_support_worktree_isolation")
    prompt = _prompt_from_step(step, body.prompt)
    conversation_id = body.conversationId or task.get("conversation_id")
    handoff_prompt = (
        "You are executing a Nidavellir orchestration agent step.\n"
        f"Task: {task['title']}\n"
        f"Node: {node['title']}\n"
        f"Worktree: {cwd}\n\n"
        "Rules:\n"
        "- Work only inside the provided worktree.\n"
        "- Do not switch branches or create/delete worktrees.\n"
        "- Report the files changed and tests run.\n\n"
        f"{TOOL_PROTOCOL_INSTRUCTIONS}\n\n"
        f"Step instructions:\n{prompt}"
    )

    attempt = store.create_run_attempt(
        task_id=task["id"],
        node_id=node["id"],
        step_id=step_id,
        conversation_id=conversation_id,
        provider=provider,
        model=model,
        worktree_path=str(cwd),
        status="running",
    )
    store.update_step_status(step_id, "running", output_summary="Agent running.")
    store.append_event(
        task_id=task["id"],
        node_id=node["id"],
        step_id=step_id,
        run_attempt_id=attempt["id"],
        type="agent_step_started",
        payload={"provider": provider, "model": model, "worktree_id": worktree["id"]},
    )

    agent = None
    transcript_parts: list[str] = []
    try:
        safety_store = getattr(request.app.state, "provider_safety_store", None)
        dangerousness = safety_store.get_policy(provider).effective_dangerousness if safety_store else "restricted"
        agent = _agent_registry.make_agent(
            provider,
            slot_id=0,
            workdir=cwd,
            model_id=model,
            dangerousness=dangerousness,
        )
        await agent.start()
        await agent.send(handoff_prompt)
        async for item in agent.stream():
            text = _stringify_agent_event(item)
            if text:
                transcript_parts.append(text)
        transcript = "".join(transcript_parts).strip()
        tool_request_payloads = extract_tool_requests(transcript)
        if tool_request_payloads:
            prepared_requests, invalid_requests = _prepare_orchestration_tool_requests(
                requests=tool_request_payloads,
                cwd=cwd,
                task=task,
                node=node,
                step_id=step_id,
                attempt_id=attempt["id"],
                worktree=worktree,
            )
            if invalid_requests:
                error = "; ".join(invalid_requests)
                updated_step = store.update_step_status(step_id, "failed", output_summary=error[:240])
                attempt = store.update_run_attempt(attempt["id"], status="failed", error=error) or attempt
                store.append_event(
                    task_id=task["id"],
                    node_id=node["id"],
                    step_id=step_id,
                    run_attempt_id=attempt["id"],
                    type="agent_step_tool_request_rejected",
                    payload={"errors": invalid_requests, "worktree_id": worktree["id"]},
                )
                return {
                    "step": updated_step,
                    "run_attempt": attempt,
                    "worktree": worktree,
                    "transcript": transcript,
                    "tool_requests": [],
                    "tool_request_errors": invalid_requests,
                }

            tool_store = _tool_request_store(request)
            created_requests = []
            for item in prepared_requests:
                permission = evaluate_and_audit(
                    request,
                    PermissionEvaluationRequest(
                        action=item["action"],  # type: ignore[arg-type]
                        path=item.get("path"),
                        command=item.get("command"),
                        workspace=item["workspace"],
                        conversation_id=conversation_id,
                        actor="agent",
                        metadata={
                            "source": "orchestration.run_agent_step",
                            "provider": provider,
                            "tool_name": item["tool_name"],
                            "step_id": step_id,
                            "run_attempt_id": attempt["id"],
                        },
                    ),
                )
                created_requests.append(tool_store.create(
                    conversation_id=conversation_id,
                    provider=provider,
                    tool_name=item["tool_name"],
                    action=item["action"],
                    status="denied" if permission.decision == PermissionDecision.DENY else "pending",
                    path=item.get("path"),
                    command=item.get("command"),
                    workspace=item["workspace"],
                    arguments=item["arguments"],
                    permission=permission,
                    reason=permission.reason,
                ))
            updated_step = store.update_step_status(
                step_id,
                "waiting_for_user",
                output_summary=f"Waiting for tool result: {len(created_requests)} tool request(s).",
            )
            attempt = store.update_run_attempt(attempt["id"], status="waiting_for_user") or attempt
            store.append_event(
                task_id=task["id"],
                node_id=node["id"],
                step_id=step_id,
                run_attempt_id=attempt["id"],
                type="agent_step_waiting_for_tool",
                payload={
                    "tool_request_ids": [item["id"] for item in created_requests],
                    "worktree_id": worktree["id"],
                },
            )
            await broadcast_resource_event(request.app, {
                "kind": "tool_requests",
                "action": "created",
                "conversation_id": conversation_id,
                "message": "Orchestration agent step is waiting for tool approval",
            })
            await broadcast_resource_event(request.app, {
                "kind": "orchestration",
                "action": "agent_step_waiting_for_tool",
                "conversation_id": conversation_id,
                "message": "Orchestration agent step is waiting for tool approval",
            })
            return {
                "step": updated_step,
                "run_attempt": attempt,
                "worktree": worktree,
                "transcript": transcript,
                "tool_requests": created_requests,
            }

        summary = transcript.splitlines()[-1][:240] if transcript else "Agent step completed."
        updated_step = store.update_step_status(step_id, "complete", output_summary=summary)
        attempt = store.update_run_attempt(attempt["id"], status="completed") or attempt
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
            run_attempt_id=attempt["id"],
            type="agent_step_finished",
            payload={"provider": provider, "model": model, "status": "complete", "worktree_id": worktree["id"]},
        )
        await broadcast_resource_event(request.app, {
            "kind": "orchestration",
            "action": "agent_step_finished",
            "conversation_id": conversation_id,
            "message": "Orchestration agent step completed",
        })
        return {
            "step": updated_step,
            "run_attempt": attempt,
            "worktree": worktree,
            "transcript": transcript,
        }
    except Exception as exc:
        error = str(exc)
        updated_step = store.update_step_status(step_id, "failed", output_summary=error[:240])
        attempt = store.update_run_attempt(attempt["id"], status="failed", error=error) or attempt
        store.append_event(
            task_id=task["id"],
            node_id=node["id"],
            step_id=step_id,
            run_attempt_id=attempt["id"],
            type="agent_step_failed",
            payload={"provider": provider, "model": model, "error": error},
        )
        return {
            "step": updated_step,
            "run_attempt": attempt,
            "worktree": worktree,
            "transcript": "".join(transcript_parts).strip(),
        }
    finally:
        if agent is not None:
            try:
                await agent.kill()
            except Exception:
                pass


@router.post("/steps/{step_id}/tool-requests/{request_id}/resume")
async def resume_agent_step_with_tool_result(step_id: str, request_id: str, body: StepRunAgentRequest, request: Request) -> dict:
    store = _store(request)
    step = store.get_step(step_id)
    if step is None:
        raise HTTPException(status_code=404, detail="step_not_found")
    item = _tool_request_store(request).get(request_id)
    if item is None:
        raise HTTPException(status_code=404, detail="tool_request_not_found")
    if item["status"] not in {"executed", "denied", "failed"}:
        raise HTTPException(status_code=400, detail="tool_request_not_resolved")
    orchestration = (item.get("arguments") or {}).get("orchestration") or {}
    if orchestration.get("step_id") != step_id:
        raise HTTPException(status_code=400, detail="tool_request_step_mismatch")
    node = store.get_node(step["node_id"])
    if node is None:
        raise HTTPException(status_code=404, detail="node_not_found")

    original_prompt = _prompt_from_step(step, body.prompt)
    resume_prompt = (
        f"{original_prompt}\n\n"
        "Nidavellir-mediated tool result:\n"
        f"{_continuation_content(item)}\n\n"
        "Continue the orchestration step from this result. If more workspace access is needed, "
        "emit another Nidavellir tool request and wait."
    )
    continued = _tool_request_store(request).mark_continued(request_id) or item
    store.append_event(
        task_id=node["task_id"],
        node_id=step["node_id"],
        step_id=step_id,
        run_attempt_id=orchestration.get("run_attempt_id"),
        type="agent_step_tool_result_continued",
        payload={"tool_request_id": request_id, "status": continued.get("status")},
    )
    result = await run_agent_step(
        step_id,
        StepRunAgentRequest(
            prompt=resume_prompt,
            provider=body.provider,
            model=body.model,
            conversationId=body.conversationId or item.get("conversation_id"),
        ),
        request,
    )
    return {"tool_request": continued, **result}


@router.post("/tasks/{task_id}/run-ready")
async def run_ready_steps(task_id: str, body: TaskRunReadyRequest, request: Request) -> dict:
    store = _store(request)
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    results: list[dict] = []
    pending_manual: list[dict] = []
    executed = 0

    while executed < body.maxSteps:
        task = store.get_task(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="task_not_found")
        runnable = task.get("readiness", {}).get("runnable", [])
        next_item = None
        pending_manual = []
        for item in runnable:
            step = _step_by_id(task, item["step_id"])
            if step is None:
                continue
            if step["type"] in {"command", "agent"}:
                next_item = item
                break
            pending_manual.append({
                "node_id": item["node_id"],
                "step_id": item["step_id"],
                "step_type": step["type"],
                "title": step["title"],
            })
        if next_item is None:
            break

        step = _step_by_id(task, next_item["step_id"])
        if step is None:
            break
        if step["type"] == "command":
            result = await run_command_step(
                step["id"],
                StepRunCommandRequest(
                    conversationId=body.conversationId or task.get("conversation_id"),
                    includeInChat=body.includeInChat,
                    timeoutSeconds=body.timeoutSeconds,
                    permissionOverride=body.permissionOverride,
                ),
                request,
            )
        else:
            result = await run_agent_step(
                step["id"],
                StepRunAgentRequest(
                    conversationId=body.conversationId or task.get("conversation_id"),
                ),
                request,
            )
        results.append({
            "node_id": next_item["node_id"],
            "step_id": step["id"],
            "step_type": step["type"],
            "status": result.get("step", {}).get("status"),
            "result": result,
        })
        executed += 1
        if result.get("step", {}).get("status") in {"failed", "waiting_for_user"}:
            break

    final_task = store.get_task(task_id)
    store.append_event(
        task_id=task_id,
        type="run_ready_finished",
        payload={
            "executed": executed,
            "pending_manual": pending_manual,
            "max_steps": body.maxSteps,
        },
    )
    return {
        "task": final_task,
        "executed": executed,
        "results": results,
        "pending_manual": pending_manual,
    }


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
            kind="execution" if body.nodeId else "task",
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


@router.post("/worktrees/{worktree_id}/checkpoint")
async def checkpoint_orchestration_worktree(worktree_id: str, body: WorktreeCheckpointRequest, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    message = body.message or f"Checkpoint {worktree['branch_name']}"
    try:
        result = checkpoint_worktree(
            worktree_path=Path(worktree["worktree_path"]),
            message=message,
        )
        info = result["status"]
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
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_checkpointed",
        payload={
            "worktree_id": worktree_id,
            "branch_name": worktree["branch_name"],
            "commit": result["commit"],
            "message": result["message"],
        },
    )
    await broadcast_resource_event(request.app, {
        "kind": "orchestration",
        "action": "worktree_checkpointed",
        "conversation_id": None,
        "message": "Orchestration worktree checkpoint committed",
    })
    return {"worktree": updated, "commit": result["commit"], "message": result["message"]}


@router.get("/worktrees/{worktree_id}/review")
def review_orchestration_worktree(worktree_id: str, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    base_ref = worktree.get("base_commit") or worktree.get("base_branch")
    if not base_ref:
        raise HTTPException(status_code=400, detail="worktree_base_ref_missing")
    try:
        review = review_worktree(
            worktree_path=Path(worktree["worktree_path"]),
            base_ref=base_ref,
        )
        updated = store.update_worktree(worktree_id, {
            "head_commit": review["head_commit"],
            "status": review["status"],
            "dirty_count": review["dirty_count"],
            "dirty_summary": review["dirty_summary"],
        })
    except Exception as err:
        _handle_store_error(err)
        raise
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_reviewed",
        payload={
            "worktree_id": worktree_id,
            "branch_name": worktree["branch_name"],
            "commit_count": review["commit_count"],
            "file_count": len(review["files"]),
            "ready_to_merge": review["ready_to_merge"],
        },
    )
    return {"worktree": updated or worktree, "review": review}


@router.get("/worktrees/{worktree_id}/integration-proposal")
def propose_worktree_integration(worktree_id: str, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    task = store.get_task(worktree["task_id"])
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    node = store.get_node(worktree["node_id"]) if worktree.get("node_id") else None
    base_ref = worktree.get("base_commit") or worktree.get("base_branch")
    if not base_ref:
        raise HTTPException(status_code=400, detail="worktree_base_ref_missing")
    try:
        review = review_worktree(
            worktree_path=Path(worktree["worktree_path"]),
            base_ref=base_ref,
        )
    except Exception as err:
        _handle_store_error(err)
        raise
    title_subject = node["title"] if node else task["title"]
    title = f"Integrate orchestration work: {title_subject}"
    commit_lines = "\n".join(f"- `{item['short_sha']}` {item['subject']}" for item in review["commits"][:10]) or "- No commits"
    file_lines = "\n".join(f"- `{item['status']}` {item['path']}" for item in review["files"][:20]) or "- No changed files"
    body = (
        "## Orchestration Integration\n"
        f"- Task: {task['title']}\n"
        f"- Node: {(node or {}).get('title') or 'Task branch'}\n"
        f"- Source branch: `{worktree['branch_name']}`\n"
        f"- Target branch: `{worktree['base_branch']}`\n"
        f"- Commit range: `{base_ref}..{review['head_commit']}`\n"
        f"- Status: {'ready' if review['ready_to_merge'] else 'needs attention'}\n\n"
        "## Commits\n"
        f"{commit_lines}\n\n"
        "## Files\n"
        f"{file_lines}\n\n"
        "## Diff Stat\n"
        f"{review['shortstat'] or 'No diff'}\n"
    )
    proposal = {
        "title": title,
        "body": body,
        "source_branch": worktree["branch_name"],
        "target_branch": worktree["base_branch"],
        "base_ref": base_ref,
        "head_commit": review["head_commit"],
        "ready_to_merge": review["ready_to_merge"],
        "review": review,
    }
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_integration_proposed",
        payload={
            "worktree_id": worktree_id,
            "source_branch": proposal["source_branch"],
            "target_branch": proposal["target_branch"],
            "ready_to_merge": proposal["ready_to_merge"],
        },
    )
    return {"worktree": worktree, "proposal": proposal}


@router.get("/worktrees/{worktree_id}/integration-preflight")
def preflight_worktree_integration(worktree_id: str, request: Request) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    target_ref = worktree.get("base_branch")
    source_ref = worktree.get("branch_name")
    if not target_ref or not source_ref:
        raise HTTPException(status_code=400, detail="worktree_merge_refs_missing")
    try:
        preflight = preflight_worktree_merge(
            worktree_path=Path(worktree["worktree_path"]),
            target_ref=target_ref,
            source_ref=source_ref,
        )
        updated = store.update_worktree(worktree_id, {
            "head_commit": preflight["source_commit"],
            "status": preflight["status"],
            "dirty_count": preflight["dirty_count"],
            "dirty_summary": preflight["dirty_summary"],
        })
    except Exception as err:
        _handle_store_error(err)
        raise
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_integration_preflighted",
        payload={
            "worktree_id": worktree_id,
            "source_branch": source_ref,
            "target_branch": target_ref,
            "can_merge": preflight["can_merge"],
            "conflict_count": len(preflight["conflicts"]),
        },
    )
    return {"worktree": updated or worktree, "preflight": preflight}


@router.post("/worktrees/{worktree_id}/integration-worktree")
def stage_worktree_integration(worktree_id: str, request: Request, body: WorktreeIntegrationRequest | None = None) -> dict:
    store = _store(request)
    worktree = store.get_worktree(worktree_id)
    if worktree is None:
        raise HTTPException(status_code=404, detail="worktree_not_found")
    if worktree["status"] == "removed":
        raise HTTPException(status_code=400, detail="worktree_removed")
    target_ref = worktree.get("base_branch")
    source_ref = worktree.get("branch_name")
    if not target_ref or not source_ref:
        raise HTTPException(status_code=400, detail="worktree_merge_refs_missing")
    body = body or WorktreeIntegrationRequest()
    branch_name = body.branchName or f"integration/{slugify(source_ref)}-{uuid.uuid4().hex[:8]}"
    target_path = (
        Path(body.worktreePath).expanduser().resolve()
        if body.worktreePath
        else default_integration_worktree_path(Path(worktree["repo_path"]), branch_name)
    )
    message = body.message or f"Integrate {source_ref}"
    try:
        integration = create_integration_worktree(
            repo_path=Path(worktree["repo_path"]),
            worktree_path=target_path,
            branch_name=branch_name,
            target_ref=target_ref,
            source_ref=source_ref,
            message=message,
        )
        integration_worktree = store.create_worktree(
            task_id=worktree["task_id"],
            node_id=worktree["node_id"],
            repo_path=worktree["repo_path"],
            worktree_path=integration["worktree_path"],
            kind="integration",
            base_branch=target_ref,
            branch_name=integration["branch_name"],
            base_commit=integration["base_commit"],
            head_commit=integration["head_commit"],
            status=integration["status"],
            dirty_count=integration["dirty_count"],
            dirty_summary=integration["dirty_summary"],
        )
    except Exception as err:
        _handle_store_error(err)
        raise
    store.append_event(
        task_id=worktree["task_id"],
        node_id=worktree["node_id"],
        type="worktree_integration_staged",
        payload={
            "source_worktree_id": worktree_id,
            "source_branch": source_ref,
            "target_branch": target_ref,
            "integration_branch": integration["branch_name"],
            "integration_worktree_path": integration["worktree_path"],
            "merged": integration["merged"],
        },
    )
    return {"source_worktree": worktree, "integration_worktree": integration_worktree, "integration": integration}


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
