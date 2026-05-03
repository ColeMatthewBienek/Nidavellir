from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.tokens.store import TokenUsageStore


def _setup(tmp_path):
    app.state.memory_store = MemoryStore(str(tmp_path / "memory.db"))
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    if hasattr(app.state, "agent_running"):
        delattr(app.state, "agent_running")
    return app.state.memory_store


def test_normalize_windows_wsl_and_relative_workspace_paths(tmp_path):
    from nidavellir.workspace import normalize_working_directory

    root = tmp_path / "repo"
    child = root / "child"
    child.mkdir(parents=True)

    resolved = normalize_working_directory("child", base_dir=root)
    assert resolved.path == str(child.resolve())
    assert resolved.display == str(child.resolve())
    assert resolved.exists is True
    assert resolved.is_directory is True

    windows = normalize_working_directory(r"C:\Users\colebienek\projects\nidavellir")
    assert windows.path == "/mnt/c/Users/colebienek/projects/nidavellir"
    assert windows.display == r"C:\Users\colebienek\projects\nidavellir"

    quoted = normalize_working_directory(f'"{child}"')
    assert quoted.path == str(child.resolve())


def test_child_session_inherits_parent_working_directory(tmp_path):
    from nidavellir.sessions.continuity import switch_session

    store = _setup(tmp_path)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    store.create_conversation("parent")
    store.update_conversation("parent", {
        "working_directory": str(workspace.resolve()),
        "working_directory_display": "Friendly workspace",
    })

    child_id = switch_session(
        store,
        "parent",
        new_provider="codex",
        new_model="gpt-5.4",
        mode="start_clean",
    )

    child = store.get_conversation(child_id)
    assert child["working_directory"] == str(workspace.resolve())
    assert child["working_directory_display"] == "Friendly workspace"


def test_working_set_relative_paths_resolve_against_conversation_workspace(tmp_path):
    store = _setup(tmp_path)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    src = workspace / "notes.md"
    src.write_text("workspace relative file", encoding="utf-8")
    store.create_conversation("conv-cwd")
    store.update_conversation("conv-cwd", {
        "working_directory": str(workspace.resolve()),
        "working_directory_display": str(workspace.resolve()),
    })

    result = store.add_conversation_files(
        "conv-cwd",
        ["notes.md"],
        provider="claude",
        model="claude-sonnet-4-6",
    )

    assert result["skipped"] == []
    assert result["added"][0]["original_path"] == str(src.resolve())


@pytest.mark.asyncio
async def test_set_conversation_working_directory_persists_execution_and_display_paths(tmp_path):
    store = _setup(tmp_path)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    store.create_conversation("conv-cwd")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/api/conversations/conv-cwd/workspace",
            json={"path": str(workspace)},
        )
        detail = await c.get("/api/conversations/conv-cwd")

    assert r.status_code == 200
    body = r.json()
    assert body["workingDirectory"] == str(workspace.resolve())
    assert body["workingDirectoryDisplay"] == str(workspace.resolve())
    assert body["writable"] is True
    assert body["warning"] is None

    conv = store.get_conversation("conv-cwd")
    assert conv["working_directory"] == str(workspace.resolve())
    assert conv["working_directory_display"] == str(workspace.resolve())
    assert detail.json()["workingDirectory"] == str(workspace.resolve())


@pytest.mark.asyncio
async def test_get_conversation_without_saved_workspace_returns_effective_default(tmp_path, monkeypatch):
    import nidavellir.workspace as workspace_mod

    default_dir = tmp_path / "default-workspace"
    default_dir.mkdir()
    monkeypatch.setattr(workspace_mod, "DEFAULT_WORKDIR", default_dir)
    store = _setup(tmp_path)
    store.create_conversation("conv-default")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        detail = await c.get("/api/conversations/conv-default")

    assert detail.status_code == 200
    body = detail.json()
    assert body["workingDirectory"] == str(default_dir.resolve())
    assert body["workingDirectoryDisplay"] == str(default_dir.resolve())


