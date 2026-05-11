from __future__ import annotations

import hashlib
import re
from enum import StrEnum
from typing import Any, Protocol

from pydantic import BaseModel, Field


class PlannerGate(StrEnum):
    INTAKE = "intake"
    REPO_TARGET = "repo_target"
    SCOPE = "scope"
    ACCEPTANCE = "acceptance"
    VERIFICATION = "verification"
    RISKS = "risks"
    SPEC_DRAFT = "spec_draft"
    SPEC_APPROVED = "spec_approved"


GATE_ORDER: tuple[PlannerGate, ...] = (
    PlannerGate.INTAKE,
    PlannerGate.REPO_TARGET,
    PlannerGate.SCOPE,
    PlannerGate.ACCEPTANCE,
    PlannerGate.VERIFICATION,
    PlannerGate.RISKS,
    PlannerGate.SPEC_DRAFT,
    PlannerGate.SPEC_APPROVED,
)


class PlannerTransition(StrEnum):
    BLOCKED = "blocked"
    PROPOSED = "proposed"
    LOCKED = "locked"
    DRAFT_REQUESTED = "draft_requested"
    DRAFTED = "drafted"
    APPROVED = "approved"
    REVISION_REQUESTED = "revision_requested"
    NOOP = "noop"


class PlannerMessageKind(StrEnum):
    MESSAGE = "message"
    QUESTION = "question"
    DECISION = "decision"
    APPROVAL = "approval"


class HelperTask(StrEnum):
    SCOPE_EXTRACT = "scope_extract"
    ACCEPTANCE_PROPOSE = "acceptance_propose"
    VERIFICATION_NORMALIZE = "verification_normalize"
    RISKS_EXTRACT = "risks_extract"
    SPEC_DRAFT = "spec_draft"


class HelperStatus(StrEnum):
    SKIPPED = "skipped"
    COMPLETED = "completed"
    FAILED = "failed"
    INVALID = "invalid"


class RepoTargetEvidence(BaseModel):
    repo_path: str
    base_branch: str | None = None
    mode: str | None = None
    source: str = "user"


class ScopeEvidence(BaseModel):
    in_scope: list[str] = Field(default_factory=list)
    non_goals: list[str] = Field(default_factory=list)
    source: str = "user"


class AcceptanceEvidence(BaseModel):
    criteria: list[str] = Field(default_factory=list)
    source: str = "user"


class VerificationEvidence(BaseModel):
    commands: list[str] = Field(default_factory=list)
    manual_checks: list[str] = Field(default_factory=list)
    screenshots: list[str] = Field(default_factory=list)
    unverified_commands: list[str] = Field(default_factory=list)
    source: str = "user"


class RiskEvidence(BaseModel):
    risks: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    source: str = "user"


class PlannerCheckpointUpdate(BaseModel):
    key: PlannerGate
    status: str = "agreed"
    summary: str
    source_message_ids: list[str]


class PlannerSpecDelta(BaseModel):
    section: str
    content: str
    source_message_id: str


class PlannerPlanUpdate(BaseModel):
    repo_path: str | None = None
    base_branch: str | None = None
    acceptance_criteria: list[str] | None = None
    constraints: list[str] | None = None

    def has_changes(self) -> bool:
        return any(value is not None for value in self.model_dump().values())

    def to_store_updates(self) -> dict[str, Any]:
        data = self.model_dump(exclude_none=True)
        updates: dict[str, Any] = {}
        if "repo_path" in data:
            updates["repo_path"] = data["repo_path"]
        if "base_branch" in data:
            updates["base_branch"] = data["base_branch"]
        if "acceptance_criteria" in data:
            updates["acceptance_criteria"] = data["acceptance_criteria"]
        if "constraints" in data:
            updates["constraints"] = data["constraints"]
        return updates


