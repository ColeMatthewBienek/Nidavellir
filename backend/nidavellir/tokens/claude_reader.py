"""Read Claude CLI usage from ~/.claude/projects/*/*.jsonl after each turn."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path


def _claude_projects_root() -> Path:
    return Path.home() / ".claude" / "projects"


def _cwd_to_project_key(cwd: str | Path) -> str:
    """Convert absolute path to Claude's project directory name convention."""
    p = str(Path(cwd).resolve())
    return p.replace("/", "-").replace("\\", "-").lstrip("-")


async def read_latest_claude_usage(
    cwd: str | Path | None = None,
    max_age_seconds: float = 15.0,
) -> dict | None:
    """Return the most recently written Claude JSONL entry with usage data.

    Searches project-specific directory if cwd is given, else all projects.
    Returns None if nothing found within max_age_seconds.
    """
    root = _claude_projects_root()
    if not root.exists():
        return None

    if cwd is not None:
        key = _cwd_to_project_key(cwd)
        search_dirs = [d for d in root.iterdir() if d.is_dir() and key in d.name]
        if not search_dirs:
            # Fallback: search all
            search_dirs = [d for d in root.iterdir() if d.is_dir()]
    else:
        search_dirs = [d for d in root.iterdir() if d.is_dir()]

    import time
    cutoff = time.time() - max_age_seconds

    best: dict | None = None
    best_mtime: float = 0.0

    for d in search_dirs:
        for jf in d.glob("*.jsonl"):
            try:
                mtime = jf.stat().st_mtime
                if mtime < cutoff:
                    continue
                # Read last non-empty line that has usage
                with open(jf, "r", errors="replace") as f:
                    lines = f.readlines()
                for line in reversed(lines):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        msg = entry.get("message", {}) or {}
                        if "usage" in msg and mtime > best_mtime:
                            best = entry
                            best_mtime = mtime
                            break
                    except json.JSONDecodeError:
                        continue
            except OSError:
                continue

    return best
