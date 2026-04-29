from __future__ import annotations

import sqlite3
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.tokens.store import TokenUsageStore


def _setup(tmp_path):
    app.state.memory_store = MemoryStore(str(tmp_path / "memory.db"))
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    return app.state.memory_store


@pytest.mark.asyncio
async def test_post_conversations_creates_conversation_and_initial_session(tmp_path, monkeypatch):
    import nidavellir.routers.conversations as conversations_router
    import nidavellir.workspace as workspace_mod

    default_dir = tmp_path / "repo"
    default_dir.mkdir()
    monkeypatch.setattr(workspace_mod, "DEFAULT_WORKDIR", default_dir)
    monkeypatch.setattr(
        conversations_router,
        "effective_default_working_directory",
        workspace_mod.effective_default_working_directory,
    )
    _setup(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/conversations", json={
            "title": "Planning",
            "provider": "claude",
            "model": "claude-sonnet-4-6",
        })

    assert r.status_code == 200
    body = r.json()
    assert body["conversationId"]
    assert body["sessionId"]
    assert body["title"] == "Planning"
    conv = app.state.memory_store.get_conversation(body["conversationId"])
    assert conv["active_session_id"] == body["sessionId"]
    assert conv["active_provider"] == "claude"
    assert conv["active_model"] == "claude-sonnet-4-6"
    assert conv["working_directory"] == str(default_dir.resolve())
    assert conv["working_directory_display"] == str(default_dir.resolve())
    assert body["workingDirectory"] == str(default_dir.resolve())


@pytest.mark.asyncio
async def test_get_conversations_lists_sorted_with_message_counts(tmp_path):
    store = _setup(tmp_path)
    older = store.create_conversation("older", title="Older", provider_id="claude", model_id="m1")
    newer = store.create_conversation("newer", title="Newer", provider_id="codex", model_id="m2")
    store.append_message("older", str(uuid.uuid4()), "user", "old msg")
    store.append_message("newer", str(uuid.uuid4()), "user", "new msg")
    store.append_message("newer", str(uuid.uuid4()), "agent", "reply")
    with store._conn() as conn:
      conn.execute("UPDATE conversations SET updated_at = '2024-01-01 00:00:00' WHERE id = ?", (older["id"],))
      conn.execute("UPDATE conversations SET updated_at = '2024-01-02 00:00:00' WHERE id = ?", (newer["id"],))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/conversations")

    assert r.status_code == 200
    body = r.json()
    assert [item["id"] for item in body[:2]] == ["newer", "older"]
    assert body[0]["messageCount"] == 2
    assert body[0]["activeProvider"] == "codex"
    assert body[0]["activeModel"] == "m2"