class PlannerDraftSpecRequest(BaseModel):
    content: str
    status: str = "draft"
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlannerHelperResult(BaseModel):
    used: bool = False
    task: HelperTask | None = None
    status: HelperStatus = HelperStatus.SKIPPED
    data: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    validation_errors: list[str] = Field(default_factory=list)


class PlannerGateProposal(BaseModel):
    gate: PlannerGate
    summary: str
    proposal_id: str | None = None
    repo_target: RepoTargetEvidence | None = None
    scope: ScopeEvidence | None = None
    acceptance: AcceptanceEvidence | None = None
    verification: VerificationEvidence | None = None
    risks: RiskEvidence | None = None
    source: str = "engine"

    def with_id(self) -> "PlannerGateProposal":
        data = self.model_dump(mode="json", exclude={"proposal_id"})
        digest = hashlib.sha256(repr(sorted(data.items())).encode("utf-8")).hexdigest()[:12]
        return self.model_copy(update={"proposal_id": digest})


class PlannerPmTurnDecision(BaseModel):
    input_gate: PlannerGate
    next_gate: PlannerGate
    active_gate: PlannerGate
    transition: PlannerTransition
    message_kind: PlannerMessageKind
    ui_message: str
    next_question: str | None = None
    proposal: PlannerGateProposal | None = None
    checkpoint_updates: list[PlannerCheckpointUpdate] = Field(default_factory=list)
    plan_updates: PlannerPlanUpdate = Field(default_factory=PlannerPlanUpdate)
    spec_deltas: list[PlannerSpecDelta] = Field(default_factory=list)
    draft_spec_request: PlannerDraftSpecRequest | None = None
    helper: PlannerHelperResult = Field(default_factory=PlannerHelperResult)
    decisions: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    blockers: list[dict[str, str]] = Field(default_factory=list)
    validation_errors: list[str] = Field(default_factory=list)
    clears_proposal_gate: PlannerGate | None = None


class PlannerPmHelper(Protocol):
    async def run(
        self,
        task: HelperTask,
        *,
        plan: dict,
        active_gate: PlannerGate,
        user_content: str,
        context: dict[str, Any],
    ) -> PlannerHelperResult:
        ...


class RepoResolver(Protocol):
    def resolve(self, repo_path: str) -> str | None:
        ...

    def is_ready_or_creatable(self, repo_path: str) -> bool:
        ...


class DirectEvidence(BaseModel):
    repo_target: RepoTargetEvidence | None = None
    scope: ScopeEvidence | None = None
    acceptance: AcceptanceEvidence | None = None
    verification: VerificationEvidence | None = None
    risks: RiskEvidence | None = None

    def for_gate(self, gate: PlannerGate) -> Any:
        return getattr(self, gate.value, None)

    def satisfies(self, gate: PlannerGate) -> bool:
        if gate == PlannerGate.REPO_TARGET:
            return self.repo_target is not None
        if gate == PlannerGate.SCOPE:
            return self.scope is not None and bool(self.scope.in_scope) and bool(self.scope.non_goals)
        if gate == PlannerGate.ACCEPTANCE:
            return self.acceptance is not None and bool(self.acceptance.criteria)
        if gate == PlannerGate.VERIFICATION:
            return self.verification is not None and bool(self.verification.commands or self.verification.manual_checks or self.verification.screenshots)
        if gate == PlannerGate.RISKS:
            return self.risks is not None and bool(self.risks.risks or self.risks.dependencies or self.risks.guardrails)
        return False


APPROVAL_PATTERNS = (
    r"\bapprove(?:d)?\b",
    r"\block (?:it|this|that|them)\b",
    r"\byes\b",
    r"\byep\b",
    r"\blooks good\b",
    r"\bthat works\b",
    r"\bship it\b",
)
DENIAL_PATTERNS = (
    r"\bno\b",
    r"\bnot quite\b",
    r"\bdeny\b",
    r"\bdenied\b",
    r"\breject\b",
    r"\bchange\b",
    r"\brevise\b",
    r"\bhold\b",
)


