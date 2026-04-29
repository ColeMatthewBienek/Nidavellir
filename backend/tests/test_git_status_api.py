from __future__ import annotations

import shutil
import subprocess

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.main import app


pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git binary is required")


@pytest.mark.asyncio
async def test_git_status_returns_branch_and_dirty_files(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-b", "main"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=repo, check=True)
    tracked = repo / "tracked.txt"
    tracked.write_text("before\n", encoding="utf-8")
    subprocess.run(["git", "add", "tracked.txt"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=repo, check=True, capture_output=True)
    tracked.write_text("after\n", encoding="utf-8")
    (repo / "new.txt").write_text("new\n", encoding="utf-8")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/api/git/status", params={"path": str(repo)})

    assert response.status_code == 200
    body = response.json()
    assert body["isRepo"] is True
    assert body["branch"] == "main"
    assert body["dirtyCount"] == 2
    assert {"path": "tracked.txt", "status": "M"} in body["files"]
    assert {"path": "new.txt", "status": "??"} in body["files"]


@pytest.mark.asyncio
async def test_git_status_reports_non_repo_without_error(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/api/git/status", params={"path": str(workspace)})

    assert response.status_code == 200
    body = response.json()
    assert body["isRepo"] is False
    assert body["branch"] is None
    assert body["files"] == []
