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


def review_worktree(*, worktree_path: Path, base_ref: str) -> dict:
    worktree_path = worktree_path.expanduser().resolve()
    if not worktree_path.exists() or not worktree_path.is_dir():
        raise WorktreeError("worktree_missing")

    status = git_status(worktree_path)
    head = status["head_commit"]
    commit_count = int(_run_git(["rev-list", "--count", f"{base_ref}..HEAD"], cwd=worktree_path).stdout.strip() or "0")
    log = _run_git(["log", "--pretty=format:%H%x00%s", f"{base_ref}..HEAD"], cwd=worktree_path).stdout
    commits = []
    for line in log.splitlines():
        if not line.strip():
            continue
        sha, _, subject = line.partition("\x00")
        commits.append({"sha": sha, "short_sha": sha[:7], "subject": subject})

    name_status = _run_git(["diff", "--name-status", f"{base_ref}..HEAD"], cwd=worktree_path).stdout
    files = []
    for line in name_status.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            files.append({"status": parts[0], "path": parts[-1]})

    stat = _run_git(["diff", "--stat", f"{base_ref}..HEAD"], cwd=worktree_path).stdout
    shortstat = _run_git(["diff", "--shortstat", f"{base_ref}..HEAD"], cwd=worktree_path).stdout.strip()
    return {
        "base_ref": base_ref,
        "head_commit": head,
        "status": status["status"],
        "dirty_count": status["dirty_count"],
        "dirty_summary": status["dirty_summary"],
        "commit_count": commit_count,
        "commits": commits[:50],
        "files": files[:200],
        "stat": stat.strip(),
        "shortstat": shortstat,
        "ready_to_merge": status["dirty_count"] == 0 and commit_count > 0,
    }


def preflight_worktree_merge(*, worktree_path: Path, target_ref: str, source_ref: str) -> dict:
    worktree_path = worktree_path.expanduser().resolve()
    if not worktree_path.exists() or not worktree_path.is_dir():
        raise WorktreeError("worktree_missing")

    status = git_status(worktree_path)
    target_commit = ref_commit(worktree_path, target_ref)
    source_commit = ref_commit(worktree_path, source_ref)
    merge_base = _run_git(["merge-base", target_ref, source_ref], cwd=worktree_path).stdout.strip()
    commits_to_merge = int(_run_git(["rev-list", "--count", f"{target_ref}..{source_ref}"], cwd=worktree_path).stdout.strip() or "0")
    target_ahead_count = int(_run_git(["rev-list", "--count", f"{source_ref}..{target_ref}"], cwd=worktree_path).stdout.strip() or "0")
    files = _changed_files(worktree_path=worktree_path, base_ref=target_ref, head_ref=source_ref)
    result = _run_git_raw(["merge-tree", "--write-tree", "--messages", target_ref, source_ref], cwd=worktree_path, timeout=60)
    output = (result.stdout or result.stderr).strip()
    conflicts = _parse_merge_tree_conflicts(output)
    can_merge = result.returncode == 0 and status["dirty_count"] == 0 and commits_to_merge > 0
    return {
        "target_ref": target_ref,
        "source_ref": source_ref,
        "target_commit": target_commit,
        "source_commit": source_commit,
        "merge_base": merge_base,
        "status": status["status"],
        "dirty_count": status["dirty_count"],
        "dirty_summary": status["dirty_summary"],
        "commits_to_merge": commits_to_merge,
        "target_ahead_count": target_ahead_count,
        "files": files[:200],
        "can_merge": can_merge,
        "conflicts": conflicts[:100],
        "message": _preflight_message(can_merge=can_merge, status=status, commits_to_merge=commits_to_merge, conflicts=conflicts),
    }


def default_integration_worktree_path(repo_path: Path, branch_name: str) -> Path:
    root = repo_root(repo_path)
    return root.parent / ".nidavellir-worktrees" / "integrations" / slugify(branch_name).replace("/", "-")


def create_integration_worktree(
    *,
    repo_path: Path,
    worktree_path: Path,
    branch_name: str,
    target_ref: str,
    source_ref: str,
    message: str,
) -> dict:
    root = repo_root(repo_path)
    preflight = preflight_worktree_merge(worktree_path=root, target_ref=target_ref, source_ref=source_ref)
    if not preflight["can_merge"]:
        raise WorktreeError(preflight["message"])

    worktree_path = worktree_path.expanduser().resolve()
    if worktree_path.exists() and any(worktree_path.iterdir()):
        raise WorktreeError("worktree_path_not_empty")
    worktree_path.parent.mkdir(parents=True, exist_ok=True)
    base_commit = ref_commit(root, target_ref)
    _run_git(["worktree", "add", "-b", branch_name, str(worktree_path), target_ref], cwd=root, timeout=30)
    result = _run_git_raw(["merge", "--no-ff", source_ref, "-m", message.strip() or f"Merge {source_ref}"], cwd=worktree_path, timeout=60)
    status = git_status(worktree_path)
    if result.returncode != 0:
        return {
            "branch_name": branch_name,
            "worktree_path": str(worktree_path),
            "base_commit": base_commit,
            "head_commit": status["head_commit"],
            "status": status["status"],
            "dirty_count": status["dirty_count"],
            "dirty_summary": status["dirty_summary"],
            "merged": False,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    return {
        "branch_name": branch_name,
        "worktree_path": str(worktree_path),
        "base_commit": base_commit,
        "head_commit": status["head_commit"],
        "status": status["status"],
        "dirty_count": status["dirty_count"],
        "dirty_summary": status["dirty_summary"],
        "merged": True,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def _changed_files(*, worktree_path: Path, base_ref: str, head_ref: str) -> list[dict[str, str]]:
    name_status = _run_git(["diff", "--name-status", f"{base_ref}..{head_ref}"], cwd=worktree_path).stdout
    files = []
    for line in name_status.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            files.append({"status": parts[0], "path": parts[-1]})
    return files


def _parse_merge_tree_conflicts(output: str) -> list[dict[str, str]]:
    conflicts = []
    for line in output.splitlines():
        if not line.startswith("CONFLICT"):
            continue
        match = re.search(r" in (.+)$", line)
        conflicts.append({"path": match.group(1) if match else "", "message": line})
    return conflicts


def _preflight_message(*, can_merge: bool, status: dict, commits_to_merge: int, conflicts: list[dict[str, str]]) -> str:
    if can_merge:
        return "Merge preflight passed."
    if status["dirty_count"] > 0:
        return "Source worktree has uncommitted changes."
    if commits_to_merge == 0:
        return "No source commits to merge."
    if conflicts:
        return f"Merge preflight found {len(conflicts)} conflict files."
    return "Merge preflight failed."


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


def _run_git_raw(args: list[str], *, cwd: Path, timeout: int = 10) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
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