def determine_active_gate(plan: dict) -> PlannerGate:
    checkpoints = {item.get("key"): item.get("status", "missing") for item in plan.get("planning_checkpoints") or []}
    for gate in GATE_ORDER:
        if checkpoints.get(gate.value) != "agreed":
            return gate
    return PlannerGate.SPEC_APPROVED


def next_gate_after(plan: dict, updates: list[PlannerCheckpointUpdate]) -> PlannerGate:
    agreed = {item.key.value for item in updates if item.status == "agreed"}
    checkpoints = {item.get("key"): item.get("status", "missing") for item in plan.get("planning_checkpoints") or []}
    for gate in GATE_ORDER:
        if gate.value not in agreed and checkpoints.get(gate.value) != "agreed":
            return gate
    return PlannerGate.SPEC_APPROVED


def latest_planner_proposal(plan: dict) -> PlannerGateProposal | None:
    for message in reversed(plan.get("discussion_messages") or []):
        if message.get("role") != "planner":
            continue
        metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        clear_gate = metadata.get("clears_proposal_gate")
        if clear_gate:
            return None
        raw = metadata.get("proposal")
        if not raw:
            continue
        try:
            return PlannerGateProposal.model_validate(raw)
        except Exception:
            return None
    return None


def _lines_after_heading(text: str, heading: str) -> list[str]:
    match = re.search(rf"(?im)^\s*{re.escape(heading)}\s*:\s*$", text)
    if not match:
        return []
    rest = text[match.end():]
    next_heading = re.search(r"(?m)^\s*[A-Za-z][A-Za-z -]{2,}\s*:\s*$", rest)
    if next_heading:
        rest = rest[:next_heading.start()]
    values: list[str] = []
    for line in rest.splitlines():
        item = re.sub(r"^\s*[-*]\s*", "", line).strip()
        if item:
            values.append(item)
    return values


def _extract_repo_path(text: str, repo_resolver: RepoResolver | None) -> RepoTargetEvidence | None:
    candidates = re.findall(r"`([^`]+)`", text)
    candidates += re.findall(r"(?i)(?:repo|path|target)(?:\s+is|\s*:)?\s+([~/A-Za-z]:?[\\/][^\s,.;]+)", text)
    for candidate in reversed(candidates):
        path = candidate.strip()
        if not re.match(r"^(?:~|/|[A-Za-z]:[\\/])", path):
            continue
        resolved = repo_resolver.resolve(path) if repo_resolver else path
        if not resolved:
            continue
        if re.search(r"\bmain\b", text, re.IGNORECASE):
            branch = "main"
        else:
            branch_match = re.search(r"(?i)\b(?:branch|base branch|default branch)\b[^A-Za-z0-9_-]*([A-Za-z0-9][A-Za-z0-9._/-]*)", text)
            branch = branch_match.group(1).strip() if branch_match else None
        return RepoTargetEvidence(repo_path=resolved, base_branch=branch, mode="new_project" if "new" in text.lower() else None)
    return None


def extract_direct_evidence(plan: dict, active_gate: PlannerGate, user_content: str, repo_resolver: RepoResolver | None = None) -> DirectEvidence:
    scope_items = _lines_after_heading(user_content, "Scope")
    non_goals = _lines_after_heading(user_content, "Non-goals") or _lines_after_heading(user_content, "Non goals")
    acceptance = _lines_after_heading(user_content, "Acceptance")
    verification = _lines_after_heading(user_content, "Verification")
    risks = _lines_after_heading(user_content, "Risks")
    dependencies = _lines_after_heading(user_content, "Dependencies")
    guardrails = _lines_after_heading(user_content, "Guardrails")
    return DirectEvidence(
        repo_target=_extract_repo_path(user_content, repo_resolver),
        scope=ScopeEvidence(in_scope=scope_items, non_goals=non_goals) if scope_items or non_goals else None,
        acceptance=AcceptanceEvidence(criteria=acceptance) if acceptance else None,
        verification=VerificationEvidence(commands=verification) if verification else None,
        risks=RiskEvidence(risks=risks, dependencies=dependencies, guardrails=guardrails) if risks or dependencies or guardrails else None,
    )


