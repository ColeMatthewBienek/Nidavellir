from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator, Literal

from nidavellir.permissions.policy import PermissionEvaluationResult

ToolRequestStatus = Literal["pending", "approved", "executed", "denied", "observed", "failed"]

DDL = """
CREATE TABLE IF NOT EXISTS tool_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  provider TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  path TEXT,
  command TEXT,
  workspace TEXT,
  arguments_json TEXT NOT NULL,
  permission_json TEXT,
  execution_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  continued_at TEXT
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class ToolRequestStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = str(db_path)
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(DDL)
            self._ensure_columns(conn)

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

    def _ensure_columns(self, conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(tool_requests)").fetchall()}
        if "execution_json" not in columns:
            conn.execute("ALTER TABLE tool_requests ADD COLUMN execution_json TEXT")
        if "continued_at" not in columns:
            conn.execute("ALTER TABLE tool_requests ADD COLUMN continued_at TEXT")

    def create(
        self,
        *,
        conversation_id: str | None,
        provider: str,
        tool_name: str,
        action: str,
        status: ToolRequestStatus,
        path: str | None = None,
        command: str | None = None,
        workspace: str | None = None,
        arguments: object | None = None,
        permission: PermissionEvaluationResult | None = None,
        reason: str | None = None,
    ) -> dict:
        request_id = str(uuid.uuid4())
        created_at = _now()
        permission_json = permission.model_dump_json() if permission is not None else None
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO tool_requests
                   (id, conversation_id, provider, tool_name, action, status, path, command,
                    workspace, arguments_json, permission_json, execution_json, reason, created_at, resolved_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    request_id,
                    conversation_id,
                    provider,
                    tool_name,
                    action,
                    status,
                    path,
                    command,
                    workspace,
                    json.dumps(arguments or {}, sort_keys=True),
                    permission_json,
                    None,
                    reason,
                    created_at,
                    created_at if status in {"approved", "executed", "denied", "observed", "failed"} else None,
                ),
            )
        return self.get(request_id) or {}

    def get(self, request_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM tool_requests WHERE id = ?", (request_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def list(self, *, conversation_id: str | None = None, limit: int = 100) -> list[dict]:
        with self._conn() as conn:
            if conversation_id:
                rows = conn.execute(
                    """SELECT * FROM tool_requests
                       WHERE conversation_id = ?
                       ORDER BY created_at DESC LIMIT ?""",
                    (conversation_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM tool_requests ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def resolve(
        self,
        request_id: str,
        status: Literal["approved", "executed", "denied", "failed"],
        reason: str | None = None,
        execution: object | None = None,
    ) -> dict | None:
        with self._conn() as conn:
            conn.execute(
                """UPDATE tool_requests
                   SET status = ?, reason = COALESCE(?, reason), execution_json = COALESCE(?, execution_json), resolved_at = ?
                   WHERE id = ? AND status = 'pending'""",
                (
                    status,
                    reason,
                    json.dumps(execution, sort_keys=True) if execution is not None else None,
                    _now(),
                    request_id,
                ),
            )
        return self.get(request_id)

    def mark_continued(self, request_id: str) -> dict | None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE tool_requests SET continued_at = ? WHERE id = ?",
                (_now(), request_id),
            )
        return self.get(request_id)

    def _row_to_dict(self, row: sqlite3.Row) -> dict:
        item = dict(row)
        for key in ("arguments_json", "permission_json", "execution_json"):
            raw = item.pop(key, None)
            output_key = {
                "arguments_json": "arguments",
                "permission_json": "permission",
                "execution_json": "execution",
            }[key]
            if not raw:
                item[output_key] = {} if key == "arguments_json" else None
                continue
            try:
                item[output_key] = json.loads(raw)
            except json.JSONDecodeError:
                item[output_key] = {} if key == "arguments_json" else None
        return item
