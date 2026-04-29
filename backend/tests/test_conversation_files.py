from __future__ import annotations

import base64
import os
import sqlite3
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.main import app
from nidavellir.memory import store as store_module
from nidavellir.memory.store import MAX_TEXT_FILE_BYTES, MemoryStore, _resolve_working_set_path
from nidavellir.tokens.store import TokenUsageStore


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l2VJZQAAAABJRU5ErkJggg=="
)


def _setup(tmp_path: Path) -> MemoryStore:
    store = MemoryStore(str(tmp_path / "memory.db"))
    app.state.memory_store = store
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    return store


def _text_file(tmp_path: Path, name: str = "README.md", content: str = "# Readme\nHello file.\n") -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


async def _post_files(conversation_id: str, paths: list[Path], provider: str = "anthropic", model: str = "claude-sonnet-4-6"):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(
            f"/api/conversations/{conversation_id}/files",
            json={"paths": [str(p) for p in paths], "provider": provider, "model": model},
        )


async def _post_blob_files(
    conversation_id: str,
    files: list[dict],
    provider: str = "anthropic",
    model: str = "claude-sonnet-4-6",
    source: str = "drag_drop",
):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(
            f"/api/conversations/{conversation_id}/files/blob",
            json={"files": files, "provider": provider, "model": model, "source": source},
        )


def _blob(name: str, data: bytes, mime_type: str = "text/plain") -> dict:
    return {
        "fileName": name,
        "mimeType": mime_type,
        "contentBase64": base64.b64encode(data).decode("ascii"),
    }