@pytest.mark.asyncio
async def test_get_conversation_returns_messages_for_selected_conversation(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-1", title="Saved chat")
    store.append_message("conv-1", "m1", "user", "Write a happy story.")
    store.append_message("conv-1", "m2", "agent", "Once there was a lighthouse.")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/conversations/conv-1")

    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "conv-1"
    assert body["title"] == "Saved chat"
    assert [m["content"] for m in body["messages"]] == [
        "Write a happy story.",
        "Once there was a lighthouse.",
    ]


@pytest.mark.asyncio
async def test_get_unknown_conversation_returns_404(tmp_path):
    _setup(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/conversations/missing")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_archive_conversation_hides_it_without_deleting_messages(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-archive", title="Archive me")
    store.append_message("conv-archive", "m1", "user", "Keep this")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/conversations/conv-archive/archive")
        listed = await c.get("/api/conversations")

    assert r.status_code == 200
    assert "conv-archive" not in [item["id"] for item in listed.json()]
    assert store.get_conversation_messages("conv-archive")[0]["content"] == "Keep this"


def test_conversation_migration_adds_active_session_columns_without_data_loss(tmp_path):
    db = tmp_path / "legacy.db"
    conn = sqlite3.connect(db)
    conn.execute("""
        CREATE TABLE conversations (
            id TEXT PRIMARY KEY,
            workflow TEXT NOT NULL DEFAULT 'chat',
            model_id TEXT,
            provider_id TEXT,
            title TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            archived INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.execute("INSERT INTO conversations (id, title) VALUES ('legacy', 'Legacy')")
    conn.commit()
    conn.close()

    store = MemoryStore(str(db))
    conv = store.get_conversation("legacy")
    assert conv["title"] == "Legacy"
    assert "active_session_id" in conv
    assert "active_provider" in conv
    assert "active_model" in conv
    assert "pinned" in conv
    assert "deleted_at" in conv
    assert "title_manually_set" in conv


def test_conversation_migration_adds_title_and_timestamp_columns_for_minimal_legacy_schema(tmp_path):
    db = tmp_path / "minimal-legacy.db"
    conn = sqlite3.connect(db)
    conn.execute("""
        CREATE TABLE conversations (
            id TEXT PRIMARY KEY,
            workflow TEXT NOT NULL DEFAULT 'chat',
            model_id TEXT,
            provider_id TEXT
        )
    """)
    conn.execute("INSERT INTO conversations (id) VALUES ('minimal')")
    conn.commit()
    conn.close()

    store = MemoryStore(str(db))
    conv = store.get_conversation("minimal")
    assert "title" in conv
    assert "created_at" in conv
    assert "updated_at" in conv
    assert "archived" in conv
    assert conv["archived"] == 0


def test_provider_switch_creates_session_inside_same_conversation(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation(
        "conv-switch",
        title="Switch me",
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        active_session_id="session-old",
    )
    store.append_message("conv-switch", str(uuid.uuid4()), "user", "Write a lighthouse story.")
    store.append_message("conv-switch", str(uuid.uuid4()), "agent", "A lighthouse watched the harbor.")

    from nidavellir.routers.ws import switch_active_session_for_conversation

    result = switch_active_session_for_conversation(
        store,
        "conv-switch",
        new_provider="codex",
        new_model="gpt-5.4",
        mode="continue_with_prior_context",
    )

    assert result["conversation_id"] == "conv-switch"
    assert result["session_id"] != "session-old"
    conv = store.get_conversation("conv-switch")
    assert conv["active_session_id"] == result["session_id"]
    assert conv["active_provider"] == "codex"
    assert conv["active_model"] == "gpt-5.4"
    assert "lighthouse" in (conv["seed_text"] or "").lower()
    assert store.count_conversation_messages("conv-switch") == 2


def test_reconnect_new_session_keeps_persisted_provider_and_model(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation(
        "conv-resume",
        title="Resume me",
        provider_id="codex",
        model_id="gpt-5.5",
        active_session_id="session-active",
    )
    store.update_conversation(
        "conv-resume",
        {
            "active_provider": "codex",
            "active_model": "gpt-5.5",
        },
    )

    from nidavellir.routers.ws import resolve_new_session_state

    conversation_id, provider, model = resolve_new_session_state(
        store=store,
        requested_conversation_id="conv-resume",
        requested_provider="claude",
        requested_model="claude-sonnet-4-6",
        workflow="chat",
    )

    assert conversation_id == "conv-resume"
    assert provider == "codex"
    assert model == "gpt-5.5"
    conv = store.get_conversation("conv-resume")
    assert conv["active_provider"] == "codex"
    assert conv["active_model"] == "gpt-5.5"


@pytest.mark.asyncio
async def test_new_conversation_defaults_to_new_conversation(tmp_path):
    _setup(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/conversations", json={})
    assert r.status_code == 200
    assert r.json()["title"] == "New Conversation"


def test_first_user_message_auto_titles_conversation_with_ellipsis(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("auto-title")
    content = "  Write a 100 word story about a lighthouse that becomes a rap anthem for ships  "
    store.append_message("auto-title", str(uuid.uuid4()), "user", content)
    conv = store.get_conversation("auto-title")
    assert conv["title"] == "Write a 100 word story about a lighthouse that becomes a rap..."
    assert conv["title_manually_set"] == 0


def test_manual_title_prevents_later_auto_title(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("manual-title")
    store.update_conversation("manual-title", {"title": "My Manual Conversation", "title_manually_set": 1})
    store.append_message("manual-title", str(uuid.uuid4()), "user", "This should not replace the title")
    assert store.get_conversation("manual-title")["title"] == "My Manual Conversation"


@pytest.mark.asyncio
async def test_rename_sets_manual_flag_and_rejects_empty_title(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("rename-me")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        ok = await c.patch("/api/conversations/rename-me", json={"title": "Renamed Conversation"})
        bad = await c.patch("/api/conversations/rename-me", json={"title": "   "})
    assert ok.status_code == 200
    conv = store.get_conversation("rename-me")
    assert conv["title"] == "Renamed Conversation"
    assert conv["title_manually_set"] == 1
    assert bad.status_code == 400
    assert bad.json()["detail"] == "title_required"


@pytest.mark.asyncio
async def test_pin_unpin_and_list_pinned_order(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("pinned-old", title="Pinned old")
    store.create_conversation("pinned-new", title="Pinned new")
    store.create_conversation("normal-new", title="Normal new")
    with store._conn() as conn:
        conn.execute("UPDATE conversations SET updated_at = '2024-01-01 00:00:00' WHERE id = 'pinned-old'")
        conn.execute("UPDATE conversations SET updated_at = '2024-01-03 00:00:00' WHERE id = 'pinned-new'")
        conn.execute("UPDATE conversations SET updated_at = '2024-01-04 00:00:00' WHERE id = 'normal-new'")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        pin_old = await c.post("/api/conversations/pinned-old/pin", json={"pinned": True})
        pin_new = await c.post("/api/conversations/pinned-new/pin", json={"pinned": True})
        listed = await c.get("/api/conversations")
        unpin = await c.post("/api/conversations/pinned-old/pin", json={"pinned": False})

    assert pin_old.status_code == 200
    assert pin_new.status_code == 200
    assert pin_new.json()["pinned"] is True
    body = listed.json()
    assert [item["id"] for item in body[:3]] == ["pinned-new", "pinned-old", "normal-new"]
    assert body[0]["pinned"] is True
    assert body[2]["pinned"] is False
    assert unpin.json()["pinned"] is False


@pytest.mark.asyncio
async def test_archive_sets_deleted_at_excludes_from_list_and_keeps_messages(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("delete-me", title="Delete me")
    store.append_message("delete-me", "msg-1", "user", "Do not hard delete")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        archived = await c.post("/api/conversations/delete-me/archive")
        listed = await c.get("/api/conversations")

    assert archived.status_code == 200
    conv = store.get_conversation("delete-me")
    assert conv["archived"] == 1
    assert conv["deleted_at"] is not None
    assert "delete-me" not in [item["id"] for item in listed.json()]
    assert store.get_conversation_messages("delete-me")[0]["content"] == "Do not hard delete"


@pytest.mark.asyncio
async def test_unknown_conversation_returns_404_for_rename_pin_archive(tmp_path):
    _setup(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        rename = await c.patch("/api/conversations/missing", json={"title": "x"})
        pin = await c.post("/api/conversations/missing/pin", json={"pinned": True})
        archive = await c.post("/api/conversations/missing/archive")
    assert rename.status_code == 404
    assert pin.status_code == 404
    assert archive.status_code == 404