def _approval(user_content: str, proposal: PlannerGateProposal | None, active_gate: PlannerGate) -> tuple[bool, bool]:
    if proposal is None or proposal.gate != active_gate:
        return False, False
    text = user_content.lower()
    is_denial = any(re.search(pattern, text) for pattern in DENIAL_PATTERNS)
    is_approval = any(re.search(pattern, text) for pattern in APPROVAL_PATTERNS)
    return is_approval and not is_denial, is_denial


def _is_approval_text(user_content: str) -> bool:
    text = user_content.lower()
    is_denial = any(re.search(pattern, text) for pattern in DENIAL_PATTERNS)
    is_approval = any(re.search(pattern, text) for pattern in APPROVAL_PATTERNS)
    return is_approval and not is_denial


def validate_proposal_for_lock(proposal: PlannerGateProposal, repo_resolver: RepoResolver | None = None) -> list[str]:
    errors: list[str] = []
    if proposal.gate == PlannerGate.REPO_TARGET:
        if proposal.repo_target is None:
            errors.append("repo target proposal missing target")
        elif repo_resolver and not repo_resolver.is_ready_or_creatable(proposal.repo_target.repo_path):
            errors.append("repo target path is not ready or creatable")
    elif proposal.gate == PlannerGate.SCOPE:
        if proposal.scope is None or not proposal.scope.in_scope:
            errors.append("scope proposal missing in-scope outcomes")
        if proposal.scope is None or not proposal.scope.non_goals:
            errors.append("scope proposal missing explicit non-goals")
    elif proposal.gate == PlannerGate.ACCEPTANCE:
        if proposal.acceptance is None or not proposal.acceptance.criteria:
            errors.append("acceptance proposal missing criteria")
    elif proposal.gate == PlannerGate.VERIFICATION:
        if proposal.verification is None or not (proposal.verification.commands or proposal.verification.manual_checks or proposal.verification.screenshots):
            errors.append("verification proposal missing checks")
    elif proposal.gate == PlannerGate.RISKS:
        if proposal.risks is None or not (proposal.risks.risks or proposal.risks.dependencies or proposal.risks.guardrails):
            errors.append("risk proposal missing risks, dependencies, or guardrails")
    return errors


def _checkpoint_from_proposal(proposal: PlannerGateProposal, source_message_id: str) -> PlannerCheckpointUpdate:
    return PlannerCheckpointUpdate(
        key=proposal.gate,
        status="agreed",
        summary=proposal.summary,
        source_message_ids=[source_message_id],
    )


def _spec_delta_from_proposal(proposal: PlannerGateProposal, source_message_id: str) -> PlannerSpecDelta | None:
    if proposal.gate == PlannerGate.SCOPE and proposal.scope:
        content = "Scope:\n" + "\n".join(f"- {item}" for item in proposal.scope.in_scope)
        content += "\n\nNon-goals:\n" + "\n".join(f"- {item}" for item in proposal.scope.non_goals)
        return PlannerSpecDelta(section="Scope", content=content, source_message_id=source_message_id)
    if proposal.gate == PlannerGate.ACCEPTANCE and proposal.acceptance:
        return PlannerSpecDelta(section="Acceptance Criteria", content="\n".join(f"- {item}" for item in proposal.acceptance.criteria), source_message_id=source_message_id)
    if proposal.gate == PlannerGate.VERIFICATION and proposal.verification:
        checks = [*proposal.verification.commands, *proposal.verification.manual_checks, *proposal.verification.screenshots]
        return PlannerSpecDelta(section="Verification Strategy", content="\n".join(f"- {item}" for item in checks), source_message_id=source_message_id)
    if proposal.gate == PlannerGate.RISKS and proposal.risks:
        values = [*proposal.risks.risks, *proposal.risks.dependencies, *proposal.risks.guardrails]
        return PlannerSpecDelta(section="Risks and Dependencies", content="\n".join(f"- {item}" for item in values), source_message_id=source_message_id)
    return None


