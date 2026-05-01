from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator

from .policy import PermissionEvaluationRequest, PermissionEvaluationResult

DDL = """
CREATE TABLE IF NOT EXISTS permission_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  path TEXT,
  normalized_path TEXT,
  command TEXT,
  actor TEXT NOT NULL,
  conversation_id TEXT,
  project_id TEXT,
  protected INTEGER NOT NULL DEFAULT 0,
  outside_workspace INTEGER NOT NULL DEFAULT 0,
  matched_rule TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class PermissionAuditStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = str(db_path)
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(DDL)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def log(self, request: PermissionEvaluationRequest, result: PermissionEvaluationResult) -> str:
        event_id = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO permission_audit_events
                   (id, action, decision, reason, path, normalized_path, command, actor,
                    conversation_id, project_id, protected, outside_workspace,
                    matched_rule, metadata_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    event_id,
                    result.action,
                    result.decision.value,
                    result.reason,
                    result.path,
                    result.normalized_path,
                    request.command,
                    request.actor,
                    request.conversation_id,
                    request.project_id,
                    1 if result.protected else 0,
                    1 if result.outside_workspace else 0,
                    result.matched_rule,
                    json.dumps(request.metadata, sort_keys=True),
                    _now(),
                ),
            )
        return event_id

    def list_events(self, limit: int = 100, conversation_id: str | None = None) -> list[dict]:
        with self._conn() as conn:
            if conversation_id:
                rows = conn.execute(
                    """SELECT * FROM permission_audit_events
                       WHERE conversation_id = ?
                       ORDER BY created_at DESC LIMIT ?""",
                    (conversation_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM permission_audit_events ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        events = []
        for row in rows:
            item = dict(row)
            raw = item.pop("metadata_json", "{}")
            try:
                item["metadata"] = json.loads(raw)
            except json.JSONDecodeError:
                item["metadata"] = {}
            item["protected"] = bool(item["protected"])
            item["outside_workspace"] = bool(item["outside_workspace"])
            events.append(item)
        return events
