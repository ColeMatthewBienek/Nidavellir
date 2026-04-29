from __future__ import annotations

import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query


router = APIRouter(prefix="/api/git", tags=["git"])


def _run_git_status(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "status", "--short", "--branch"],
        cwd=path,
        text=True,
        capture_output=True,
        timeout=5,
    )


def _parse_branch(line: str) -> str | None:
    if not line.startswith("## "):
        return None
    branch = line[3:].split("...", 1)[0].strip()
    return branch or None


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


@router.get("/status")
async def git_status(path: str = Query(..., min_length=1)):
    workspace = Path(path).expanduser().resolve()
    if not workspace.exists():
        raise HTTPException(status_code=400, detail="directory_not_found")
    if not workspace.is_dir():
        raise HTTPException(status_code=400, detail="not_a_directory")

    try:
        result = _run_git_status(workspace)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="git_status_timeout") from exc

    if result.returncode != 0:
        stderr = result.stderr.lower()
        if "not a git repository" in stderr:
            return {
                "isRepo": False,
                "branch": None,
                "dirtyCount": 0,
                "files": [],
            }
        raise HTTPException(status_code=500, detail="git_status_failed")

    lines = [line for line in result.stdout.splitlines() if line.strip()]
    branch = _parse_branch(lines[0]) if lines else None
    files = [
        parsed
        for line in lines[1:]
        if (parsed := _parse_status_line(line)) is not None
    ]

    return {
        "isRepo": True,
        "branch": branch,
        "dirtyCount": len(files),
        "files": files,
    }
