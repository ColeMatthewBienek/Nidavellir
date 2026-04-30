from __future__ import annotations

import fnmatch
import re
from pathlib import Path

from nidavellir.workspace import effective_default_working_directory

from .policy import PermissionDecision, PermissionEvaluationRequest, PermissionEvaluationResult


PROTECTED_PATH_PATTERNS = (
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_ed25519",
    "node_modules/*",
    ".venv/*",
    ".git/*",
    "dist/*",
    "build/*",
)

RISKY_COMMAND_PATTERNS = (
    r"\brm\s+-rf\b",
    r"\bsudo\b",
    r"\bchmod\b",
    r"\bchown\b",
    r"\bcurl\b.*\|\s*(?:sh|bash)",
    r"\bwget\b.*\|\s*(?:sh|bash)",
)

CAPABILITY_ACTIONS = {
    "shell": "shell_command",
    "file_write": "file_write",
    "code_execution": "shell_command",
    "network": "network_request",
}


def _windows_to_wsl_path(value: str) -> str | None:
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", value)
    if not match:
        return None
    drive = match.group(1).lower()
    rest = match.group(2).replace("\\", "/")
    return f"/mnt/{drive}/{rest}"


def normalize_permission_path(path_value: str, *, workspace: str | None = None) -> Path:
    raw = path_value.strip().strip("'\"")
    wsl_path = _windows_to_wsl_path(raw)
    candidate = Path(wsl_path or raw).expanduser()
    if not candidate.is_absolute():
        base = Path(workspace or effective_default_working_directory()).expanduser()
        candidate = base / candidate
    return candidate.resolve(strict=False)


def _is_relative_to(path: Path, base: Path) -> bool:
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


def protected_path_match(path: Path) -> str | None:
    parts = path.parts
    name = path.name
    for pattern in PROTECTED_PATH_PATTERNS:
        if pattern.endswith("/*"):
            directory = pattern[:-2]
            if directory in parts:
                return pattern
            continue
        if fnmatch.fnmatch(name, pattern):
            return pattern
    return None


def risky_command_match(command: str) -> str | None:
    for pattern in RISKY_COMMAND_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return pattern
    return None


class PermissionEvaluator:
    """Default platform permission policy.

    This first slice is intentionally stateless: it returns deny/ask/allow from
    built-in safety rules. Durable user grants can be layered on top without
    changing call sites.
    """

    def evaluate(self, request: PermissionEvaluationRequest) -> PermissionEvaluationResult:
        normalized_path: Path | None = None
        protected_rule = None
        outside_workspace = False
        workspace_path = Path(request.workspace or effective_default_working_directory()).expanduser().resolve(strict=False)

        if request.path:
            normalized_path = normalize_permission_path(request.path, workspace=str(workspace_path))
            protected_rule = protected_path_match(normalized_path)
            outside_workspace = not _is_relative_to(normalized_path, workspace_path)

        if request.action == "skill_enable":
            risky = self._risky_skill_capabilities(request.metadata)
            if risky:
                return self._ask(request, normalized_path, f"skill requires {', '.join(risky)}", "risky_skill_capability")
            return self._allow(request, normalized_path, "skill has no risky capability requirements")

        if request.action == "shell_command":
            command = request.command or ""
            matched = risky_command_match(command)
            if matched:
                return self._ask(request, normalized_path, "shell command matches risky command policy", matched)
            return self._allow(request, normalized_path, "shell command allowed by default policy")

        if request.action in {"file_write", "file_delete", "write_outside_workspace"}:
            if outside_workspace:
                return self._ask(request, normalized_path, "path is outside the active workspace", "outside_workspace")
            if protected_rule:
                return self._ask(request, normalized_path, "path matches protected path policy", protected_rule)
            return self._allow(request, normalized_path, "path allowed by default policy")

        if request.action == "package_import":
            if outside_workspace and request.actor != "user":
                return self._ask(request, normalized_path, "import path is outside the active workspace", "outside_workspace")
            if protected_rule:
                return self._ask(request, normalized_path, "import path matches protected path policy", protected_rule)
            return self._allow(request, normalized_path, "package import allowed by default policy")

        if request.action in {"extension_enable", "network_request"}:
            return self._ask(request, normalized_path, f"{request.action} requires explicit approval", request.action)

        if request.action == "file_read" and request.actor == "agent":
            if outside_workspace:
                return self._ask(request, normalized_path, "agent file read is outside the active workspace", "outside_workspace")
            if protected_rule:
                return self._ask(request, normalized_path, "agent file read matches protected path policy", protected_rule)

        return self._allow(request, normalized_path, "allowed by default policy")

    def _risky_skill_capabilities(self, metadata: dict) -> list[str]:
        capabilities = metadata.get("required_capabilities") or {}
        if not isinstance(capabilities, dict):
            return []
        return [name for name in CAPABILITY_ACTIONS if bool(capabilities.get(name))]

    def _allow(self, request: PermissionEvaluationRequest, path: Path | None, reason: str) -> PermissionEvaluationResult:
        return self._result(request, path, PermissionDecision.ALLOW, reason, None)

    def _ask(self, request: PermissionEvaluationRequest, path: Path | None, reason: str, rule: str) -> PermissionEvaluationResult:
        return self._result(request, path, PermissionDecision.ASK, reason, rule)

    def _result(
        self,
        request: PermissionEvaluationRequest,
        path: Path | None,
        decision: PermissionDecision,
        reason: str,
        matched_rule: str | None,
    ) -> PermissionEvaluationResult:
        protected = bool(path and protected_path_match(path))
        outside_workspace = False
        if path:
            workspace = Path(request.workspace or effective_default_working_directory()).expanduser().resolve(strict=False)
            outside_workspace = not _is_relative_to(path, workspace)
        return PermissionEvaluationResult(
            action=request.action,
            decision=decision,
            reason=reason,
            path=request.path,
            normalized_path=str(path) if path else None,
            protected=protected,
            outside_workspace=outside_workspace,
            matched_rule=matched_rule,
            requires_user_choice=decision == PermissionDecision.ASK,
        )
