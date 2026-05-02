from __future__ import annotations

import os
import re
from hashlib import sha256
from pathlib import Path

from .models import ProjectInstruction, ProjectInstructionDiscoveryResult, ProjectInstructionSuppression

INSTRUCTION_FILENAMES = ("NIDAVELLIR.md", "AGENTS.md", "CLAUDE.md", "PROJECT.md")
GENERIC_LAYER_ORDER = {
    "PROJECT.md": 10,
    "NIDAVELLIR.md": 20,
    "AGENTS.md": 30,
    "CLAUDE.md": 30,
}
PROVIDER_FILES = {
    "codex": "AGENTS.md",
    "claude": "CLAUDE.md",
    "anthropic": "CLAUDE.md",
}
GLOBAL_PROVIDER_PATHS = {
    "AGENTS.md": ("CODEX_HOME", ".codex"),
    "CLAUDE.md": ("CLAUDE_CONFIG_DIR", ".claude"),
}


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4) if text.strip() else 0


def _instruction_role(filename: str, provider: str | None) -> str:
    expected = PROVIDER_FILES.get((provider or "").lower())
    if expected == filename:
        return "provider_specific"
    if filename in PROVIDER_FILES.values():
        return "provider_specific"
    if filename == "NIDAVELLIR.md":
        return "nidavellir"
    return "project"


