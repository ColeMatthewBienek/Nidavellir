from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import sqlite3
import struct
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .context_pack import CONFIDENCE_STORE_THRESHOLD

DEFAULT_CONVERSATION_TITLE = "New Conversation"
MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
UNSUPPORTED_FILE_EXTENSIONS = {".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".exe", ".dll"}


def _auto_title_from_message(content: str) -> str:
    title = " ".join(content.split())
    if not title:
        return DEFAULT_CONVERSATION_TITLE
    if len(title) > 60:
        return title[:60].rstrip() + "..."
    return title


def _estimate_text_tokens(text: str) -> int:
    return len(text) // 4


def _provider_supports_vision(provider: str, model: str) -> bool:
    provider_l = provider.lower()
    model_l = model.lower()
    return provider_l in {"anthropic", "claude", "gemini"} or "vision" in model_l or "4o" in model_l


def _read_png_dimensions(data: bytes) -> tuple[int | None, int | None, str | None]:
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])[0], struct.unpack(">II", data[16:24])[1], "png"
    return None, None, None


def _read_image_metadata(path: Path, data: bytes) -> tuple[int | None, int | None, str | None]:
    width, height, fmt = _read_png_dimensions(data)
    if fmt:
        return width, height, fmt
    suffix = path.suffix.lower().lstrip(".")
    return None, None, suffix or None


def _resolve_working_set_path(path_value: str, base_dir: str | Path | None = None) -> Path:
    path = Path(path_value).expanduser()
    if path.exists():
        return path

    match = re.match(r"^([A-Za-z]):[\\/](.*)$", path_value)
    if match:
        drive = match.group(1).lower()
        rest = match.group(2).replace("\\", "/")
        wsl_path = Path(f"/mnt/{drive}/{rest}")
        if wsl_path.exists():
            return wsl_path

    if not path.is_absolute() and base_dir is not None:
        base_path = Path(base_dir).expanduser() / path
        if base_path.exists():
            return base_path
        return base_path

    return path

# ── Schema DDL ────────────────────────────────────────────────────────────────

_DDL = """
CREATE TABLE IF NOT EXISTS memories (
    id                     TEXT PRIMARY KEY,
    content                TEXT NOT NULL,
    category               TEXT NOT NULL DEFAULT 'thought',
    memory_type            TEXT NOT NULL DEFAULT 'fact',
    workflow               TEXT NOT NULL DEFAULT 'chat',
    scope_type             TEXT NOT NULL DEFAULT 'workflow',
    scope_id               TEXT,
    repo_id                TEXT,
    repo_name              TEXT,
    repo_root              TEXT,
    repo_remote_url        TEXT,
    tags                   TEXT,
    confidence             REAL NOT NULL DEFAULT 0.7,
    importance             INTEGER NOT NULL DEFAULT 5,
    session_id             TEXT,
    source_conversation_id TEXT,
    source_message_ids     TEXT,
    source_excerpt         TEXT,
    created_at             TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT,
    last_used              TEXT,
    use_count              INTEGER NOT NULL DEFAULT 0,
    source                 TEXT NOT NULL DEFAULT 'extracted',
    superseded_by          TEXT,
    deleted_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_active     ON memories(superseded_by) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_workflow   ON memories(workflow);
CREATE INDEX IF NOT EXISTS idx_memories_scope      ON memories(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_memories_repo       ON memories(repo_id) WHERE repo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_session    ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_created    ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type       ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    content,
    category,
    memory_type,
    workflow,
    tags,
    content='memories',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memory_fts(rowid, content, category, memory_type, workflow, tags)
    VALUES (new.rowid, new.content, new.category, new.memory_type, new.workflow, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, content, category, memory_type, workflow, tags)
    VALUES ('delete', old.rowid, old.content, old.category, old.memory_type, old.workflow, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, content, category, memory_type, workflow, tags)
    VALUES ('delete', old.rowid, old.content, old.category, old.memory_type, old.workflow, old.tags);
    INSERT INTO memory_fts(rowid, content, category, memory_type, workflow, tags)
    VALUES (new.rowid, new.content, new.category, new.memory_type, new.workflow, new.tags);
END;

CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    workflow    TEXT NOT NULL DEFAULT 'chat',
    model_id    TEXT,
    provider_id TEXT,
    title       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    archived    INTEGER NOT NULL DEFAULT 0,
    pinned      INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    title_manually_set INTEGER NOT NULL DEFAULT 0,
    working_directory TEXT,
    working_directory_display TEXT
);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'completed',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id);

CREATE TABLE IF NOT EXISTS conversation_files (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    original_path   TEXT NOT NULL,
    stored_path     TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    mime_type       TEXT,
    file_kind       TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    content_hash    TEXT NOT NULL,
    text_content    TEXT,
    estimated_tokens INTEGER,
    line_count      INTEGER,
    encoding        TEXT,
    image_width     INTEGER,
    image_height    INTEGER,
    image_format    TEXT,
    source          TEXT,
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT,
    active          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_conversation_files_conversation
ON conversation_files(conversation_id, active);

CREATE INDEX IF NOT EXISTS idx_conversation_files_hash
ON conversation_files(content_hash);

CREATE TABLE IF NOT EXISTS memory_events (
    id            TEXT PRIMARY KEY,
    memory_id     TEXT,
    event_subject TEXT NOT NULL DEFAULT 'memory',
    event_type    TEXT NOT NULL,
    session_id    TEXT,
    payload_json  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory  ON memory_events(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_events_subject ON memory_events(event_subject);
CREATE INDEX IF NOT EXISTS idx_memory_events_session ON memory_events(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_events_type    ON memory_events(event_type);
"""


