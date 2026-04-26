from __future__ import annotations

import asyncio
import hashlib
import subprocess
from pathlib import Path


async def get_repo_identity(workdir: str | Path) -> dict:
    """Return a dict with repo_id, repo_name, repo_root, repo_remote_url for the given path.
    All fields may be None if the path is not a git repo."""
    path = Path(workdir)

    def _run(cmd: list[str]) -> str:
        try:
            result = subprocess.run(
                cmd, cwd=path, capture_output=True, text=True, timeout=5
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except Exception:
            return ""

    loop = asyncio.get_running_loop()
    root       = await loop.run_in_executor(None, _run, ["git", "rev-parse", "--show-toplevel"])
    remote_url = await loop.run_in_executor(None, _run, ["git", "remote", "get-url", "origin"])

    if not root:
        return {"repo_id": None, "repo_name": None, "repo_root": None, "repo_remote_url": None}

    repo_name = Path(root).name
    key       = remote_url or root
    repo_id   = hashlib.sha1(key.encode()).hexdigest()[:16]

    return {
        "repo_id":         repo_id,
        "repo_name":       repo_name,
        "repo_root":       root,
        "repo_remote_url": remote_url or None,
    }
