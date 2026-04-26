from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from typing import Iterator

from .context_pack import CONFIDENCE_STORE_THRESHOLD

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
    archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id);

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
            conn.commit()
        finally:
            conn.close()

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
    ) -> dict:
        with self._conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO conversations
                   (id, workflow, model_id, provider_id)
                   VALUES (?, ?, ?, ?)""",
                (id, workflow, model_id, provider_id),
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
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO conversation_messages
                   (id, conversation_id, role, content)
                   VALUES (?, ?, ?, ?)""",
                (message_id, conversation_id, role, content),
            )

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
            "retrieval_fallback", "consolidation_applied", "consolidation_proposed",
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