def _migrate_conversations_continuity(conn: sqlite3.Connection) -> None:
    """Safe migration: add continuity columns to conversations if missing."""
    existing = {row[1] for row in conn.execute("PRAGMA table_info(conversations)").fetchall()}
    for col, defn in [
        ("title", "TEXT"),
        ("created_at", "TEXT"),
        ("updated_at", "TEXT"),
        ("archived", "INTEGER NOT NULL DEFAULT 0"),
        ("parent_id",       "TEXT"),
        ("status",          "TEXT NOT NULL DEFAULT 'active'"),
        ("continuity_mode", "TEXT"),
        ("seed_text",       "TEXT"),
        ("active_session_id", "TEXT"),
        ("active_provider", "TEXT"),
        ("active_model", "TEXT"),
        ("seed_turn_start", "INTEGER NOT NULL DEFAULT 0"),
        ("pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("deleted_at", "TEXT"),
        ("title_manually_set", "INTEGER NOT NULL DEFAULT 0"),
        ("working_directory", "TEXT"),
        ("working_directory_display", "TEXT"),
    ]:
        if col not in existing:
            conn.execute(f"ALTER TABLE conversations ADD COLUMN {col} {defn}")
    conn.execute("UPDATE conversations SET created_at = datetime('now') WHERE created_at IS NULL")
    conn.execute("UPDATE conversations SET updated_at = datetime('now') WHERE updated_at IS NULL")


def _migrate_conversation_files_source(conn: sqlite3.Connection) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(conversation_files)").fetchall()}
    if "source" not in existing:
        conn.execute("ALTER TABLE conversation_files ADD COLUMN source TEXT")


def _migrate_conversation_message_status(conn: sqlite3.Connection) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(conversation_messages)").fetchall()}
    added_status = False
    if "status" not in existing:
        conn.execute("ALTER TABLE conversation_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'")
        added_status = True
    if added_status:
        conn.execute("""
            UPDATE conversation_messages
               SET status = 'interrupted'
             WHERE role = 'user'
               AND id IN (
                   SELECT cm.id
                     FROM conversation_messages cm
                    WHERE cm.created_at = (
                        SELECT MAX(cm2.created_at)
                          FROM conversation_messages cm2
                         WHERE cm2.conversation_id = cm.conversation_id
                    )
               )
        """)


def _verify_fts5(conn: sqlite3.Connection) -> None:
    """Module-level so tests can monkeypatch nidavellir.memory.store._verify_fts5."""
    try:
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_check USING fts5(x)")
        conn.execute("DROP TABLE IF EXISTS _fts5_check")
    except sqlite3.OperationalError as e:
        raise RuntimeError(
            "SQLite FTS5 is not available. Nidavellir memory requires FTS5."
        ) from e


class MemoryStore:
    def __init__(self, db_path: str, vector_path: str | None = None) -> None:
        self._db_path = db_path
        self._vector_store = None
        if vector_path:
            try:
                from .vector_store import VectorStore
                self._vector_store = VectorStore(vector_path)
            except Exception as exc:
                # Non-fatal — store works without vector layer
                import warnings
                warnings.warn(f"VectorStore init failed, running without embeddings: {exc}")
        self._init_schema()

    @property
    def vector_store(self):
        """Public accessor for the optional VectorStore instance (may be None)."""
        return self._vector_store

    # ── Schema ────────────────────────────────────────────────────────────────

    def _init_schema(self) -> None:
        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            _verify_fts5(conn)
            conn.executescript(_DDL)
            _migrate_conversations_continuity(conn)
            _migrate_conversation_files_source(conn)
            _migrate_conversation_message_status(conn)
            conn.commit()
        finally:
            conn.close()

    def _storage_root(self) -> Path:
        root = Path(self._db_path).parent / "conversation_files"
        root.mkdir(parents=True, exist_ok=True)
        return root

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ── Event logging — the only write path for memory_events ────────────────

    def log_event(
        self,
        event_type: str,
        memory_id: str | None = None,
        event_subject: str = "memory",
        session_id: str | None = None,
        payload: dict | None = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO memory_events
                   (id, memory_id, event_subject, event_type, session_id, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()),
                    memory_id,
                    event_subject,
                    event_type,
                    session_id,
                    json.dumps(payload) if payload else None,
                ),
            )

    # ── Memory writes ─────────────────────────────────────────────────────────

    def save_memories(self, memories: list[dict]) -> int:
        saved = 0
        for m in memories:
            confidence = float(m.get("confidence", 0.7))
            if confidence < CONFIDENCE_STORE_THRESHOLD:
                self.log_event(
                    event_type="dedup_rejected",
                    event_subject="dedup",
                    memory_id=None,
                    session_id=m.get("session_id"),
                    payload={
                        "match_type": "low_confidence",
                        "content_preview": str(m.get("content", ""))[:80],
                        "confidence": confidence,
                    },
                )
                continue

            with self._conn() as conn:
                conn.execute(
                    """INSERT OR IGNORE INTO memories
                       (id, content, category, memory_type, workflow, scope_type, scope_id,
                        repo_id, repo_name, repo_root, repo_remote_url,
                        tags, confidence, importance,
                        session_id, source_conversation_id, source_message_ids, source_excerpt,
                        source, superseded_by)
                       VALUES
                       (:id, :content, :category, :memory_type, :workflow, :scope_type, :scope_id,
                        :repo_id, :repo_name, :repo_root, :repo_remote_url,
                        :tags, :confidence, :importance,
                        :session_id, :source_conversation_id, :source_message_ids, :source_excerpt,
                        :source, :superseded_by)""",
                    {
                        "id":                    m.get("id", str(uuid.uuid4())),
                        "content":               m["content"],
                        "category":              m.get("category", "thought"),
                        "memory_type":           m.get("memory_type", "fact"),
                        "workflow":              m.get("workflow", "chat"),
                        "scope_type":            m.get("scope_type", "workflow"),
                        "scope_id":              m.get("scope_id"),
                        "repo_id":               m.get("repo_id"),
                        "repo_name":             m.get("repo_name"),
                        "repo_root":             m.get("repo_root"),
                        "repo_remote_url":       m.get("repo_remote_url"),
                        "tags":                  m.get("tags", ""),
                        "confidence":            confidence,
                        "importance":            int(m.get("importance", 5)),
                        "session_id":            m.get("session_id"),
                        "source_conversation_id": m.get("source_conversation_id"),
                        "source_message_ids":    m.get("source_message_ids"),
                        "source_excerpt":        m.get("source_excerpt"),
                        "source":                m.get("source", "extracted"),
                        "superseded_by":         m.get("superseded_by"),
                    },
                )
            self.log_event(
                event_type="created",
                memory_id=m.get("id"),
                event_subject="memory",
                session_id=m.get("session_id"),
            )
            self._try_embed_and_upsert(m)
            saved += 1
        return saved

    def _try_embed_and_upsert(self, m: dict) -> None:
        """Embed memory content and upsert into Qdrant. Non-fatal — logs on failure."""
        if self._vector_store is None:
            return
        import nidavellir.memory.embedding as _emb
        memory_id = m.get("id", "")
        try:
            vector = _emb.embed(m.get("content", ""))
            self._vector_store.upsert(
                memory_id,
                vector,
                payload={
                    "content":     m.get("content", "")[:500],
                    "category":    m.get("category", ""),
                    "memory_type": m.get("memory_type", ""),
                    "workflow":    m.get("workflow", "chat"),
                    "confidence":  float(m.get("confidence", 0.0)),
                    "importance":  int(m.get("importance", 5)),
                    "scope_type":  m.get("scope_type", ""),
                    "scope_id":    m.get("scope_id") or "",
                },
            )
            self.log_event(
                event_type="embedding_created",
                memory_id=memory_id,
                event_subject="embedding",
                payload={"model": _emb.DEFAULT_EMBED_MODEL, "dim": _emb.EMBED_DIM},
            )
        except Exception as exc:
            self.log_event(
                event_type="embedding_failed",
                memory_id=memory_id,
                event_subject="embedding",
                payload={"error": str(exc)[:200]},
            )

    def update_memory(self, memory_id: str, updates: dict) -> bool:
        if not updates:
            return False
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [memory_id]
        with self._conn() as conn:
            cursor = conn.execute(
                f"UPDATE memories SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
                values,
            )
            changed = cursor.rowcount > 0
        if changed and "superseded_by" in updates:
            self.log_event(
                event_type="superseded",
                memory_id=memory_id,
                event_subject="memory",
            )
        return changed

    def soft_delete(self, memory_id: str) -> bool:
        with self._conn() as conn:
            cursor = conn.execute(
                "UPDATE memories SET deleted_at = datetime('now') WHERE id = ?",
                (memory_id,),
            )
            changed = cursor.rowcount > 0
        if changed:
            self.log_event(event_type="deleted", memory_id=memory_id)
        return changed

    def mark_memories_used(self, memory_ids: list[str]) -> None:
        """Increment use_count and set last_used for each memory ID.

        This is the ONLY authorised write path for usage tracking.
        Deduplicates IDs so passing the same ID twice only increments once.
        """
        if not memory_ids:
            return
        unique_ids = list(set(memory_ids))
        with self._conn() as conn:
            conn.executemany(
                """UPDATE memories
                   SET use_count = use_count + 1,
                       last_used = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                [(mid,) for mid in unique_ids],
            )

    def save_memory(self, m: dict) -> str:
        """Save a single memory dict and return its ID (convenience wrapper)."""
        mid = m.get("id") or str(uuid.uuid4())
        full = {
            "id":          mid,
            "content":     m.get("content", ""),
            "category":    m.get("category", "thought"),
            "memory_type": m.get("memory_type", "fact"),
            "workflow":    m.get("workflow", "chat"),
            "scope_type":  m.get("scope_type", "workflow"),
            "scope_id":    m.get("scope_id", m.get("workflow", "chat")),
            "tags":        m.get("tags", ""),
            "confidence":  m.get("confidence", 0.9),
            "importance":  m.get("importance", 5),
            "source":      m.get("source", "manual"),
        }
        self.save_memories([full])
        return mid

    # ── Memory reads ──────────────────────────────────────────────────────────

    def get_active_memories(self, workflow: str = "chat", limit: int = 50) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM memories
                   WHERE superseded_by IS NULL
                     AND deleted_at IS NULL
                     AND (workflow = ? OR scope_type IN ('global', 'user'))
                   ORDER BY importance DESC, use_count DESC, created_at DESC
                   LIMIT ?""",
                (workflow, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_global_memories(self, limit: int = 200) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM memories
                   WHERE superseded_by IS NULL
                     AND deleted_at IS NULL
                     AND scope_type IN ('global', 'user')
                   ORDER BY importance DESC, created_at DESC
                   LIMIT ?""",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_session_memories(self, session_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM memories
                   WHERE superseded_by IS NULL
                     AND deleted_at IS NULL
                     AND session_id = ?
                   ORDER BY created_at DESC""",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def search_fts(self, query: str, workflow: str = "chat", limit: int = 10) -> list[dict]:
        """Pure FTS search. Returns [] on empty query, bad query, or OperationalError.
        Callers that need recency fallback must handle the [] case themselves."""
        if not query or not query.strip():
            return []

        safe_query = _sanitize_fts_query(query)
        if not safe_query:
            return []

        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT m.*, bm25(memory_fts) AS relevance_score
                       FROM memory_fts
                       JOIN memories m ON memory_fts.rowid = m.rowid
                       WHERE memory_fts MATCH ?
                         AND m.superseded_by IS NULL
                         AND m.deleted_at IS NULL
                         AND (m.workflow = ? OR m.scope_type IN ('global', 'user'))
                       ORDER BY relevance_score, m.importance DESC, m.use_count DESC
                       LIMIT ?""",
                    (safe_query, workflow, limit),
                ).fetchall()
            return [dict(r) for r in rows]
        except sqlite3.OperationalError:
            return []

    def _fallback_search(self, workflow: str, limit: int) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM memories
                   WHERE superseded_by IS NULL
                     AND deleted_at IS NULL
                     AND (workflow = ? OR scope_type IN ('global', 'user'))
                   ORDER BY importance DESC, use_count DESC, created_at DESC
                   LIMIT ?""",
                (workflow, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Conversations ─────────────────────────────────────────────────────────

    def create_conversation(
        self,
        id: str,
        workflow: str = "chat",
        model_id: str | None = None,
        provider_id: str | None = None,
        title: str | None = None,
        active_session_id: str | None = None,
        working_directory: str | None = None,
        working_directory_display: str | None = None,
    ) -> dict:
        title = title or DEFAULT_CONVERSATION_TITLE
        active_session_id = active_session_id or id
        with self._conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO conversations
                   (id, workflow, model_id, provider_id, title, active_session_id, active_provider, active_model,
                    working_directory, working_directory_display)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    id,
                    workflow,
                    model_id,
                    provider_id,
                    title,
                    active_session_id,
                    provider_id,
                    model_id,
                    working_directory,
                    working_directory_display,
                ),
            )
            row = conn.execute(
                "SELECT * FROM conversations WHERE id = ?", (id,)
            ).fetchone()
        return dict(row) if row else {}

    def append_message(
        self,
        conversation_id: str,
        message_id: str,
        role: str,
        content: str,
        status: str = "completed",
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO conversation_messages
                   (id, conversation_id, role, content, status)
                   VALUES (?, ?, ?, ?, ?)""",
                (message_id, conversation_id, role, content, status),
            )
            if role == "user":
                row = conn.execute(
                    "SELECT title, title_manually_set FROM conversations WHERE id = ?", (conversation_id,)
                ).fetchone()
                if row and not row["title_manually_set"] and (row["title"] is None or row["title"] == DEFAULT_CONVERSATION_TITLE):
                    title = _auto_title_from_message(content)
                    conn.execute(
                        "UPDATE conversations SET title = ? WHERE id = ?",
                        (title, conversation_id),
                    )
            conn.execute(
                "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
                (conversation_id,),
            )

    def update_message_status(self, message_id: str, status: str) -> bool:
        with self._conn() as conn:
            cursor = conn.execute(
                "UPDATE conversation_messages SET status = ? WHERE id = ?",
                (status, message_id),
            )
            return cursor.rowcount > 0

    def count_conversation_messages(self, conversation_id: str) -> int:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = ?",
                (conversation_id,),
            ).fetchone()
        return row[0] if row else 0

    def get_conversation_messages(self, conversation_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM conversation_messages
                   WHERE conversation_id = ?
                   ORDER BY created_at ASC""",
                (conversation_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_conversation(self, conversation_id: str) -> dict:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
        return dict(row) if row else {}

    def freeze_conversation(self, conversation_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE conversations SET status = 'frozen', updated_at = datetime('now') WHERE id = ?",
                (conversation_id,),
            )

    def create_child_conversation(
        self,
        parent_id: str,
        *,
        new_id: str,
        workflow: str = "chat",
        model_id: str | None = None,
        provider_id: str | None = None,
        continuity_mode: str | None = None,
        seed_text: str | None = None,
    ) -> dict:
        with self._conn() as conn:
            parent = conn.execute(
                "SELECT working_directory, working_directory_display FROM conversations WHERE id = ?",
                (parent_id,),
            ).fetchone()
            conn.execute(
                """INSERT OR IGNORE INTO conversations
                   (id, workflow, model_id, provider_id, parent_id, status, continuity_mode, seed_text,
                    working_directory, working_directory_display)
                   VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)""",
                (
                    new_id,
                    workflow,
                    model_id,
                    provider_id,
                    parent_id,
                    continuity_mode,
                    seed_text,
                    parent["working_directory"] if parent else None,
                    parent["working_directory_display"] if parent else None,
                ),
            )
            row = conn.execute(
                "SELECT * FROM conversations WHERE id = ?", (new_id,)
            ).fetchone()
        return dict(row) if row else {}

    def get_conversation_seed(self, conversation_id: str) -> str | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT seed_text FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
        return row[0] if row else None

    def update_conversation(
        self,
        conversation_id: str,
        updates: dict,
    ) -> dict:
        allowed = {
            "title",
            "archived",
            "pinned",
            "deleted_at",
            "title_manually_set",
            "active_session_id",
            "active_provider",
            "active_model",
            "provider_id",
            "model_id",
            "seed_text",
            "seed_turn_start",
            "continuity_mode",
            "status",
            "working_directory",
            "working_directory_display",
        }
        fields = [k for k in updates if k in allowed]
        if not fields:
            return self.get_conversation(conversation_id)
        assignments = ", ".join(f"{k} = ?" for k in fields)
        values = [updates[k] for k in fields]
        values.append(conversation_id)
        with self._conn() as conn:
            conn.execute(
                f"UPDATE conversations SET {assignments}, updated_at = datetime('now') WHERE id = ?",
                values,
            )
        return self.get_conversation(conversation_id)

    def list_conversation_summaries(self, workflow: str = "chat", limit: int = 100) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT
                       c.id,
                       COALESCE(c.title, 'New Conversation') AS title,
                       c.created_at,
                       c.updated_at,
                       c.pinned,
                       c.archived,
                       c.working_directory,
                       c.working_directory_display,
                       COALESCE(c.active_provider, c.provider_id) AS active_provider,
                       COALESCE(c.active_model, c.model_id) AS active_model,
                       COUNT(cm.id) AS message_count
                   FROM conversations c
                   LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
                   WHERE c.workflow = ?
                     AND c.archived = 0
                     AND c.parent_id IS NULL
                   GROUP BY c.id
                   ORDER BY c.pinned DESC, c.updated_at DESC
                   LIMIT ?""",
                (workflow, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Conversation files / working set ─────────────────────────────────────

    def _context_usage_from_tokens(self, tokens: int, provider: str, model: str) -> dict:
        from nidavellir.tokens.context_meter import compute_context_pressure

        pressure = compute_context_pressure(tokens, model, provider, accuracy="estimated")
        return {
            "model": pressure.model,
            "provider": pressure.provider,
            "currentTokens": pressure.current_tokens,
            "usableTokens": pressure.usable_tokens,
            "percentUsed": pressure.percent_used,
            "state": pressure.state,
            "accuracy": pressure.accuracy,
            "contextLimit": pressure.context_limit,
            "reservedOutputTokens": pressure.reserved_output_tokens,
            "lastUpdatedAt": pressure.last_updated_at,
        }

    def active_file_text_tokens(self, conversation_id: str) -> int:
        with self._conn() as conn:
            row = conn.execute(
                """SELECT COALESCE(SUM(estimated_tokens), 0)
                   FROM conversation_files
                   WHERE conversation_id = ? AND active = 1 AND file_kind = 'text'""",
                (conversation_id,),
            ).fetchone()
        return int(row[0] or 0)

    def conversation_payload_tokens(self, conversation_id: str) -> int:
        from nidavellir.tokens.context_meter import estimate_payload_tokens

        return estimate_payload_tokens(self.get_conversation_messages(conversation_id)) + self.active_file_text_tokens(conversation_id)

    def _inspect_file_for_working_set(
        self,
        path_value: str,
        provider: str,
        model: str,
        base_dir: str | Path | None = None,
    ) -> tuple[dict | None, dict | None]:
        path = _resolve_working_set_path(path_value, base_dir=base_dir)
        if not path.exists():
            return None, {"path": path_value, "reason": "not_found", "message": "File was not found."}
        if not path.is_file():
            return None, {"path": path_value, "reason": "not_file", "message": "Path is not a file."}

        try:
            size = path.stat().st_size
        except OSError:
            return None, {"path": path_value, "reason": "unreadable", "message": "File metadata could not be read."}

        suffix = path.suffix.lower()
        mime_type = mimetypes.guess_type(path.name)[0]
        if suffix in UNSUPPORTED_FILE_EXTENSIONS:
            return None, {"path": path_value, "reason": "unsupported_binary", "message": "Unsupported file type."}
        if suffix in IMAGE_EXTENSIONS:
            if size > MAX_IMAGE_FILE_BYTES:
                return None, {"path": path_value, "reason": "too_large", "message": "Image file is too large."}
        elif size > MAX_TEXT_FILE_BYTES:
            return None, {"path": path_value, "reason": "too_large", "message": "Text file is too large."}

        try:
            data = path.read_bytes()
        except OSError:
            return None, {"path": path_value, "reason": "unreadable", "message": "File could not be read."}

        content_hash = hashlib.sha256(data).hexdigest()
        base = {
            "path": path_value,
            "original_path": str(path),
            "file_name": path.name,
            "mime_type": mime_type,
            "size_bytes": size,
            "content_hash": content_hash,
            "data": data,
        }

        if suffix in IMAGE_EXTENSIONS:
            width, height, fmt = _read_image_metadata(path, data)
            warning = None if _provider_supports_vision(provider, model) else "stored, not sent by current model"
            return {
                **base,
                "file_kind": "image",
                "image_width": width,
                "image_height": height,
                "image_format": fmt,
                "warning": warning,
            }, None

        if b"\x00" in data:
            return None, {"path": path_value, "reason": "unsupported_binary", "message": "Binary files are not supported."}
        try:
            text = data.decode("utf-8-sig")
            encoding = "utf-8"
        except UnicodeDecodeError:
            return None, {"path": path_value, "reason": "unsupported_binary", "message": "File could not be decoded as text."}

        return {
            **base,
            "file_kind": "text",
            "text_content": text,
            "estimated_tokens": _estimate_text_tokens(text),
            "line_count": len(text.splitlines()),
            "encoding": encoding,
        }, None

    def _inspect_blob_for_working_set(
        self,
        *,
        file_name: str,
        data: bytes,
        mime_type: str | None,
        provider: str,
        model: str,
        source: str,
    ) -> tuple[dict | None, dict | None]:
        safe_name = Path(file_name).name
        if not safe_name:
            return None, {"path": file_name, "reason": "invalid_name", "message": "File name is required."}
        suffix = Path(safe_name).suffix.lower()
        size = len(data)
        if suffix in UNSUPPORTED_FILE_EXTENSIONS:
            return None, {"path": file_name, "reason": "unsupported_binary", "message": "Unsupported file type."}
        if suffix in IMAGE_EXTENSIONS:
            if size > MAX_IMAGE_FILE_BYTES:
                return None, {"path": file_name, "reason": "too_large", "message": "Image file is too large."}
        elif size > MAX_TEXT_FILE_BYTES:
            return None, {"path": file_name, "reason": "too_large", "message": "Text file is too large."}

        content_hash = hashlib.sha256(data).hexdigest()
        base = {
            "path": file_name,
            "original_path": file_name,
            "file_name": safe_name,
            "mime_type": mime_type or mimetypes.guess_type(safe_name)[0],
            "size_bytes": size,
            "content_hash": content_hash,
            "data": data,
            "source": source,
        }

        if suffix in IMAGE_EXTENSIONS:
            width, height, fmt = _read_image_metadata(Path(safe_name), data)
            warning = None if _provider_supports_vision(provider, model) else "stored, not sent by current model"
            return {
                **base,
                "file_kind": "image",
                "image_width": width,
                "image_height": height,
                "image_format": fmt,
                "warning": warning,
            }, None

        if b"\x00" in data:
            return None, {"path": file_name, "reason": "unsupported_binary", "message": "Binary files are not supported."}
        try:
            text = data.decode("utf-8-sig")
            encoding = "utf-8"
        except UnicodeDecodeError:
            return None, {"path": file_name, "reason": "unsupported_binary", "message": "File could not be decoded as text."}

        return {
            **base,
            "file_kind": "text",
            "text_content": text,
            "estimated_tokens": _estimate_text_tokens(text),
            "line_count": len(text.splitlines()),
            "encoding": encoding,
        }, None

    def preview_conversation_files(self, conversation_id: str, paths: list[str], *, provider: str, model: str) -> dict:
        before_tokens = self.conversation_payload_tokens(conversation_id)
        context_before = self._context_usage_from_tokens(before_tokens, provider, model)
        conv = self.get_conversation(conversation_id)
        base_dir = conv.get("working_directory") if conv else None
        inspected: list[dict] = []
        failures: list[dict] = []
        added_text_tokens = 0

        for path in paths:
            item, failure = self._inspect_file_for_working_set(path, provider, model, base_dir=base_dir)
            if failure:
                failures.append(failure)
                continue
            assert item is not None
            inspected.append(item)
            added_text_tokens += int(item.get("estimated_tokens") or 0)

        after_tokens = before_tokens + added_text_tokens
        context_after = self._context_usage_from_tokens(after_tokens, provider, model)
        can_add = not failures and context_after["state"] != "blocked"
        blocking_reason = None
        if context_after["state"] == "blocked":
            can_add = False
            blocking_reason = "Adding these files would exceed the current model context window."

        files = []
        for item in inspected:
            files.append({
                "path": item["path"],
                "fileName": item["file_name"],
                "fileKind": item["file_kind"],
                "sizeBytes": item["size_bytes"],
                "estimatedTokens": item.get("estimated_tokens"),
                "lineCount": item.get("line_count"),
                "imageWidth": item.get("image_width"),
                "imageHeight": item.get("image_height"),
                "warning": item.get("warning"),
            })

        return {
            "files": files,
            "failures": failures,
            "contextBefore": context_before,
            "contextAfter": context_after,
            "addedTextTokens": added_text_tokens,
            "projectedPercentUsed": context_after["percentUsed"],
            "canAdd": can_add,
            "blockingReason": blocking_reason,
            "_inspected": inspected,
        }

    def preview_conversation_file_blobs(self, conversation_id: str, files: list[dict], *, provider: str, model: str, source: str) -> dict:
        before_tokens = self.conversation_payload_tokens(conversation_id)
        context_before = self._context_usage_from_tokens(before_tokens, provider, model)
        inspected: list[dict] = []
        failures: list[dict] = []
        added_text_tokens = 0

        for file in files:
            item, failure = self._inspect_blob_for_working_set(
                file_name=str(file.get("fileName") or ""),
                data=file.get("data") or b"",
                mime_type=file.get("mimeType"),
                provider=provider,
                model=model,
                source=source,
            )
            if failure:
                failures.append(failure)
                continue
            assert item is not None
            inspected.append(item)
            added_text_tokens += int(item.get("estimated_tokens") or 0)

        after_tokens = before_tokens + added_text_tokens
        context_after = self._context_usage_from_tokens(after_tokens, provider, model)
        can_add = not failures and context_after["state"] != "blocked"
        blocking_reason = None
        if context_after["state"] == "blocked":
            can_add = False
            blocking_reason = "Adding these files would exceed the current model context window."

        return {
            "files": [{
                "path": item["path"],
                "fileName": item["file_name"],
                "fileKind": item["file_kind"],
                "sizeBytes": item["size_bytes"],
                "estimatedTokens": item.get("estimated_tokens"),
                "lineCount": item.get("line_count"),
                "imageWidth": item.get("image_width"),
                "imageHeight": item.get("image_height"),
                "warning": item.get("warning"),
            } for item in inspected],
            "failures": failures,
            "contextBefore": context_before,
            "contextAfter": context_after,
            "addedTextTokens": added_text_tokens,
            "projectedPercentUsed": context_after["percentUsed"],
            "canAdd": can_add,
            "blockingReason": blocking_reason,
            "_inspected": inspected,
        }

    def add_conversation_files(self, conversation_id: str, paths: list[str], *, provider: str, model: str) -> dict:
        preview = self.preview_conversation_files(conversation_id, paths, provider=provider, model=model)
        if preview["failures"]:
            return {
                "added": [],
                "skipped": preview["failures"],
                "contextBefore": preview["contextBefore"],
                "contextAfter": preview["contextAfter"],
            }
        if not preview["canAdd"]:
            skipped = [{
                "path": item["path"],
                "reason": "context_limit_exceeded",
                "message": preview["blockingReason"] or "Adding these files would exceed the current model context window.",
            } for item in preview["_inspected"]]
            return {
                "added": [],
                "skipped": skipped,
                "contextBefore": preview["contextBefore"],
                "contextAfter": preview["contextAfter"],
            }

        added: list[dict] = []
        with self._conn() as conn:
            for item in preview["_inspected"]:
                file_id = str(uuid.uuid4())
                dest_dir = self._storage_root() / conversation_id
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / f"{file_id}-{Path(item['file_name']).name}"
                dest.write_bytes(item["data"])
                conn.execute(
                    """INSERT INTO conversation_files
                       (id, conversation_id, original_path, stored_path, file_name, mime_type,
                        file_kind, size_bytes, content_hash, text_content, estimated_tokens,
                        line_count, encoding, image_width, image_height, image_format)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        file_id,
                        conversation_id,
                        item["original_path"],
                        str(dest),
                        item["file_name"],
                        item.get("mime_type"),
                        item["file_kind"],
                        item["size_bytes"],
                        item["content_hash"],
                        item.get("text_content"),
                        item.get("estimated_tokens"),
                        item.get("line_count"),
                        item.get("encoding"),
                        item.get("image_width"),
                        item.get("image_height"),
                        item.get("image_format"),
                    ),
                )
                row = conn.execute("SELECT * FROM conversation_files WHERE id = ?", (file_id,)).fetchone()
                added.append(dict(row))
        return {
            "added": added,
            "skipped": [],
            "contextBefore": preview["contextBefore"],
            "contextAfter": preview["contextAfter"],
        }

    def add_conversation_file_blobs(self, conversation_id: str, files: list[dict], *, provider: str, model: str, source: str = "drag_drop") -> dict:
        preview = self.preview_conversation_file_blobs(conversation_id, files, provider=provider, model=model, source=source)
        if preview["failures"]:
            return {
                "added": [],
                "skipped": preview["failures"],
                "contextBefore": preview["contextBefore"],
                "contextAfter": preview["contextAfter"],
            }
        if not preview["canAdd"]:
            skipped = [{
                "path": item["path"],
                "reason": "context_limit_exceeded",
                "message": preview["blockingReason"] or "Adding these files would exceed the current model context window.",
            } for item in preview["_inspected"]]
            return {
                "added": [],
                "skipped": skipped,
                "contextBefore": preview["contextBefore"],
                "contextAfter": preview["contextAfter"],
            }

        added: list[dict] = []
        with self._conn() as conn:
            for item in preview["_inspected"]:
                file_id = str(uuid.uuid4())
                dest_dir = self._storage_root() / conversation_id
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / f"{file_id}-{Path(item['file_name']).name}"
                dest.write_bytes(item["data"])
                conn.execute(
                    """INSERT INTO conversation_files
                       (id, conversation_id, original_path, stored_path, file_name, mime_type,
                        file_kind, size_bytes, content_hash, text_content, estimated_tokens,
                        line_count, encoding, image_width, image_height, image_format, source)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        file_id,
                        conversation_id,
                        item["original_path"],
                        str(dest),
                        item["file_name"],
                        item.get("mime_type"),
                        item["file_kind"],
                        item["size_bytes"],
                        item["content_hash"],
                        item.get("text_content"),
                        item.get("estimated_tokens"),
                        item.get("line_count"),
                        item.get("encoding"),
                        item.get("image_width"),
                        item.get("image_height"),
                        item.get("image_format"),
                        item.get("source"),
                    ),
                )
                row = conn.execute("SELECT * FROM conversation_files WHERE id = ?", (file_id,)).fetchone()
                added.append(dict(row))
        return {
            "added": added,
            "skipped": [],
            "contextBefore": preview["contextBefore"],
            "contextAfter": preview["contextAfter"],
        }

    def list_conversation_files(self, conversation_id: str, active_only: bool = True) -> list[dict]:
        clause = "AND active = 1" if active_only else ""
        with self._conn() as conn:
            rows = conn.execute(
                f"""SELECT * FROM conversation_files
                    WHERE conversation_id = ? {clause}
                    ORDER BY added_at ASC""",
                (conversation_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_conversation_file(self, file_id: str) -> dict:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM conversation_files WHERE id = ?", (file_id,)).fetchone()
        return dict(row) if row else {}

    def delete_conversation_file(self, conversation_id: str, file_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                """UPDATE conversation_files
                   SET active = 0, deleted_at = datetime('now')
                   WHERE id = ? AND conversation_id = ? AND active = 1""",
                (file_id, conversation_id),
            )
        return cur.rowcount > 0

    def build_file_context_block(self, conversation_id: str) -> str:
        rows = [r for r in self.list_conversation_files(conversation_id) if r.get("file_kind") == "text"]
        if not rows:
            return ""
        parts = ["Attached Files:"]
        for row in rows:
            parts.append(f"--- file: {Path(row['file_name']).name} ---")
            parts.append(row.get("text_content") or "")
        return "\n\n".join(parts).strip()

    def list_provider_image_attachments(self, conversation_id: str, *, provider: str, model: str) -> list[dict]:
        if not _provider_supports_vision(provider, model):
            return []
        return [
            {
                "id": row["id"],
                "fileName": row["file_name"],
                "storedPath": row["stored_path"],
                "mimeType": row["mime_type"],
                "width": row["image_width"],
                "height": row["image_height"],
            }
            for row in self.list_conversation_files(conversation_id)
            if row.get("file_kind") == "image"
        ]

    def list_image_attachment_warnings(self, conversation_id: str, *, provider: str, model: str) -> list[dict]:
        if _provider_supports_vision(provider, model):
            return []
        return [
            {"id": row["id"], "fileName": row["file_name"], "warning": "image_not_supported_by_model"}
            for row in self.list_conversation_files(conversation_id)
            if row.get("file_kind") == "image"
        ]

    def get_recent_conversations(self, workflow: str = "chat", limit: int = 20) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM conversations
                   WHERE workflow = ? AND archived = 0
                   ORDER BY updated_at DESC
                   LIMIT ?""",
                (workflow, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Events ────────────────────────────────────────────────────────────────

    def get_events(
        self,
        memory_id: str | None = None,
        session_id: str | None = None,
        event_type: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        clauses: list[str] = []
        params: list = []
        if memory_id is not None:
            clauses.append("memory_id = ?")
            params.append(memory_id)
        if session_id is not None:
            clauses.append("session_id = ?")
            params.append(session_id)
        if event_type is not None:
            clauses.append("event_type = ?")
            params.append(event_type)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)

        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM memory_events {where} ORDER BY created_at DESC LIMIT ?",
                params,
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Quality diagnostic methods ────────────────────────────────────────────

    def quality_summary(self, workflow: str = "chat") -> dict:
        from datetime import datetime, UTC

        with self._conn() as conn:
            active_memories = conn.execute(
                "SELECT COUNT(*) FROM memories WHERE superseded_by IS NULL AND deleted_at IS NULL AND (workflow=? OR scope_type IN ('global','user'))",
                (workflow,),
            ).fetchone()[0]

            total_memories = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]

            injected_24h = conn.execute(
                "SELECT COUNT(*) FROM memory_events WHERE event_type='injected' AND created_at >= datetime('now','-1 day')"
            ).fetchone()[0]

            extraction_failures_24h = conn.execute(
                "SELECT COUNT(*) FROM memory_events WHERE event_subject='extraction' AND event_type IN ('extraction_failed','parse_failed') AND created_at >= datetime('now','-1 day')"
            ).fetchone()[0]

            parse_failures_24h = conn.execute(
                "SELECT COUNT(*) FROM memory_events WHERE event_type='parse_failed' AND created_at >= datetime('now','-1 day')"
            ).fetchone()[0]

            dedup_rejections_24h = conn.execute(
                "SELECT COUNT(*) FROM memory_events WHERE event_subject='dedup' AND event_type='dedup_rejected' AND created_at >= datetime('now','-1 day')"
            ).fetchone()[0]

            low_confidence_stored = conn.execute(
                "SELECT COUNT(*) FROM memories WHERE superseded_by IS NULL AND deleted_at IS NULL AND confidence>=0.50 AND confidence<0.70 AND (workflow=? OR scope_type IN ('global','user'))",
                (workflow,),
            ).fetchone()[0]

            never_used = conn.execute(
                "SELECT COUNT(*) FROM memories WHERE superseded_by IS NULL AND deleted_at IS NULL AND use_count=0 AND (workflow=? OR scope_type IN ('global','user'))",
                (workflow,),
            ).fetchone()[0]

            superseded = conn.execute(
                "SELECT COUNT(*) FROM memories WHERE superseded_by IS NOT NULL AND (workflow=? OR scope_type IN ('global','user'))",
                (workflow,),
            ).fetchone()[0]

            deleted = conn.execute(
                "SELECT COUNT(*) FROM memories WHERE deleted_at IS NOT NULL"
            ).fetchone()[0]

            fallback_events_24h = conn.execute(
                "SELECT COUNT(*) FROM memory_events WHERE event_subject='retrieval' AND event_type IN ('searched','retrieval_fallback') AND payload_json LIKE '%fallback_recency%' AND created_at >= datetime('now','-1 day')"
            ).fetchone()[0]

            recent_rows = conn.execute(
                "SELECT event_type, created_at FROM memory_events WHERE event_type IN ('extraction_failed','dedup_rejected') ORDER BY created_at DESC LIMIT 5"
            ).fetchall()

        if extraction_failures_24h > 3 or (active_memories > 0 and low_confidence_stored > active_memories * 0.20):
            status = "critical"
        elif extraction_failures_24h > 0 or low_confidence_stored > 10 or (active_memories > 0 and never_used > active_memories * 0.05):
            status = "warning"
        else:
            status = "healthy"

        recent_alerts = []
        for row in recent_rows:
            try:
                dt = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
                time_str = dt.strftime("%H:%M")
            except Exception:
                time_str = "--:--"
            recent_alerts.append({
                "time":  time_str,
                "type":  "Extraction Failure" if row["event_type"] == "extraction_failed" else "Dedup Rejection",
                "count": 1,
            })

        return {
            "status":                  status,
            "active_memories":         active_memories,
            "total_memories":          total_memories,
            "injected_24h":            injected_24h,
            "extraction_failures_24h": extraction_failures_24h,
            "parse_failures_24h":      parse_failures_24h,
            "dedup_rejections_24h":    dedup_rejections_24h,
            "low_confidence_stored":   low_confidence_stored,
            "never_used":              never_used,
            "superseded":              superseded,
            "deleted":                 deleted,
            "fallback_events_24h":     fallback_events_24h,
            "last_updated":            datetime.now(UTC).isoformat(),
            # widget compat fields
            "recent_alerts":           recent_alerts,
            "trend24h":                None,
        }

    def quality_stale(self, workflow: str = "chat", limit: int = 25) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT *,
                     CAST(julianday('now') - julianday(created_at) AS INTEGER) AS age_days,
                     CASE WHEN last_used IS NOT NULL
                          THEN CAST(julianday('now') - julianday(last_used) AS INTEGER)
                          ELSE NULL
                     END AS days_since_last_used
                   FROM memories
                   WHERE superseded_by IS NULL AND deleted_at IS NULL
                     AND (workflow = ? OR scope_type IN ('global','user'))
                     AND (
                       (last_used IS NULL AND created_at < datetime('now','-30 days'))
                       OR last_used < datetime('now','-30 days')
                     )
                   ORDER BY COALESCE(last_used, created_at) ASC
                   LIMIT ?""",
                (workflow, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def quality_low_confidence(self, workflow: str = "chat", limit: int = 25) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM memories
                   WHERE superseded_by IS NULL AND deleted_at IS NULL
                     AND confidence >= 0.50 AND confidence < 0.70
                     AND (workflow = ? OR scope_type IN ('global','user'))
                   ORDER BY confidence ASC
                   LIMIT ?""",
                (workflow, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def quality_never_used(self, workflow: str = "chat", limit: int = 25) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM memories
                   WHERE superseded_by IS NULL AND deleted_at IS NULL
                     AND use_count = 0
                     AND (workflow = ? OR scope_type IN ('global','user'))
                   ORDER BY created_at DESC
                   LIMIT ?""",
                (workflow, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def quality_frequent(self, workflow: str = "chat", limit: int = 25) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM memories
                   WHERE superseded_by IS NULL AND deleted_at IS NULL
                     AND use_count > 0
                     AND (workflow = ? OR scope_type IN ('global','user'))
                   ORDER BY use_count DESC, last_used DESC
                   LIMIT ?""",
                (workflow, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def quality_events(self, workflow: str = "chat", limit: int = 50) -> list[dict]:
        relevant = (
            "extraction_failed", "parse_failed", "dedup_rejected",
            "retrieval_fallback", "searched",
            "vector_searched", "vector_search_failed",
            "hybrid_scored", "bad_hybrid_pick_candidate",
            "consolidation_applied", "consolidation_proposed",
        )
        placeholders = ",".join("?" * len(relevant))
        with self._conn() as conn:
            rows = conn.execute(
                f"""SELECT * FROM memory_events
                    WHERE event_type IN ({placeholders})
                    ORDER BY created_at DESC
                    LIMIT ?""",
                (*relevant, limit),
            ).fetchall()

        result = []
        for row in rows:
            d = dict(row)
            raw = d.pop("payload_json", None)
            try:
                d["payload"] = json.loads(raw) if raw else None
            except Exception:
                d["payload"] = None
                d["payload_json"] = raw
            result.append(d)
        return result

    def quality_top_scored(
        self, workflow: str = "chat", query: str = "", limit: int = 25
    ) -> list[dict]:
        from .context_pack import compute_final_score

        fts_results = self.search_fts(query, workflow, limit=limit) if query.strip() else []
        if fts_results:
            candidates = [(m, m.get("relevance_score")) for m in fts_results]
            reason = "fts_match"
        else:
            candidates = [(m, None) for m in self.get_active_memories(workflow, limit=limit)]
            reason = "fallback_recency"

        scored = []
        for m, rank in candidates:
            score = compute_final_score(
                relevance_score=rank,
                importance=int(m.get("importance", 5)),
                scope_boost=0.1,
                memory_type=m.get("memory_type", "fact"),
                created_at=m.get("created_at", ""),
                use_count=int(m.get("use_count", 0)),
            )
            entry = dict(m)
            entry["score"] = round(score, 4)
            entry["relevance_score"] = rank
            entry["reason"] = reason
            scored.append((score, entry))

        scored.sort(key=lambda t: t[0], reverse=True)
        return [e for _, e in scored[:limit]]

    def quality_duplicates(
        self, workflow: str = "chat", limit: int = 25, dry_run: bool = True
    ) -> dict:
        from .consolidator import consolidate_memories
        return consolidate_memories(self, workflow=workflow, dry_run=dry_run, limit=limit)

    # ── Export methods ────────────────────────────────────────────────────────

    def export_activity_events(
        self,
        hours: int = 24,
        workflow: str = "chat",
        event_type: str | None = None,
        event_subject: str | None = None,
        memory_id: str | None = None,
        session_id: str | None = None,
        include_snapshots: bool = True,
    ) -> list[dict]:
        """Return enriched memory events for JSONL activity export.

        Ordered oldest → newest. hours=0 means no time limit.
        """
        from datetime import datetime, UTC

        clauses = []
        params: list = []

        if hours and hours > 0:
            clauses.append("me.created_at >= datetime('now', ?)")
            params.append(f"-{hours} hours")
        if event_type:
            clauses.append("me.event_type = ?")
            params.append(event_type)
        if event_subject:
            clauses.append("me.event_subject = ?")
            params.append(event_subject)
        if memory_id:
            clauses.append("me.memory_id = ?")
            params.append(memory_id)
        if session_id:
            clauses.append("me.session_id = ?")
            params.append(session_id)

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

        with self._conn() as conn:
            rows = conn.execute(
                f"""SELECT me.* FROM memory_events me
                    {where}
                    ORDER BY me.created_at ASC""",
                params,
            ).fetchall()

            snapshot_cache: dict[str, dict | None] = {}
            records = []
            exported_at = datetime.now(UTC).isoformat()

            for row in rows:
                d = dict(row)
                raw = d.pop("payload_json", None)
                try:
                    payload = json.loads(raw) if raw else None
                except Exception:
                    payload = None
                    d["payload_json"] = raw

                mid = d.get("memory_id")
                snap = None
                if include_snapshots and mid:
                    if mid not in snapshot_cache:
                        mrow = conn.execute(
                            "SELECT * FROM memories WHERE id = ?", (mid,)
                        ).fetchone()
                        snapshot_cache[mid] = dict(mrow) if mrow else None
                    snap = snapshot_cache[mid]

                records.append({
                    "schema_version":  "memory_activity.v1",
                    "exported_at":     exported_at,
                    "timestamp":       d.get("created_at"),
                    "event_id":        d.get("id"),
                    "event_type":      d.get("event_type"),
                    "event_subject":   d.get("event_subject"),
                    "memory_id":       mid,
                    "session_id":      d.get("session_id"),
                    "workflow":        workflow,
                    "payload":         payload,
                    "memory_snapshot": snap,
                    "diagnostic_tags": diagnostic_tags(
                        d.get("event_type", ""),
                        d.get("event_subject", ""),
                        payload,
                    ),
                })

        return records

    def export_state_snapshot(
        self,
        workflow: str = "chat",
        include_events: bool = True,
        event_limit: int = 100,
        include_superseded: bool = True,
        include_deleted: bool = False,
        include_vectors: bool = False,
    ) -> dict:
        """Return a point-in-time JSON snapshot of the memory system state."""
        from datetime import datetime, UTC
        from .context_pack import CONFIDENCE_INJECT_THRESHOLD

        exported_at = datetime.now(UTC).isoformat()
        summary = self.quality_summary(workflow)

        # Fetch memories
        clauses = ["(workflow = ? OR scope_type IN ('global','user'))"]
        params: list = [workflow]

        if not include_superseded:
            clauses.append("superseded_by IS NULL")
        if not include_deleted:
            clauses.append("deleted_at IS NULL")

        where = "WHERE " + " AND ".join(clauses)

        with self._conn() as conn:
            rows = conn.execute(
                f"""SELECT * FROM memories {where}
                    ORDER BY
                      CASE WHEN superseded_by IS NOT NULL THEN 2
                           WHEN deleted_at IS NOT NULL THEN 3
                           ELSE 1 END,
                      importance DESC, use_count DESC, created_at DESC""",
                params,
            ).fetchall()

        memories = []
        for row in rows:
            m = dict(row)
            if m.get("superseded_by"):
                status = "superseded"
                injectable = False
                reason = "superseded"
            elif m.get("deleted_at"):
                status = "deleted"
                injectable = False
                reason = "deleted"
            elif float(m.get("confidence", 0)) < CONFIDENCE_INJECT_THRESHOLD:
                status = "active"
                injectable = False
                reason = "low_confidence"
            else:
                status = "active"
                injectable = True
                reason = f"confidence>={CONFIDENCE_INJECT_THRESHOLD} and active"

            m["status"] = status
            m["agent_readiness"] = {"injectable": injectable, "reason": reason}
            memories.append(m)

        # Recent events
        recent_events = []
        if include_events:
            with self._conn() as conn:
                erows = conn.execute(
                    "SELECT * FROM memory_events ORDER BY created_at DESC LIMIT ?",
                    (event_limit,),
                ).fetchall()
            for row in erows:
                d = dict(row)
                raw = d.pop("payload_json", None)
                try:
                    d["payload"] = json.loads(raw) if raw else None
                except Exception:
                    d["payload"] = None
                d["timestamp"] = d.pop("created_at", None)
                d["diagnostic_tags"] = diagnostic_tags(
                    d.get("event_type", ""),
                    d.get("event_subject", ""),
                    d.get("payload"),
                )
                recent_events.append(d)

        # Vector health
        vector_health = None
        if include_vectors and self._vector_store is not None:
            try:
                from .embedding import DEFAULT_EMBED_MODEL
                vector_health = {
                    "enabled":         True,
                    "collection_name": self._vector_store.collection_info()["collection_name"],
                    "points_count":    self._vector_store.count(),
                    "embedding_model": DEFAULT_EMBED_MODEL,
                    "ready":           self._vector_store.is_ready(),
                }
            except Exception as exc:
                vector_health = {"enabled": True, "ready": False, "error": str(exc)[:200]}
        elif include_vectors:
            vector_health = {"enabled": False, "ready": False}

        # Diagnostics
        notes = [
            "This export is a point-in-time snapshot",
            "Use activity export for chronological event review",
        ]
        warnings: list[str] = []
        active = summary.get("active_memories", 0)
        never_used = summary.get("never_used", 0)
        low_conf = summary.get("low_confidence_stored", 0)
        fail_24h = summary.get("extraction_failures_24h", 0)

        if active > 0 and never_used / active > 0.5:
            warnings.append(f"{never_used} active memories have never been used")
        if low_conf > 0:
            warnings.append(f"{low_conf} memories stored below injection confidence threshold")
        if fail_24h > 0:
            warnings.append(f"{fail_24h} extraction failures in the last 24 hours")
        if vector_health and vector_health.get("enabled") and \
                vector_health.get("points_count", 0) < active:
            warnings.append("Vector store has fewer points than active memories")

        return {
            "schema_version": "memory_state.v1",
            "exported_at":    exported_at,
            "workflow":       workflow,
            "summary":        summary,
            "memories":       memories,
            "recent_events":  recent_events,
            "vector_health":  vector_health,
            "diagnostics":    {"notes": notes, "warnings": warnings},
        }


# ── Export utilities ─────────────────────────────────────────────────────────

def diagnostic_tags(
    event_type: str,
    event_subject: str,
    payload: dict | None,
) -> list[str]:
    """Return deterministic diagnostic tags for a memory event."""
    TAG_MAP: dict[str, list[str]] = {
        "vector_searched":       ["retrieval", "vector", "observe_only"],
        "vector_search_failed":  ["retrieval", "vector", "failure"],
        "retrieval_fallback":    ["retrieval", "fallback"],
        "searched":              ["retrieval", "fallback"],
        "injected":              ["injection", "usage"],
        "embedding_created":     ["ingestion", "vector"],
        "embedding_failed":      ["ingestion", "vector", "failure"],
        "extraction_failed":     ["extraction", "failure"],
        "parse_failed":          ["extraction", "failure", "parse"],
        "dedup_rejected":        ["dedup"],
        "consolidation_applied": ["consolidation", "mutation"],
        "consolidation_proposed":["consolidation"],
        "created":               ["ingestion"],
        "superseded":            ["mutation"],
        "deleted":               ["mutation"],
    }
    return TAG_MAP.get(event_type, [event_subject] if event_subject else [])


# ── FTS query sanitizer ───────────────────────────────────────────────────────

def _sanitize_fts_query(query: str) -> str:
    """
    Strip characters that cause FTS5 syntax errors.
    FTS5 uses double-quotes for phrase queries — an unmatched quote breaks the parser.
    Strategy: remove all double-quotes and leading/trailing FTS operators,
    then rejoin as space-separated tokens.
    """
    # Remove double-quotes entirely
    q = query.replace('"', '').replace("'", "")
    # Strip leading/trailing FTS boolean operators
    tokens = [t for t in q.split() if t.upper() not in ("AND", "OR", "NOT")]
    return " ".join(tokens).strip()
