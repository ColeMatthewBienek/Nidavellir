from __future__ import annotations

import re
import subprocess
from pathlib import Path


class WorktreeError(ValueError):
    pass


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._/-]+", "-", value.strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-/")
    return slug or "work"


def default_worktree_path(repo_path: Path, branch_name: str) -> Path:
    root = repo_root(repo_path)
    return root.parent / ".nidavellir-worktrees" / slugify(branch_name).replace("/", "-")


def repo_root(path: Path) -> Path:
    result = _run_git(["rev-parse", "--show-toplevel"], cwd=path)
    return Path(result.stdout.strip()).resolve()


def current_branch(path: Path) -> str:
    result = _run_git(["branch", "--show-current"], cwd=path)
    return result.stdout.strip() or "HEAD"


def head_commit(path: Path) -> str:
    result = _run_git(["rev-parse", "HEAD"], cwd=path)
    return result.stdout.strip()


def ref_commit(path: Path, ref: str) -> str:
    result = _run_git(["rev-parse", ref], cwd=path)
    return result.stdout.strip()


def create_git_worktree(*, repo_path: Path, worktree_path: Path, branch_name: str, base_ref: str) -> dict:
    root = repo_root(repo_path)
    base_commit = ref_commit(root, base_ref)
    worktree_path = worktree_path.expanduser().resolve()
    if worktree_path.exists() and any(worktree_path.iterdir()):
        raise WorktreeError("worktree_path_not_empty")
    worktree_path.parent.mkdir(parents=True, exist_ok=True)
    _run_git(["worktree", "add", "-b", branch_name, str(worktree_path), base_ref], cwd=root, timeout=30)
    status = git_status(worktree_path)
    return {
        "repo_path": str(root),
        "worktree_path": str(worktree_path),
        "base_commit": base_commit,
        "head_commit": status["head_commit"],
        "status": status["status"],
        "dirty_count": status["dirty_count"],
        "dirty_summary": status["dirty_summary"],
    }


def remove_git_worktree(*, repo_path: Path, worktree_path: Path) -> None:
    if not worktree_path.exists():
        return
    _run_git(["worktree", "remove", str(worktree_path)], cwd=repo_root(repo_path), timeout=30)


def git_status(worktree_path: Path) -> dict:
    worktree_path = worktree_path.expanduser().resolve()
    if not worktree_path.exists():
        return {
            "status": "missing",
            "head_commit": None,
            "dirty_count": 0,
            "dirty_summary": [],
        }
    result = _run_git(["status", "--short", "--branch"], cwd=worktree_path)
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    files = [_parse_status_line(line) for line in lines[1:]]
    dirty_summary = [item for item in files if item is not None]
    return {
        "status": "dirty" if dirty_summary else "clean",
        "head_commit": head_commit(worktree_path),
        "dirty_count": len(dirty_summary),
        "dirty_summary": dirty_summary[:100],
    }


def checkpoint_worktree(*, worktree_path: Path, message: str) -> dict:
    worktree_path = worktree_path.expanduser().resolve()
    if not worktree_path.exists() or not worktree_path.is_dir():
        raise WorktreeError("worktree_missing")

    status = git_status(worktree_path)
    if status["dirty_count"] == 0:
        raise WorktreeError("worktree_clean")

    _run_git(["add", "-A"], cwd=worktree_path, timeout=30)
    result = _run_git(["commit", "-m", message.strip() or "Checkpoint orchestration worktree"], cwd=worktree_path, timeout=60)
    updated = git_status(worktree_path)
    return {
        "commit": updated["head_commit"],
        "message": message.strip() or "Checkpoint orchestration worktree",
        "stdout": result.stdout,
        "stderr": result.stderr,
        "status": updated,
    }


def _parse_status_line(line: str) -> dict[str, str] | None:
    if len(line) < 4:
        return None
    status = line[:2].strip() or line[:2]
    path = line[3:].strip()
    if " -> " in path:
        path = path.split(" -> ", 1)[1]
    if not path:
        return None
    return {"path": path, "status": status}


def _run_git(args: list[str], *, cwd: Path, timeout: int = 10) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise WorktreeError("git_timeout") from exc
    except FileNotFoundError as exc:
        raise WorktreeError("git_not_available") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "git_failed").strip().splitlines()[-1]
        raise WorktreeError(detail[:240])
    return result