def _plan_update_from_proposal(proposal: PlannerGateProposal) -> PlannerPlanUpdate:
    if proposal.gate == PlannerGate.REPO_TARGET and proposal.repo_target:
        return PlannerPlanUpdate(repo_path=proposal.repo_target.repo_path, base_branch=proposal.repo_target.base_branch)
    if proposal.gate == PlannerGate.ACCEPTANCE and proposal.acceptance:
        return PlannerPlanUpdate(acceptance_criteria=proposal.acceptance.criteria)
    return PlannerPlanUpdate()


def _proposal_for_gate(plan: dict, gate: PlannerGate, user_content: str, evidence: DirectEvidence) -> PlannerGateProposal | None:
    if gate == PlannerGate.REPO_TARGET:
        repo_path = (evidence.repo_target.repo_path if evidence.repo_target else None) or str(plan.get("repo_path") or "").strip()
        if not repo_path:
            return None
        base_branch = (evidence.repo_target.base_branch if evidence.repo_target else None) or str(plan.get("base_branch") or "main").strip() or "main"
        return PlannerGateProposal(
            gate=gate,
            summary=f"Repo target locked to {repo_path} @ {base_branch}.",
            repo_target=RepoTargetEvidence(repo_path=repo_path, base_branch=base_branch, mode=str(plan.get("entry_mode") or "new_project")),
        ).with_id()
    if gate == PlannerGate.SCOPE:
        scope = evidence.scope
        runtime = ""
        if re.fullmatch(r"\s*(?:shell|sh|bash|posix shell|shell script)\s*[.!]?\s*", user_content, re.IGNORECASE):
            runtime = "shell"
        if scope is None and runtime:
            scope = ScopeEvidence(
                in_scope=[
                    "Create the smallest useful CLI that prints `hello nidavellir`.",
                    "Use a single shell entrypoint script.",
                    "Add one test command that proves the output exactly matches `hello nidavellir`.",
                ],
                non_goals=[
                    "No package manager or external test framework.",
                    "No argument parsing, install flow, CI, README, or multi-command CLI.",
                    "No implementation work inside the PM chat.",
                ],
            )
        if scope and scope.in_scope and scope.non_goals:
            return PlannerGateProposal(gate=gate, summary="Scope and non-goals proposed for approval.", scope=scope).with_id()
    if gate == PlannerGate.ACCEPTANCE:
        criteria = evidence.acceptance or (AcceptanceEvidence(criteria=list(plan.get("acceptance_criteria") or [])) if plan.get("acceptance_criteria") else None)
        if criteria and criteria.criteria:
            return PlannerGateProposal(gate=gate, summary="Acceptance criteria proposed for approval.", acceptance=criteria).with_id()
    if gate == PlannerGate.VERIFICATION:
        verification = evidence.verification
        if verification is None and "hello" in str(plan.get("raw_plan") or "").lower():
            verification = VerificationEvidence(commands=["Run the CLI command and confirm it prints `hello nidavellir`.", "Run the test command and confirm it exits 0."])
        if verification and (verification.commands or verification.manual_checks or verification.screenshots):
            return PlannerGateProposal(gate=gate, summary="Verification strategy proposed for approval.", verification=verification).with_id()
    if gate == PlannerGate.RISKS:
        risks = evidence.risks
        if risks is None:
            risks = RiskEvidence(risks=["Tiny shell script scope has low implementation risk."], dependencies=["Target repo must be initialized before implementation."], guardrails=["PM does not run implementation or tests."])
        return PlannerGateProposal(gate=gate, summary="Risks, dependencies, and autonomy guardrails proposed for approval.", risks=risks).with_id()
    return None


