from __future__ import annotations

from pathlib import Path

from .models import ProjectInstruction, ProjectInstructionDiscoveryResult

INSTRUCTION_FILENAMES = ("NIDAVELLIR.md", "AGENTS.md", "CLAUDE.md", "PROJECT.md")


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4) if text.strip() else 0


def _read_instruction(path: Path, *, scope: str) -> ProjectInstruction | None:
    try:
        content = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not content:
        return None
    return ProjectInstruction(
        name=path.name,
        path=str(path),
        content=content,
        scope=scope,
        token_estimate=_estimate_tokens(content),
        metadata={"directory": str(path.parent)},
    )


def _instruction_files_in_dir(directory: Path, *, scope: str) -> list[ProjectInstruction]:
    instructions: list[ProjectInstruction] = []
    for filename in INSTRUCTION_FILENAMES:
        path = directory / filename
        if path.is_file():
            instruction = _read_instruction(path, scope=scope)
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


def discover_project_instructions(
    *,
    cwd: str | Path,
    agent_dir: str | Path | None = None,
) -> ProjectInstructionDiscoveryResult:
    """Discover durable project guidance from global config and cwd ancestors.

    Discovery order is global first, then repository ancestors from root to cwd,
    so more specific instructions naturally appear after broader guidance.
    """
    instructions: list[ProjectInstruction] = []
    seen: set[str] = set()

    if agent_dir is not None:
        for instruction in _instruction_files_in_dir(Path(agent_dir).expanduser(), scope="global"):
            resolved = str(Path(instruction.path).resolve())
            if resolved not in seen:
                instructions.append(instruction)
                seen.add(resolved)

    for directory in _ancestor_dirs(Path(cwd).expanduser()):
        for instruction in _instruction_files_in_dir(directory, scope="project"):
            resolved = str(Path(instruction.path).resolve())
            if resolved not in seen:
                instructions.append(instruction)
                seen.add(resolved)

    return ProjectInstructionDiscoveryResult(
        instructions=instructions,
        rendered_text=_render(instructions),
        token_estimate=sum(item.token_estimate for item in instructions),
    )
