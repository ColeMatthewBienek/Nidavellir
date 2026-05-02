from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator

DDL = """
CREATE TABLE IF NOT EXISTS command_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  command TEXT NOT NULL,
  cwd TEXT NOT NULL,
  exit_code INTEGER,
  stdout TEXT NOT NULL,
  stderr TEXT NOT NULL,
  timed_out INTEGER NOT NULL DEFAULT 0,
  include_in_chat INTEGER NOT NULL DEFAULT 0,
  added_to_working_set INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class CommandRunStore:
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

    def create_run(
        self,
        *,
        run_id: str | None = None,
        conversation_id: str | None,
        command: str,
        cwd: str,
        exit_code: int | None,
        stdout: str,
        stderr: str,
        timed_out: bool,
        include_in_chat: bool,
        added_to_working_set: bool,
        duration_ms: int,
    ) -> dict:
        run_id = run_id or str(uuid.uuid4())
        created_at = _now()
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO command_runs
                   (id, conversation_id, command, cwd, exit_code, stdout, stderr,
                    timed_out, include_in_chat, added_to_working_set, duration_ms, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    conversation_id,
                    command,
                    cwd,
                    exit_code,
                    stdout,
                    stderr,
                    1 if timed_out else 0,
                    1 if include_in_chat else 0,
                    1 if added_to_working_set else 0,
                    duration_ms,
                    created_at,
                ),
            )
        return self.get_run(run_id) or {}

    def get_run(self, run_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM command_runs WHERE id = ?", (run_id,)).fetchone()
        return self._row(row) if row else None

    def list_runs(self, *, conversation_id: str | None = None, limit: int = 50) -> list[dict]:
        with self._conn() as conn:
            if conversation_id:
                rows = conn.execute(
                    "SELECT * FROM command_runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?",
                    (conversation_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM command_runs ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        return [self._row(row) for row in rows]

    def _row(self, row: sqlite3.Row) -> dict:
        item = dict(row)
        item["timed_out"] = bool(item["timed_out"])
        item["include_in_chat"] = bool(item["include_in_chat"])
        item["added_to_working_set"] = bool(item["added_to_working_set"])
        return item