@pytest.mark.asyncio
async def test_set_conversation_working_directory_rejects_missing_and_file_paths(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-cwd")
    file_path = tmp_path / "file.txt"
    file_path.write_text("not a directory")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        missing = await c.post("/api/conversations/conv-cwd/workspace", json={"path": str(tmp_path / "missing")})
        file_resp = await c.post("/api/conversations/conv-cwd/workspace", json={"path": str(file_path)})

    assert missing.status_code == 400
    assert missing.json()["detail"] == "directory_not_found"
    assert file_resp.status_code == 400
    assert file_resp.json()["detail"] == "not_a_directory"


@pytest.mark.asyncio
async def test_set_conversation_working_directory_rejects_while_agent_running(tmp_path):
    store = _setup(tmp_path)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    store.create_conversation("conv-cwd")
    app.state.agent_running = True

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/conversations/conv-cwd/workspace", json={"path": str(workspace)})

    assert r.status_code == 409
    assert r.json()["detail"] == "agent_running"


@pytest.mark.asyncio
async def test_agent_turn_uses_conversation_working_directory(tmp_path, monkeypatch):
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router

    store = _setup(tmp_path)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    store.create_conversation("conv-cwd")
    store.update_conversation("conv-cwd", {
        "working_directory": str(workspace.resolve()),
        "working_directory_display": str(workspace.resolve()),
    })
    seen = {}

    class FakeAgent:
        async def start(self): pass
        async def send(self, text: str): pass
        async def stream(self):
            yield "done"
        async def kill(self): pass
        def get_usage(self): return None

    def fake_make_agent(provider_id, slot_id, workdir, model_id=None, dangerousness=None):
        seen["workdir"] = Path(workdir)
        return FakeAgent()

    monkeypatch.setattr(reg, "make_agent", fake_make_agent)
    async def noop_extract(*args, **kwargs):
        return None

    monkeypatch.setattr(ws_router, "_extract_and_store", noop_extract)

    class FakeWS:
        async def send_json(self, data): pass
        @property
        def app(self): return app

    await ws_router.handle_message_with_identity(
        ws=FakeWS(),
        content="Run in workspace.",
        conversation_id="conv-cwd",
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        workflow="chat",
        store=store,
        token_store=None,
    )

    assert seen["workdir"] == workspace.resolve()


@pytest.mark.asyncio
async def test_agent_turn_falls_back_to_server_default_workspace_for_legacy_conversation(tmp_path, monkeypatch):
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router

    store = _setup(tmp_path)
    workspace = tmp_path / "repo"
    workspace.mkdir()
    (workspace / "pyproject.toml").write_text("[project]\nname='demo'\n", encoding="utf-8")
    monkeypatch.setattr(ws_router, "WORKDIR", workspace.resolve())
    store.create_conversation("conv-legacy")
    seen = {}

    class FakeAgent:
        async def start(self): pass
        async def send(self, text: str): pass
        async def stream(self):
            yield "done"
        async def kill(self): pass
        def get_usage(self): return None

    def fake_make_agent(provider_id, slot_id, workdir, model_id=None, dangerousness=None):
        seen["workdir"] = Path(workdir)
        return FakeAgent()

    monkeypatch.setattr(reg, "make_agent", fake_make_agent)
    async def noop_extract(*args, **kwargs):
        return None

    monkeypatch.setattr(ws_router, "_extract_and_store", noop_extract)

    class FakeWS:
        def __init__(self):
            self.sent_json = []
        async def send_json(self, data):
            self.sent_json.append(data)
        @property
        def app(self): return app

    fake_ws = FakeWS()
    await ws_router.handle_message_with_identity(
        ws=fake_ws,
        content="Run in default workspace.",
        conversation_id="conv-legacy",
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        workflow="chat",
        store=store,
        token_store=None,
    )

    assert seen["workdir"] == workspace.resolve()
    start_events = [m for m in fake_ws.sent_json if m.get("type") == "activity"]
    assert any(str(workspace.resolve()) in e["event"]["content"] for e in start_events)


def test_preflight_rejects_missing_unwritable_file_and_implicit_empty_scratch(tmp_path, monkeypatch):
    from nidavellir.routers.ws import _preflight_agent_workdir

    missing = tmp_path / "missing"
    with pytest.raises(RuntimeError, match="working_directory_not_found"):
        _preflight_agent_workdir(missing, explicit=True)

    file_path = tmp_path / "file.txt"
    file_path.write_text("x", encoding="utf-8")
    with pytest.raises(RuntimeError, match="working_directory_not_a_directory"):
        _preflight_agent_workdir(file_path, explicit=True)

    scratch = tmp_path / "workspace"
    scratch.mkdir()
    with pytest.raises(RuntimeError, match="working_directory_empty_scratch"):
        _preflight_agent_workdir(scratch, explicit=False)

    _preflight_agent_workdir(scratch, explicit=True)


def test_session_ready_includes_server_authoritative_workspace():
    from nidavellir.routers.ws import _build_session_ready

    payload = _build_session_ready(
        provider_id="codex",
        model_id="gpt-5.5",
        conversation_id="conv",
        working_directory="/repo",
        working_directory_display="C:\\repo",
    )

    assert payload["working_directory"] == "/repo"
    assert payload["working_directory_display"] == "C:\\repo"