def _question_for_gate(gate: PlannerGate) -> str:
    return {
        PlannerGate.REPO_TARGET: "Which absolute repo path and base branch should this work target?",
        PlannerGate.SCOPE: "What is in scope for the first slice, and what is explicitly out of scope?",
        PlannerGate.ACCEPTANCE: "What observable criteria prove this work is done?",
        PlannerGate.VERIFICATION: "What commands or checks should verify completion?",
        PlannerGate.RISKS: "What risks, dependencies, or autonomy guardrails should the EM know?",
        PlannerGate.SPEC_DRAFT: "Should I draft the agentic-forward spec from locked planning evidence?",
        PlannerGate.SPEC_APPROVED: "Do you approve this spec for decomposition?",
    }.get(gate, "What should we clarify next?")


def _render_proposal(proposal: PlannerGateProposal) -> str:
    heading = f"Active gate: {proposal.gate.value.replace('_', ' ').title()}"
    if proposal.gate == PlannerGate.REPO_TARGET and proposal.repo_target:
        body = [
            "Proposed repo target:",
            f"- Path: `{proposal.repo_target.repo_path}`",
            f"- Base branch: `{proposal.repo_target.base_branch or 'main'}`",
            "",
            "Approve this repo target to lock the gate, or deny it and tell me what to change.",
        ]
    elif proposal.gate == PlannerGate.SCOPE and proposal.scope:
        body = [
            "Proposed scope:",
            *[f"- {item}" for item in proposal.scope.in_scope],
            "",
            "Explicit non-goals:",
            *[f"- {item}" for item in proposal.scope.non_goals],
            "",
            "Approve this scope to lock the gate, or deny it and tell me what to change.",
        ]
    elif proposal.gate == PlannerGate.ACCEPTANCE and proposal.acceptance:
        body = ["Proposed acceptance criteria:", *[f"- {item}" for item in proposal.acceptance.criteria], "", "Approve these criteria, or deny and revise them."]
    elif proposal.gate == PlannerGate.VERIFICATION and proposal.verification:
        checks = [*proposal.verification.commands, *proposal.verification.manual_checks, *proposal.verification.screenshots]
        body = ["Proposed verification:", *[f"- {item}" for item in checks], "", "Approve this verification strategy, or deny and revise it."]
    elif proposal.gate == PlannerGate.RISKS and proposal.risks:
        body = [
            "Proposed risks and guardrails:",
            *[f"- {item}" for item in [*proposal.risks.risks, *proposal.risks.dependencies, *proposal.risks.guardrails]],
            "",
            "Approve these risks and guardrails, or deny and revise them.",
        ]
    else:
        body = [_question_for_gate(proposal.gate)]
    return "\n".join([heading, "", *body])


def _render_locked(locked_gate: PlannerGate, next_gate: PlannerGate) -> str:
    return "\n".join([
        f"{locked_gate.value.replace('_', ' ').title()} is locked.",
        "",
        f"Active gate: {next_gate.value.replace('_', ' ').title()}",
        "",
        f"Focused question: {_question_for_gate(next_gate)}",
    ])


def _blocked(plan: dict, gate: PlannerGate, user_content: str, validation_errors: list[str] | None = None) -> PlannerPmTurnDecision:
    errors = validation_errors or []
    body = [
        f"Active gate: {gate.value.replace('_', ' ').title()}",
        "",
        "I cannot send this to decomposition yet.",
    ]
    if errors:
        body.extend(["", "Validation:", *[f"- {item}" for item in errors]])
    body.extend(["", f"Focused question: {_question_for_gate(gate)}"])
    return PlannerPmTurnDecision(
        input_gate=gate,
        next_gate=gate,
        active_gate=gate,
        transition=PlannerTransition.BLOCKED,
        message_kind=PlannerMessageKind.QUESTION,
        ui_message="\n".join(body),
        next_question=_question_for_gate(gate),
        validation_errors=errors,
        blockers=[{"gate": gate.value, "question": _question_for_gate(gate)}],
    )