def _normalize_content(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    lines = normalized.splitlines()
    if lines and re.match(r"^#\s+(?:NIDAVELLIR|PROJECT|AGENTS|CLAUDE)(?:\.md)?\s*$", lines[0].strip(), re.I):
        lines = lines[1:]
    return "\n".join(lines).strip()


def _content_hash(text: str) -> str:
    return sha256(_normalize_content(text).encode("utf-8")).hexdigest()


def _read_instruction(path: Path, *, scope: str, dir_index: int = 0, provider: str | None = None) -> ProjectInstruction | None:
    try:
        content = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not content:
        return None
    role = _instruction_role(path.name, provider)
    return ProjectInstruction(
        name=path.name,
        path=str(path),
        content=content,
        scope=scope,
        token_estimate=_estimate_tokens(content),
        metadata={
            "directory": str(path.parent),
            "dir_index": dir_index,
            "layer_order": GENERIC_LAYER_ORDER.get(path.name, 50),
            "role": role,
            "content_hash": _content_hash(content),
            "origin": scope,
        },
    )


def _instruction_files_in_dir(directory: Path, *, scope: str, dir_index: int = 0, provider: str | None = None) -> list[ProjectInstruction]:
    instructions: list[ProjectInstruction] = []
    for filename in INSTRUCTION_FILENAMES:
        path = directory / filename
        if path.is_file():
            instruction = _read_instruction(path, scope=scope, dir_index=dir_index, provider=provider)
            if instruction is not None:
                instructions.append(instruction)
    return instructions


def _ancestor_dirs(cwd: Path) -> list[Path]:
    resolved = cwd.resolve()
    if not resolved.is_dir():
        resolved = resolved.parent
    return list(reversed([resolved, *resolved.parents]))


def _render(instructions: list[ProjectInstruction]) -> str:
    parts: list[str] = []
    for instruction in instructions:
        parts.append(f"### {instruction.name}\nSource: {instruction.path}\n\n{instruction.content}")
    return "\n\n".join(parts).strip()


def _provider_filename(provider: str | None) -> str | None:
    return PROVIDER_FILES.get((provider or "").lower())


def _user_profile_path() -> Path | None:
    value = os.environ.get("USERPROFILE")
    if value:
        return Path(value).expanduser()
    return None


def _first_existing_or_default(paths: list[Path]) -> Path:
    for path in paths:
        if path.exists():
            return path
    return paths[0]


def default_global_instruction_files() -> dict[str, Path]:
    """Return provider-native machine-wide instruction files.

    Codex and Claude resolve their own global instruction files outside the
    project root. Nidavellir surfaces those files explicitly instead of
    pretending project-local AGENTS.md/CLAUDE.md are the only provider slots.
    """
    home = Path.home()
    user_profile = _user_profile_path()
    files: dict[str, Path] = {}

    codex_home = Path(os.environ["CODEX_HOME"]).expanduser() if os.environ.get("CODEX_HOME") else None
    codex_candidates = [path for path in [
        codex_home / "AGENTS.md" if codex_home else None,
        home / ".codex" / "AGENTS.md",
        user_profile / ".codex" / "AGENTS.md" if user_profile else None,
    ] if path is not None]
    files["AGENTS.md"] = _first_existing_or_default(codex_candidates)

    claude_config = Path(os.environ["CLAUDE_CONFIG_DIR"]).expanduser() if os.environ.get("CLAUDE_CONFIG_DIR") else None
    claude_candidates = [path for path in [
        claude_config / "CLAUDE.md" if claude_config else None,
        home / ".claude" / "CLAUDE.md",
        user_profile / ".claude" / "CLAUDE.md" if user_profile else None,
    ] if path is not None]
    files["CLAUDE.md"] = _first_existing_or_default(claude_candidates)

    return files


def read_global_instruction_file(filename: str, *, provider: str | None = None) -> ProjectInstruction | None:
    path = default_global_instruction_files().get(filename)
    if path is None:
        return None
    return _read_instruction(path, scope="global", dir_index=-1, provider=provider)


def _role_priority(instruction: ProjectInstruction) -> int:
    role = instruction.metadata.get("role")
    if role == "provider_specific":
        return 30
    if role == "nidavellir":
        return 20
    return 10


def _sort_key(instruction: ProjectInstruction) -> tuple[int, int, str]:
    return (
        int(instruction.metadata.get("dir_index", 0)),
        int(instruction.metadata.get("layer_order", 50)),
        instruction.name,
    )


def _apply_provider_filter_and_dedupe(
    instructions: list[ProjectInstruction],
    *,
    provider: str | None,
) -> tuple[list[ProjectInstruction], list[ProjectInstructionSuppression]]:
    if provider is None:
        return instructions, []

    expected_provider_file = _provider_filename(provider)
    suppressed: list[ProjectInstructionSuppression] = []
    eligible: list[ProjectInstruction] = []

    for instruction in instructions:
        if instruction.name in PROVIDER_FILES.values() and instruction.name != expected_provider_file:
            suppressed.append(ProjectInstructionSuppression(
                name=instruction.name,
                path=instruction.path,
                scope=instruction.scope,
                reason="provider_mismatch",
                metadata={
                    "provider": provider,
                    "active_provider_file": expected_provider_file,
                    **instruction.metadata,
                },
            ))
            continue
        eligible.append(instruction)

    winners_by_hash: dict[str, ProjectInstruction] = {}
    for instruction in eligible:
        content_hash = str(instruction.metadata.get("content_hash") or "")
        current = winners_by_hash.get(content_hash)
        if current is None:
            winners_by_hash[content_hash] = instruction
            continue
        candidate_score = (_role_priority(instruction), int(instruction.metadata.get("dir_index", 0)))
        current_score = (_role_priority(current), int(current.metadata.get("dir_index", 0)))
        if candidate_score > current_score:
            winners_by_hash[content_hash] = instruction

    active_paths = {winner.path for winner in winners_by_hash.values()}
    for instruction in eligible:
        if instruction.path in active_paths:
            continue
        content_hash = str(instruction.metadata.get("content_hash") or "")
        winner = winners_by_hash[content_hash]
        suppressed.append(ProjectInstructionSuppression(
            name=instruction.name,
            path=instruction.path,
            scope=instruction.scope,
            reason="duplicate_content",
            duplicate_of=winner.path,
            metadata=instruction.metadata,
        ))

    active = sorted(winners_by_hash.values(), key=_sort_key)
    return active, suppressed


def discover_project_instructions(
    *,
    cwd: str | Path,
    agent_dir: str | Path | None = None,
    provider: str | None = None,
    global_instruction_files: dict[str, str | Path] | None = None,
) -> ProjectInstructionDiscoveryResult:
    """Discover durable project guidance from global config and cwd ancestors.

    Discovery order is global first, then repository ancestors from root to cwd,
    so more specific instructions naturally appear after broader guidance.
    """
    instructions: list[ProjectInstruction] = []
    seen: set[str] = set()

    if agent_dir is not None:
        for instruction in _instruction_files_in_dir(Path(agent_dir).expanduser(), scope="global", dir_index=-1, provider=provider):
            resolved = str(Path(instruction.path).resolve())
            if resolved not in seen:
                instructions.append(instruction)
                seen.add(resolved)

    if global_instruction_files is not None:
        for filename in ("AGENTS.md", "CLAUDE.md"):
            path = global_instruction_files.get(filename)
            if path is None:
                continue
            instruction = _read_instruction(Path(path).expanduser(), scope="global", dir_index=-1, provider=provider)
            if instruction is None:
                continue
            resolved = str(Path(instruction.path).resolve())
            if resolved not in seen:
                instructions.append(instruction)
                seen.add(resolved)

    for index, directory in enumerate(_ancestor_dirs(Path(cwd).expanduser())):
        for instruction in _instruction_files_in_dir(directory, scope="project", dir_index=index, provider=provider):
            resolved = str(Path(instruction.path).resolve())
            if resolved not in seen:
                instructions.append(instruction)
                seen.add(resolved)

    active, suppressed = _apply_provider_filter_and_dedupe(instructions, provider=provider)

    return ProjectInstructionDiscoveryResult(
        instructions=active,
        discovered=instructions,
        suppressed=suppressed,
        rendered_text=_render(active),
        token_estimate=sum(item.token_estimate for item in active),
        provider=provider,
    )