@pytest.mark.asyncio
async def test_add_text_file_snapshots_content_into_app_storage(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-files")
    src = _text_file(tmp_path, content="first snapshot")

    r = await _post_files("conv-files", [src])

    assert r.status_code == 200
    added = r.json()["added"][0]
    assert added["fileName"] == "README.md"
    assert added["fileKind"] == "text"
    row = store.list_conversation_files("conv-files")[0]
    stored = Path(row["stored_path"])
    assert stored.exists()
    assert stored.read_text(encoding="utf-8") == "first snapshot"

    src.write_text("changed original", encoding="utf-8")
    assert stored.read_text(encoding="utf-8") == "first snapshot"


@pytest.mark.asyncio
async def test_original_path_stored_but_payload_uses_sanitized_file_name(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-files")
    src = _text_file(tmp_path, "secret.env", "TOKEN=abc")
    await _post_files("conv-files", [src])

    row = store.list_conversation_files("conv-files")[0]
    assert row["original_path"] == str(src)
    block = store.build_file_context_block("conv-files")
    assert "--- file: secret.env ---" in block
    assert str(tmp_path) not in block
    assert "TOKEN=abc" in block


@pytest.mark.asyncio
async def test_add_image_file_stores_metadata_and_attachment_record(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-image")
    img = tmp_path / "screenshot.png"
    img.write_bytes(PNG_1X1)

    r = await _post_files("conv-image", [img])

    assert r.status_code == 200
    added = r.json()["added"][0]
    assert added["fileKind"] == "image"
    assert added["imageWidth"] == 1
    assert added["imageHeight"] == 1
    assert added["imageFormat"] == "png"
    assert store.list_provider_image_attachments("conv-image", provider="anthropic", model="claude-sonnet-4-6")


@pytest.mark.asyncio
async def test_unsupported_binary_file_is_rejected(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-binary")
    binary = tmp_path / "data.bin"
    binary.write_bytes(b"\x00\x01\x02\x03\xff" * 20)

    r = await _post_files("conv-binary", [binary])

    assert r.status_code == 200
    assert r.json()["added"] == []
    assert r.json()["skipped"][0]["reason"] == "unsupported_binary"
    assert store.list_conversation_files("conv-binary") == []


@pytest.mark.asyncio
async def test_drag_drop_blob_text_file_snapshots_with_source(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-drop-text")

    r = await _post_blob_files("conv-drop-text", [_blob("README.md", b"# Readme\nDropped file.")])

    assert r.status_code == 200
    body = r.json()
    assert body["added"][0]["fileName"] == "README.md"
    row = store.list_conversation_files("conv-drop-text")[0]
    assert row["source"] == "drag_drop"
    assert row["text_content"] == "# Readme\nDropped file."
    assert row["estimated_tokens"] > 0


@pytest.mark.asyncio
async def test_drag_drop_blob_image_file_snapshots_with_metadata(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-drop-image")

    r = await _post_blob_files("conv-drop-image", [_blob("screenshot.png", PNG_1X1, "image/png")])

    assert r.status_code == 200
    added = r.json()["added"][0]
    assert added["fileKind"] == "image"
    assert added["source"] == "drag_drop"
    assert added["imageWidth"] == 1
    assert added["imageHeight"] == 1
    assert store.list_provider_image_attachments("conv-drop-image", provider="anthropic", model="claude-sonnet-4-6")


@pytest.mark.asyncio
async def test_clipboard_paste_blob_image_file_snapshots_with_source(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-clipboard-image")

    r = await _post_blob_files(
        "conv-clipboard-image",
        [_blob("clipboard-screenshot.png", PNG_1X1, "image/png")],
        source="clipboard_paste",
    )

    assert r.status_code == 200
    added = r.json()["added"][0]
    assert added["fileName"] == "clipboard-screenshot.png"
    assert added["fileKind"] == "image"
    assert added["source"] == "clipboard_paste"
    row = store.list_conversation_files("conv-clipboard-image")[0]
    assert row["source"] == "clipboard_paste"


@pytest.mark.asyncio
async def test_mixed_blob_source_is_accepted_for_combined_attachment_batches(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-mixed-files")

    r = await _post_blob_files(
        "conv-mixed-files",
        [
            _blob("README.md", b"# Readme\nDropped file."),
            _blob("clipboard-screenshot.png", PNG_1X1, "image/png"),
        ],
        source="mixed",
    )

    assert r.status_code == 200
    assert [item["source"] for item in r.json()["added"]] == ["mixed", "mixed"]


@pytest.mark.asyncio
async def test_drag_drop_blob_unsupported_binary_is_rejected(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-drop-binary")

    r = await _post_blob_files("conv-drop-binary", [_blob("archive.zip", b"PK\x00\x01\x02", "application/zip")])

    assert r.status_code == 200
    assert r.json()["added"] == []
    assert r.json()["skipped"][0]["reason"] == "unsupported_binary"
    assert store.list_conversation_files("conv-drop-binary") == []


@pytest.mark.asyncio
async def test_drag_drop_blob_conversation_not_found_returns_404(tmp_path):
    _setup(tmp_path)

    r = await _post_blob_files("missing", [_blob("README.md", b"hello")])

    assert r.status_code == 404


@pytest.mark.asyncio
async def test_preview_returns_estimated_token_impact_for_text_files(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-preview")
    src = _text_file(tmp_path, content="abcd" * 20)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/api/conversations/conv-preview/files/preview",
            json={"paths": [str(src)], "provider": "anthropic", "model": "claude-sonnet-4-6"},
        )

    assert r.status_code == 200
    body = r.json()
    assert body["files"][0]["estimatedTokens"] == 20
    assert body["addedTextTokens"] == 20
    assert body["contextAfter"]["currentTokens"] >= body["contextBefore"]["currentTokens"] + 20
    assert body["canAdd"] is True


def test_preview_rejects_too_large_text_file_before_reading_bytes(tmp_path, monkeypatch):
    store = _setup(tmp_path)
    store.create_conversation("conv-large")
    src = tmp_path / "large.txt"
    with src.open("wb") as f:
        f.truncate(MAX_TEXT_FILE_BYTES + 1)

    def fail_read_bytes(self):
        if self == src:
            raise AssertionError("large files should be rejected before read_bytes")
        return original_read_bytes(self)

    original_read_bytes = store_module.Path.read_bytes
    monkeypatch.setattr(store_module.Path, "read_bytes", fail_read_bytes)

    preview = store.preview_conversation_files("conv-large", [str(src)], provider="anthropic", model="claude-sonnet-4-6")

    assert preview["files"] == []
    assert preview["failures"][0]["reason"] == "too_large"
    assert preview["canAdd"] is False


def test_windows_paths_are_resolved_to_wsl_mounts_when_present(monkeypatch):
    original_exists = store_module.Path.exists

    def fake_exists(self):
        return str(self) == "/mnt/c/Users/colebienek/Downloads/spec.md" or original_exists(self)

    monkeypatch.setattr(store_module.Path, "exists", fake_exists)

    resolved = _resolve_working_set_path(r"C:\Users\colebienek\Downloads\spec.md")

    assert str(resolved) == "/mnt/c/Users/colebienek/Downloads/spec.md"


@pytest.mark.asyncio
async def test_preview_returns_image_attachment_status_for_images(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-preview-image")
    img = tmp_path / "shot.png"
    img.write_bytes(PNG_1X1)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/api/conversations/conv-preview-image/files/preview",
            json={"paths": [str(img)], "provider": "codex", "model": "gpt-5.4"},
        )

    assert r.status_code == 200
    item = r.json()["files"][0]
    assert item["fileKind"] == "image"
    assert item["warning"] == "stored, not sent by current model"


@pytest.mark.asyncio
async def test_add_is_blocked_if_projected_context_exceeds_limit(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-limit")
    huge = _text_file(tmp_path, "huge.txt", "x" * 500_000)

    r = await _post_files("conv-limit", [huge], provider="codex", model="gpt-5.4")

    assert r.status_code == 200
    body = r.json()
    assert body["added"] == []
    assert body["skipped"][0]["reason"] == "context_limit_exceeded"
    assert body["contextAfter"]["state"] == "blocked"
    assert store.list_conversation_files("conv-limit") == []


@pytest.mark.asyncio
async def test_delete_file_sets_inactive_and_deleted_at(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-delete")
    src = _text_file(tmp_path)
    add = await _post_files("conv-delete", [src])
    file_id = add.json()["added"][0]["id"]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.delete(f"/api/conversations/conv-delete/files/{file_id}")

    assert r.status_code == 200
    row = store.get_conversation_file(file_id)
    assert row["active"] == 0
    assert row["deleted_at"] is not None
    assert store.list_conversation_files("conv-delete") == []


@pytest.mark.asyncio
async def test_deleted_file_is_not_included_in_provider_payload(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-payload-delete")
    src = _text_file(tmp_path, content="delete me")
    add = await _post_files("conv-payload-delete", [src])
    file_id = add.json()["added"][0]["id"]
    store.delete_conversation_file("conv-payload-delete", file_id)

    assert store.build_file_context_block("conv-payload-delete") == ""


@pytest.mark.asyncio
async def test_files_persist_across_conversation_reload(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-reload")
    src = _text_file(tmp_path)
    await _post_files("conv-reload", [src])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/conversations/conv-reload/files")

    assert r.status_code == 200
    assert r.json()[0]["fileName"] == "README.md"


@pytest.mark.asyncio
async def test_context_usage_updates_after_adding_and_deleting_file(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-usage")
    src = _text_file(tmp_path, content="abcd" * 100)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        before = await c.get("/api/context/usage?conversation_id=conv-usage&model=claude-sonnet-4-6&provider=anthropic")
        add = await c.post(
            "/api/conversations/conv-usage/files",
            json={"paths": [str(src)], "provider": "anthropic", "model": "claude-sonnet-4-6"},
        )
        after_add = await c.get("/api/context/usage?conversation_id=conv-usage&model=claude-sonnet-4-6&provider=anthropic")
        await c.delete(f"/api/conversations/conv-usage/files/{add.json()['added'][0]['id']}")
        after_delete = await c.get("/api/context/usage?conversation_id=conv-usage&model=claude-sonnet-4-6&provider=anthropic")

    assert after_add.json()["currentTokens"] > before.json()["currentTokens"]
    assert after_delete.json()["currentTokens"] == before.json()["currentTokens"]


@pytest.mark.asyncio
async def test_conversation_not_found_returns_404(tmp_path):
    _setup(tmp_path)
    src = _text_file(tmp_path)

    r = await _post_files("missing", [src])

    assert r.status_code == 404


@pytest.mark.asyncio
async def test_unreadable_path_returns_failure(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-unreadable")
    missing = tmp_path / "missing.md"

    r = await _post_files("conv-unreadable", [missing])

    assert r.status_code == 200
    assert r.json()["skipped"][0]["reason"] == "not_found"


def test_safe_migration_preserves_existing_data(tmp_path):
    db = tmp_path / "legacy.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE conversations (id TEXT PRIMARY KEY, workflow TEXT NOT NULL DEFAULT 'chat')")
    conn.execute("INSERT INTO conversations (id) VALUES ('legacy')")
    conn.commit()
    conn.close()

    store = MemoryStore(str(db))
    conv = store.get_conversation("legacy")
    assert conv["id"] == "legacy"
    with store._conn() as conn:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(conversation_files)").fetchall()}
    assert {"conversation_id", "stored_path", "content_hash", "text_content", "active"}.issubset(cols)


def test_text_file_content_appears_in_dedicated_file_context_block(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-block")
    src = _text_file(tmp_path, "a.py", "print('hi')")
    store.add_conversation_files("conv-block", [str(src)], provider="anthropic", model="claude-sonnet-4-6")

    block = store.build_file_context_block("conv-block")

    assert block.startswith("Attached Files:")
    assert "--- file: a.py ---" in block
    assert "print('hi')" in block


def test_file_content_is_not_inserted_into_user_message(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-message")
    src = _text_file(tmp_path, "a.py", "print('hi')")
    store.add_conversation_files("conv-message", [str(src)], provider="anthropic", model="claude-sonnet-4-6")
    store.append_message("conv-message", "m1", "user", "Summarize the attached file.")

    messages = store.get_conversation_messages("conv-message")

    assert messages[0]["content"] == "Summarize the attached file."
    assert "print('hi')" not in messages[0]["content"]


def test_multiple_files_preserve_boundaries(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-multi")
    a = _text_file(tmp_path, "a.py", "A")
    b = _text_file(tmp_path, "b.py", "B")
    store.add_conversation_files("conv-multi", [str(a), str(b)], provider="anthropic", model="claude-sonnet-4-6")

    block = store.build_file_context_block("conv-multi")

    assert "--- file: a.py ---" in block
    assert "--- file: b.py ---" in block
    assert block.index("--- file: a.py ---") < block.index("--- file: b.py ---")


def test_image_files_included_only_for_vision_capable_models(tmp_path):
    store = _setup(tmp_path)
    store.create_conversation("conv-vision")
    img = tmp_path / "shot.png"
    img.write_bytes(PNG_1X1)
    store.add_conversation_files("conv-vision", [str(img)], provider="anthropic", model="claude-sonnet-4-6")

    assert store.list_provider_image_attachments("conv-vision", provider="anthropic", model="claude-sonnet-4-6")
    omitted = store.list_provider_image_attachments("conv-vision", provider="codex", model="gpt-5.4")
    assert omitted == []
    assert store.list_image_attachment_warnings("conv-vision", provider="codex", model="gpt-5.4")[0]["warning"] == "image_not_supported_by_model"
