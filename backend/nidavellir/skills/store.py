from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator

from .models import NidavellirSkill

DDL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL,
  activation_mode TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  instruction_json TEXT NOT NULL,
  required_capabilities_json TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  enabled INTEGER NOT NULL DEFAULT 0,
  show_in_slash INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  skill_json TEXT NOT NULL,
  change_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(skill_id, version),
  FOREIGN KEY(skill_id) REFERENCES skills(id)
);

CREATE TABLE IF NOT EXISTS skill_imports (
  id TEXT PRIMARY KEY,
  source_path TEXT,
  repository_url TEXT,
  detected_format TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  imported_skill_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(imported_skill_id) REFERENCES skills(id)
);

CREATE TABLE IF NOT EXISTS skill_activations (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  conversation_id TEXT,
  session_id TEXT,
  provider TEXT,
  model TEXT,
  trigger_reason TEXT NOT NULL,
  score REAL,
  matched_triggers_json TEXT,
  compatibility_status TEXT,
  diagnostic_json TEXT,
  token_estimate INTEGER,
  injected INTEGER NOT NULL DEFAULT 0,
  suppressed_reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(skill_id) REFERENCES skills(id)
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _json(value: object) -> str:
    return json.dumps(value, sort_keys=True)


class SkillStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = str(db_path)
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(DDL)
            self._migrate_schema(conn)

    def _migrate_schema(self, conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(skills)").fetchall()}
        if "show_in_slash" not in columns:
            conn.execute("ALTER TABLE skills ADD COLUMN show_in_slash INTEGER NOT NULL DEFAULT 0")

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create_skill(self, skill: NidavellirSkill, change_reason: str | None = None) -> NidavellirSkill:
        created = skill.created_at or _now()
        updated = skill.updated_at or created
        stored = skill.model_copy(update={"created_at": created, "updated_at": updated})
        data = stored.model_dump(mode="json")
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO skills
                   (id, slug, name, description, scope, activation_mode, trigger_json,
                    instruction_json, required_capabilities_json, priority, enabled,
                    show_in_slash, version, status, source_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    stored.id,
                    stored.slug,
                    stored.name,
                    stored.description,
                    stored.scope.value,
                    stored.activation_mode.value,
                    _json(data["triggers"]),
                    _json(data["instructions"]),
                    _json(data["required_capabilities"]),
                    stored.priority,
                    1 if stored.enabled else 0,
                    1 if stored.show_in_slash else 0,
                    stored.version,
                    stored.status.value,
                    _json(data["source"]),
                    created,
                    updated,
                ),
            )
            conn.execute(
                """INSERT INTO skill_versions
                   (id, skill_id, version, skill_json, change_reason, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (str(uuid.uuid4()), stored.id, stored.version, stored.model_dump_json(), change_reason, created),
            )
        return stored

    def _row_to_skill(self, row: sqlite3.Row) -> NidavellirSkill:
        return NidavellirSkill(
            id=row["id"],
            slug=row["slug"],
            name=row["name"],
            description=row["description"] or "",
            scope=row["scope"],
            activation_mode=row["activation_mode"],
            triggers=json.loads(row["trigger_json"]),
            instructions=json.loads(row["instruction_json"]),
            required_capabilities=json.loads(row["required_capabilities_json"]),
            priority=row["priority"],
            enabled=bool(row["enabled"]),
            show_in_slash=bool(row["show_in_slash"]),
            version=row["version"],
            status=row["status"],
            source=json.loads(row["source_json"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def get_skill(self, skill_id: str) -> NidavellirSkill | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM skills WHERE id = ?", (skill_id,)).fetchone()
        return self._row_to_skill(row) if row else None

    def list_skills(self) -> list[NidavellirSkill]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM skills ORDER BY updated_at DESC, name ASC").fetchall()
        return [self._row_to_skill(row) for row in rows]

    def set_enabled(self, skill_id: str, enabled: bool) -> NidavellirSkill:
        with self._conn() as conn:
            conn.execute(
                "UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?",
                (1 if enabled else 0, _now(), skill_id),
            )
        skill = self.get_skill(skill_id)
        if skill is None:
            raise KeyError(skill_id)
        return skill

    def set_show_in_slash(self, skill_id: str, show_in_slash: bool) -> NidavellirSkill:
        with self._conn() as conn:
            conn.execute(
                "UPDATE skills SET show_in_slash = ?, updated_at = ? WHERE id = ?",
                (1 if show_in_slash else 0, _now(), skill_id),
            )
        skill = self.get_skill(skill_id)
        if skill is None:
            raise KeyError(skill_id)
        return skill

    def log_import(self, *, source_path: str | None, repository_url: str | None, detected_format: str, status: str, error: str | None = None, imported_skill_id: str | None = None) -> str:
        import_id = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO skill_imports
                   (id, source_path, repository_url, detected_format, status, error, imported_skill_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (import_id, source_path, repository_url, detected_format, status, error, imported_skill_id, _now()),
            )
        return import_id

    def log_activation(
        self,
        *,
        skill_id: str,
        conversation_id: str | None,
        session_id: str | None,
        provider: str,
        model: str | None,
        trigger_reason: str,
        score: float | None,
        matched_triggers: list[str],
        compatibility_status: str,
        diagnostics: list[dict],
        token_estimate: int,
        injected: bool,
        suppressed_reason: str | None = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO skill_activations
                   (id, skill_id, conversation_id, session_id, provider, model,
                    trigger_reason, score, matched_triggers_json, compatibility_status,
                    diagnostic_json, token_estimate, injected, suppressed_reason, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()),
                    skill_id,
                    conversation_id,
                    session_id,
                    provider,
                    model,
                    trigger_reason,
                    score,
                    _json(matched_triggers),
                    compatibility_status,
                    _json(diagnostics),
                    token_estimate,
                    1 if injected else 0,
                    suppressed_reason,
                    _now(),
                ),
            )

    def list_activations(self, limit: int = 100) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM skill_activations ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]
