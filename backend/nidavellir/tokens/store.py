from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, UTC
from typing import Iterator


_DDL = """
CREATE TABLE IF NOT EXISTS token_usage_records (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,

  preflight_input_tokens INTEGER,
  preflight_source TEXT,

  reported_input_tokens INTEGER,
  reported_output_tokens INTEGER,
  reported_total_tokens INTEGER,

  cached_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  reasoning_tokens INTEGER,

  discrepancy_pct REAL,
  suspect INTEGER NOT NULL DEFAULT 0,

  stop_reason TEXT,
  finish_reason TEXT,
  incomplete_reason TEXT,

  anomaly INTEGER NOT NULL DEFAULT 0,
  anomaly_types TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_usage_session_time
  ON token_usage_records(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_token_usage_provider_model_time
  ON token_usage_records(provider, model, created_at);

CREATE INDEX IF NOT EXISTS idx_token_usage_created_at
  ON token_usage_records(created_at);
"""


class TokenUsageStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._init_schema()

    def _init_schema(self) -> None:
        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.executescript(_DDL)
            conn.commit()
        finally:
            conn.close()

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

    def insert(self, rec: dict) -> None:
        now = datetime.now(UTC).isoformat()
        with self._conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO token_usage_records
                   (id, request_id, session_id, provider, model,
                    preflight_input_tokens, preflight_source,
                    reported_input_tokens, reported_output_tokens, reported_total_tokens,
                    cached_input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
                    reasoning_tokens, discrepancy_pct, suspect,
                    stop_reason, finish_reason, incomplete_reason,
                    anomaly, anomaly_types, created_at, updated_at)
                   VALUES
                   (:id, :request_id, :session_id, :provider, :model,
                    :preflight_input_tokens, :preflight_source,
                    :reported_input_tokens, :reported_output_tokens, :reported_total_tokens,
                    :cached_input_tokens, :cache_creation_input_tokens, :cache_read_input_tokens,
                    :reasoning_tokens, :discrepancy_pct, :suspect,
                    :stop_reason, :finish_reason, :incomplete_reason,
                    :anomaly, :anomaly_types, :created_at, :updated_at)""",
                {
                    "id":                         rec.get("id", str(uuid.uuid4())),
                    "request_id":                 rec["request_id"],
                    "session_id":                 rec["session_id"],
                    "provider":                   rec["provider"],
                    "model":                      rec["model"],
                    "preflight_input_tokens":     rec.get("preflight_input_tokens"),
                    "preflight_source":           rec.get("preflight_source"),
                    "reported_input_tokens":      rec.get("reported_input_tokens"),
                    "reported_output_tokens":     rec.get("reported_output_tokens"),
                    "reported_total_tokens":      rec.get("reported_total_tokens"),
                    "cached_input_tokens":        rec.get("cached_input_tokens"),
                    "cache_creation_input_tokens": rec.get("cache_creation_input_tokens"),
                    "cache_read_input_tokens":    rec.get("cache_read_input_tokens"),
                    "reasoning_tokens":           rec.get("reasoning_tokens"),
                    "discrepancy_pct":            rec.get("discrepancy_pct"),
                    "suspect":                    1 if rec.get("suspect") else 0,
                    "stop_reason":                rec.get("stop_reason"),
                    "finish_reason":              rec.get("finish_reason"),
                    "incomplete_reason":          rec.get("incomplete_reason"),
                    "anomaly":                    1 if rec.get("anomaly") else 0,
                    "anomaly_types":              json.dumps(rec["anomaly_types"]) if rec.get("anomaly_types") else None,
                    "created_at":                 rec.get("created_at", now),
                    "updated_at":                 rec.get("updated_at", now),
                },
            )

    def update(self, record_id: str, updates: dict) -> None:
        if not updates:
            return
        now = datetime.now(UTC).isoformat()
        updates = dict(updates)
        updates["updated_at"] = now
        if "suspect" in updates:
            updates["suspect"] = 1 if updates["suspect"] else 0
        if "anomaly" in updates:
            updates["anomaly"] = 1 if updates["anomaly"] else 0
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [record_id]
        with self._conn() as conn:
            conn.execute(
                f"UPDATE token_usage_records SET {set_clause} WHERE id = ?",
                values,
            )

    def update_by_request_id(self, request_id: str, updates: dict) -> None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id FROM token_usage_records WHERE request_id = ?", (request_id,)
            ).fetchone()
        if row:
            self.update(row["id"], updates)

    def get_by_session(self, session_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM token_usage_records WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_by_provider_model(self, provider: str, model: str, limit: int = 500) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM token_usage_records
                   WHERE provider = ? AND model = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (provider, model, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def session_totals(self, session_id: str) -> dict:
        with self._conn() as conn:
            row = conn.execute(
                """SELECT
                     COALESCE(SUM(reported_input_tokens), 0)  AS total_input,
                     COALESCE(SUM(reported_output_tokens), 0) AS total_output,
                     COALESCE(SUM(reported_total_tokens), 0)  AS total_combined,
                     COUNT(*) AS record_count
                   FROM token_usage_records WHERE session_id = ?""",
                (session_id,),
            ).fetchone()
        return dict(row) if row else {"total_input": 0, "total_output": 0, "total_combined": 0, "record_count": 0}

    def export_range(self, hours: int = 24, limit: int = 10_000) -> list[dict]:
        if hours <= 0:
            cutoff = "1970-01-01T00:00:00+00:00"
        else:
            cutoff = (datetime.now(UTC) - timedelta(hours=hours)).isoformat()
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM token_usage_records
                   WHERE created_at >= ?
                   ORDER BY created_at DESC LIMIT ?""",
                (cutoff, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def provider_summary(self) -> list[dict]:
        """Aggregate usage by provider+model, ordered by total tokens desc."""
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT provider, model,
                     COALESCE(SUM(reported_input_tokens), 0)  AS total_input,
                     COALESCE(SUM(reported_output_tokens), 0) AS total_output,
                     COUNT(*) AS request_count,
                     MAX(created_at) AS last_used
                   FROM token_usage_records
                   GROUP BY provider, model
                   ORDER BY total_input + total_output DESC""",
            ).fetchall()
        return [dict(r) for r in rows]

    def rolling_window(self, hours: int = 5) -> dict:
        cutoff = (datetime.now(UTC) - timedelta(hours=hours)).isoformat()
        with self._conn() as conn:
            row = conn.execute(
                """SELECT
                     COALESCE(SUM(reported_input_tokens), 0)  AS total_input,
                     COALESCE(SUM(reported_output_tokens), 0) AS total_output,
                     COUNT(*) AS request_count
                   FROM token_usage_records WHERE created_at >= ?""",
                (cutoff,),
            ).fetchone()
        return dict(row) if row else {"total_input": 0, "total_output": 0, "request_count": 0}

    def daily_totals(self) -> dict:
        today = datetime.now(UTC).date().isoformat()
        with self._conn() as conn:
            row = conn.execute(
                """SELECT
                     COALESCE(SUM(reported_input_tokens), 0)  AS total_input,
                     COALESCE(SUM(reported_output_tokens), 0) AS total_output,
                     COUNT(*) AS request_count
                   FROM token_usage_records
                   WHERE created_at >= ?""",
                (today,),
            ).fetchone()
        return dict(row) if row else {"total_input": 0, "total_output": 0, "request_count": 0}