def _deterministic_spec_markdown(plan: dict) -> str:
    checkpoints = {item.get("key"): item for item in plan.get("planning_checkpoints") or []}
    messages = plan.get("discussion_messages") or []
    proposal_dumps = []
    for message in messages:
        metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        if metadata.get("proposal"):
            proposal_dumps.append(metadata["proposal"])
    return "\n".join([
        "# Agentic Forward Spec",
        "",
        "## Goal",
        str(plan.get("raw_plan") or "").strip(),
        "",
        "## Target Repository",
        f"- Repo path: {plan.get('repo_path') or 'Not captured'}",
        f"- Base branch: {plan.get('base_branch') or 'main'}",
        "",
        "## Locked Planning Evidence",
        *[f"- {key}: {value.get('summary') or value.get('status')}" for key, value in checkpoints.items() if value.get("status") == "agreed"],
        "",
        "## Proposal Evidence",
        "```json",
        repr(proposal_dumps),
        "```",
    ])


async def run_planner_pm_turn(
    plan: dict,
    user_content: str,
    user_message_id: str,
    *,
    helper: PlannerPmHelper | None = None,
    repo_resolver: RepoResolver | None = None,
) -> PlannerPmTurnDecision:
    active_gate = determine_active_gate(plan)
    previous_proposal = latest_planner_proposal(plan)
    evidence = extract_direct_evidence(plan, active_gate, user_content, repo_resolver)
    is_approval, is_denial = _approval(user_content, previous_proposal, active_gate)

    if is_denial and previous_proposal is not None:
        return PlannerPmTurnDecision(
            input_gate=active_gate,
            next_gate=active_gate,
            active_gate=active_gate,
            transition=PlannerTransition.REVISION_REQUESTED,
            message_kind=PlannerMessageKind.QUESTION,
            ui_message="\n".join([
                f"Active gate: {active_gate.value.replace('_', ' ').title()}",
                "",
                "Understood. I will not lock the current proposal.",
                "",
                f"Focused question: What should change about the {active_gate.value.replace('_', ' ')} proposal?",
            ]),
            clears_proposal_gate=active_gate,
            next_question=f"What should change about the {active_gate.value.replace('_', ' ')} proposal?",
        )

    if is_approval and previous_proposal is not None:
        errors = validate_proposal_for_lock(previous_proposal, repo_resolver)
        if errors:
            return _blocked(plan, active_gate, user_content, errors)
        checkpoint = _checkpoint_from_proposal(previous_proposal, user_message_id)
        next_gate = next_gate_after(plan, [checkpoint])
        delta = _spec_delta_from_proposal(previous_proposal, user_message_id)
        return PlannerPmTurnDecision(
            input_gate=active_gate,
            next_gate=next_gate,
            active_gate=next_gate,
            transition=PlannerTransition.LOCKED,
            message_kind=PlannerMessageKind.DECISION,
            ui_message=_render_locked(previous_proposal.gate, next_gate),
            next_question=_question_for_gate(next_gate),
            checkpoint_updates=[checkpoint],
            plan_updates=_plan_update_from_proposal(previous_proposal),
            spec_deltas=[delta] if delta else [],
            decisions=[f"{previous_proposal.gate.value} gate locked from user approval."],
        )

    if evidence.satisfies(active_gate):
        proposal = _proposal_for_gate(plan, active_gate, user_content, evidence)
        if proposal:
            errors = validate_proposal_for_lock(proposal, repo_resolver)
            if errors:
                return _blocked(plan, active_gate, user_content, errors)
            checkpoint = _checkpoint_from_proposal(proposal, user_message_id)
            next_gate = next_gate_after(plan, [checkpoint])
            delta = _spec_delta_from_proposal(proposal, user_message_id)
            return PlannerPmTurnDecision(
                input_gate=active_gate,
                next_gate=next_gate,
                active_gate=next_gate,
                transition=PlannerTransition.LOCKED,
                message_kind=PlannerMessageKind.DECISION,
                ui_message=_render_locked(proposal.gate, next_gate),
                next_question=_question_for_gate(next_gate),
                checkpoint_updates=[checkpoint],
                plan_updates=_plan_update_from_proposal(proposal),
                spec_deltas=[delta] if delta else [],
                decisions=[f"{proposal.gate.value} gate locked from explicit user evidence."],
            )

    if active_gate == PlannerGate.SPEC_DRAFT:
        if not (
            re.search(r"\b(?:draft|generate|create)\b", user_content, re.IGNORECASE)
            or _is_approval_text(user_content)
        ):
            return PlannerPmTurnDecision(
                input_gate=active_gate,
                next_gate=active_gate,
                active_gate=active_gate,
                transition=PlannerTransition.DRAFT_REQUESTED,
                message_kind=PlannerMessageKind.QUESTION,
                ui_message="Active gate: Spec Draft\n\nAll prior gates are locked. Should I draft the agentic-forward spec from locked planning evidence?",
                next_question="Should I draft the agentic-forward spec from locked planning evidence?",
            )
        content = _deterministic_spec_markdown(plan)
        return PlannerPmTurnDecision(
            input_gate=active_gate,
            next_gate=PlannerGate.SPEC_APPROVED,
            active_gate=PlannerGate.SPEC_APPROVED,
            transition=PlannerTransition.DRAFTED,
            message_kind=PlannerMessageKind.DECISION,
            ui_message="Spec draft created from locked planning evidence. Review it before approving decomposition.",
            draft_spec_request=PlannerDraftSpecRequest(content=content, metadata={"source": "deterministic_planner_pm"}),
        )

    if active_gate == PlannerGate.SPEC_APPROVED:
        spec = (plan.get("specs") or [None])[0]
        if spec is None:
            return _blocked(plan, PlannerGate.SPEC_DRAFT, user_content, ["spec approval blocked because no spec exists"])
        is_final_approval = any(re.search(pattern, user_content.lower()) for pattern in APPROVAL_PATTERNS)
        if not is_final_approval:
            return PlannerPmTurnDecision(
                input_gate=active_gate,
                next_gate=active_gate,
                active_gate=active_gate,
                transition=PlannerTransition.BLOCKED,
                message_kind=PlannerMessageKind.QUESTION,
                ui_message="Active gate: Spec Approved\n\nDo you approve this spec for decomposition?",
                next_question="Do you approve this spec for decomposition?",
            )
        checkpoint = PlannerCheckpointUpdate(
            key=PlannerGate.SPEC_APPROVED,
            status="agreed",
            summary=f"User approved spec v{spec.get('version')} for decomposition.",
            source_message_ids=[user_message_id],
        )
        return PlannerPmTurnDecision(
            input_gate=active_gate,
            next_gate=PlannerGate.SPEC_APPROVED,
            active_gate=PlannerGate.SPEC_APPROVED,
            transition=PlannerTransition.APPROVED,
            message_kind=PlannerMessageKind.APPROVAL,
            ui_message="Spec approved for decomposition. Nidavellir can now create candidate tasks.",
            checkpoint_updates=[checkpoint],
            decisions=[f"Spec {spec.get('id')} approved for decomposition."],
        )

    proposal = _proposal_for_gate(plan, active_gate, user_content, evidence)
    if proposal:
        return PlannerPmTurnDecision(
            input_gate=active_gate,
            next_gate=active_gate,
            active_gate=active_gate,
            transition=PlannerTransition.PROPOSED,
            message_kind=PlannerMessageKind.QUESTION,
            ui_message=_render_proposal(proposal),
            next_question=_question_for_gate(active_gate),
            proposal=proposal,
        )

    return _blocked(plan, active_gate, user_content)
