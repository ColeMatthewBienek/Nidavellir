from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

DDL = """
CREATE TABLE IF NOT EXISTS orchestration_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority INTEGER,
  labels_json TEXT NOT NULL DEFAULT '[]',
  conversation_id TEXT,
  base_repo_path TEXT,
  base_branch TEXT,
  task_branch TEXT,
  worktree_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_nodes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started',
  provider TEXT,
  model TEXT,
  skill_ids_json TEXT NOT NULL DEFAULT '[]',
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_edges (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  from_node_id TEXT NOT NULL REFERENCES orchestration_nodes(id) ON DELETE CASCADE,
  to_node_id TEXT NOT NULL REFERENCES orchestration_nodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, from_node_id, to_node_id)
);

CREATE TABLE IF NOT EXISTS orchestration_steps (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES orchestration_nodes(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  config_json TEXT NOT NULL DEFAULT '{}',
  output_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_run_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES orchestration_nodes(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES orchestration_steps(id) ON DELETE CASCADE,
  conversation_id TEXT,
  provider TEXT,
  model TEXT,
  worktree_path TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS orchestration_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES orchestration_nodes(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES orchestration_steps(id) ON DELETE CASCADE,
  run_attempt_id TEXT REFERENCES orchestration_run_attempts(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_worktrees (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES orchestration_nodes(id) ON DELETE CASCADE,
  repo_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'execution',
  base_branch TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_commit TEXT,
  head_commit TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  dirty_count INTEGER NOT NULL DEFAULT 0,
  dirty_summary_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(worktree_path)
);

CREATE TABLE IF NOT EXISTS orchestration_events (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES orchestration_nodes(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES orchestration_steps(id) ON DELETE CASCADE,
  run_attempt_id TEXT REFERENCES orchestration_run_attempts(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orchestration_nodes_task_id ON orchestration_nodes(task_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_edges_task_id ON orchestration_edges(task_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_steps_node_id ON orchestration_steps(node_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_events_task_id ON orchestration_events(task_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_worktrees_task_id ON orchestration_worktrees(task_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_worktrees_node_id ON orchestration_worktrees(node_id);
"""

TASK_STATUSES = {"backlog", "ready", "running", "review", "done", "blocked", "cancelled"}
NODE_STATUSES = {"not_started", "ready", "running", "blocked", "failed", "complete", "skipped", "cancelled"}
STEP_STATUSES = {"pending", "ready", "running", "waiting_for_user", "failed", "complete", "skipped", "cancelled"}
STEP_TYPES = {"manual", "agent", "command", "review", "gate", "artifact", "handoff"}
WORKTREE_STATUSES = {"created", "clean", "dirty", "missing", "removed", "error"}
WORKTREE_KINDS = {"task", "execution", "integration"}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, sort_keys=True)


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


class OrchestrationStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = str(db_path)
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.executescript(DDL)
            self._migrate(conn)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(orchestration_worktrees)").fetchall()}
        if "kind" not in columns:
            conn.execute("ALTER TABLE orchestration_worktrees ADD COLUMN kind TEXT NOT NULL DEFAULT 'execution'")
            conn.execute("UPDATE orchestration_worktrees SET kind = 'task' WHERE node_id IS NULL")

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create_task(
        self,
        *,
        title: str,
        description: str = "",
        status: str = "backlog",
        priority: int | None = None,
        labels: list[str] | None = None,
        conversation_id: str | None = None,
        base_repo_path: str | None = None,
        base_branch: str | None = None,
        task_branch: str | None = None,
        worktree_path: str | None = None,
    ) -> dict:
        self._require_status(status, TASK_STATUSES, "task_status")
        task_id = str(uuid.uuid4())
        now = _now()
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO orchestration_tasks
                   (id, title, description, status, priority, labels_json, conversation_id,
                    base_repo_path, base_branch, task_branch, worktree_path, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    task_id,
                    title.strip(),
                    description,
                    status,
                    priority,
                    _json_dumps(labels or []),
                    conversation_id,
                    base_repo_path,
                    base_branch,
                    task_branch,
                    worktree_path,
                    now,
                    now,
                ),
            )
        self.append_event(task_id=task_id, type="task_created", payload={"title": title.strip(), "status": status})
        return self.get_task(task_id) or {}

    def list_tasks(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM orchestration_tasks ORDER BY updated_at DESC").fetchall()
        return [self._task_row(row) for row in rows]

    def get_task(self, task_id: str) -> dict | None:
        with self._conn() as conn:
            task = conn.execute("SELECT * FROM orchestration_tasks WHERE id = ?", (task_id,)).fetchone()
            if not task:
                return None
            nodes = conn.execute("SELECT * FROM orchestration_nodes WHERE task_id = ? ORDER BY created_at ASC", (task_id,)).fetchall()
            edges = conn.execute("SELECT * FROM orchestration_edges WHERE task_id = ? ORDER BY created_at ASC", (task_id,)).fetchall()
            steps = conn.execute(
                """SELECT s.* FROM orchestration_steps s
                   JOIN orchestration_nodes n ON n.id = s.node_id
                   WHERE n.task_id = ?
                   ORDER BY s.node_id ASC, s.order_index ASC, s.created_at ASC""",
                (task_id,),
            ).fetchall()
            worktrees = conn.execute("SELECT * FROM orchestration_worktrees WHERE task_id = ? ORDER BY created_at ASC", (task_id,)).fetchall()
        item = self._task_row(task)
        item["nodes"] = [self._node_row(row) for row in nodes]
        item["edges"] = [self._edge_row(row) for row in edges]
        item["steps"] = [self._step_row(row) for row in steps]
        item["worktrees"] = [self._worktree_row(row) for row in worktrees]
        item["readiness"] = self.calculate_readiness(task_id)
        return item

    def update_task(self, task_id: str, updates: dict[str, Any]) -> dict | None:
        allowed = {
            "title", "description", "status", "priority", "labels", "conversation_id",
            "base_repo_path", "base_branch", "task_branch", "worktree_path",
        }
        values = {key: value for key, value in updates.items() if key in allowed}
        if not values:
            return self.get_task(task_id)
        if "status" in values:
            self._require_status(values["status"], TASK_STATUSES, "task_status")
        assignments = []
        params: list[Any] = []
        for key, value in values.items():
            column = "labels_json" if key == "labels" else key
            assignments.append(f"{column} = ?")
            params.append(_json_dumps(value or []) if key == "labels" else value)
        assignments.append("updated_at = ?")
        params.append(_now())
        params.append(task_id)
        with self._conn() as conn:
            conn.execute(f"UPDATE orchestration_tasks SET {', '.join(assignments)} WHERE id = ?", params)
        self.append_event(task_id=task_id, type="task_updated", payload=values)
        return self.get_task(task_id)

    def create_node(
        self,
        *,
        task_id: str,
        title: str,
        description: str = "",
        status: str = "not_started",
        provider: str | None = None,
        model: str | None = None,
        skill_ids: list[str] | None = None,
        position_x: float = 0,
        position_y: float = 0,
    ) -> dict:
        self._require_task(task_id)
        self._require_status(status, NODE_STATUSES, "node_status")
        node_id = str(uuid.uuid4())
        now = _now()
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO orchestration_nodes
                   (id, task_id, title, description, status, provider, model, skill_ids_json,
                    position_x, position_y, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    node_id,
                    task_id,
                    title.strip(),
                    description,
                    status,
                    provider,
                    model,
                    _json_dumps(skill_ids or []),
                    position_x,
                    position_y,
                    now,
                    now,
                ),
            )
        self.append_event(task_id=task_id, node_id=node_id, type="node_added", payload={"title": title.strip()})
        self.recalculate_task_readiness(task_id)
        return self.get_node(node_id) or {}

    def get_node(self, node_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM orchestration_nodes WHERE id = ?", (node_id,)).fetchone()
        return self._node_row(row) if row else None

    def update_node(self, node_id: str, updates: dict[str, Any]) -> dict | None:
        node = self.get_node(node_id)
        if not node:
            return None
        allowed = {
            "title", "description", "status", "provider", "model", "skill_ids",
            "position_x", "position_y",
        }
        values = {key: value for key, value in updates.items() if key in allowed}
        if not values:
            return node
        if "status" in values:
            self._require_status(values["status"], NODE_STATUSES, "node_status")
        assignments = []
        params: list[Any] = []
        for key, value in values.items():
            column = "skill_ids_json" if key == "skill_ids" else key
            assignments.append(f"{column} = ?")
            params.append(_json_dumps(value or []) if key == "skill_ids" else value)
        assignments.append("updated_at = ?")
        params.append(_now())
        params.append(node_id)
        with self._conn() as conn:
            conn.execute(f"UPDATE orchestration_nodes SET {', '.join(assignments)} WHERE id = ?", params)
        self.append_event(task_id=node["task_id"], node_id=node_id, type="node_updated", payload=values)
        self.recalculate_task_readiness(node["task_id"])
        return self.get_node(node_id)

    def create_edge(self, *, task_id: str, from_node_id: str, to_node_id: str) -> dict:
        self._require_task(task_id)
        from_node = self._require_node(from_node_id)
        to_node = self._require_node(to_node_id)
        if from_node["task_id"] != task_id or to_node["task_id"] != task_id:
            raise ValueError("edge_nodes_must_belong_to_task")
        if from_node_id == to_node_id:
            raise ValueError("edge_cannot_self_reference")
        if self._would_create_cycle(task_id, from_node_id, to_node_id):
            raise ValueError("edge_would_create_cycle")
        edge_id = str(uuid.uuid4())
        created_at = _now()
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO orchestration_edges
                   (id, task_id, from_node_id, to_node_id, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (edge_id, task_id, from_node_id, to_node_id, created_at),
            )
        self.append_event(
            task_id=task_id,
            type="edge_added",
            payload={"from_node_id": from_node_id, "to_node_id": to_node_id},
        )
        self.recalculate_task_readiness(task_id)
        return self.get_edge(edge_id) or {}

    def get_edge(self, edge_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM orchestration_edges WHERE id = ?", (edge_id,)).fetchone()
        return self._edge_row(row) if row else None

    def delete_edge(self, edge_id: str) -> bool:
        edge = self.get_edge(edge_id)
        if not edge:
            return False
        with self._conn() as conn:
            conn.execute("DELETE FROM orchestration_edges WHERE id = ?", (edge_id,))
        self.append_event(
            task_id=edge["task_id"],
            type="edge_removed",
            payload={"from_node_id": edge["from_node_id"], "to_node_id": edge["to_node_id"]},
        )
        self.recalculate_task_readiness(edge["task_id"])
        return True

    def create_step(
        self,
        *,
        node_id: str,
        title: str,
        type: str = "manual",
        description: str = "",
        status: str = "pending",
        config: dict | None = None,
        output_summary: str = "",
        order_index: int | None = None,
    ) -> dict:
        node = self._require_node(node_id)
        self._require_status(type, STEP_TYPES, "step_type")
        self._require_status(status, STEP_STATUSES, "step_status")
        if order_index is None:
            order_index = self._next_step_order(node_id)
        step_id = str(uuid.uuid4())
        now = _now()
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO orchestration_steps
                   (id, node_id, order_index, type, title, description, status,
                    config_json, output_summary, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    step_id,
                    node_id,
                    order_index,
                    type,
                    title.strip(),
                    description,
                    status,
                    _json_dumps(config or {}),
                    output_summary,
                    now,
                    now,
                ),
            )
        self.append_event(
            task_id=node["task_id"],
            node_id=node_id,
            step_id=step_id,
            type="step_added",
            payload={"title": title.strip(), "step_type": type},
        )
        self.recalculate_task_readiness(node["task_id"])
        return self.get_step(step_id) or {}

    def get_step(self, step_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM orchestration_steps WHERE id = ?", (step_id,)).fetchone()
        return self._step_row(row) if row else None

    def update_step(
        self,
        step_id: str,
        updates: dict[str, Any],
    ) -> dict | None:
        step = self.get_step(step_id)
        if not step:
            return None
        node = self._require_node(step["node_id"])
        allowed = {"title", "type", "description", "status", "config", "output_summary", "order_index"}
        values = {key: value for key, value in updates.items() if key in allowed}
        if not values:
            return step
        if "type" in values:
            self._require_status(values["type"], STEP_TYPES, "step_type")
        if "status" in values:
            self._require_status(values["status"], STEP_STATUSES, "step_status")
        assignments = []
        params: list[Any] = []
        for key, value in values.items():
            column = "config_json" if key == "config" else key
            assignments.append(f"{column} = ?")
            params.append(_json_dumps(value or {}) if key == "config" else value)
        assignments.append("updated_at = ?")
        params.append(_now())
        params.append(step_id)
        with self._conn() as conn:
            conn.execute(f"UPDATE orchestration_steps SET {', '.join(assignments)} WHERE id = ?", params)
        self.append_event(
            task_id=node["task_id"],
            node_id=node["id"],
            step_id=step_id,
            type="step_updated",
            payload=values,
        )
        self.recalculate_task_readiness(node["task_id"])
        return self.get_step(step_id)

    def update_step_status(self, step_id: str, status: str, output_summary: str | None = None) -> dict | None:
        self._require_status(status, STEP_STATUSES, "step_status")
        step = self.get_step(step_id)
        if not step:
            return None
        node = self._require_node(step["node_id"])
        with self._conn() as conn:
            conn.execute(
                """UPDATE orchestration_steps
                   SET status = ?, output_summary = COALESCE(?, output_summary), updated_at = ?
                   WHERE id = ?""",
                (status, output_summary, _now(), step_id),
            )
        self.append_event(
            task_id=node["task_id"],
            node_id=node["id"],
            step_id=step_id,
            type="step_status_changed",
            payload={"status": status, "output_summary": output_summary},
        )
        self.recalculate_task_readiness(node["task_id"])
        return self.get_step(step_id)

    def find_worktree_for_node(self, *, task_id: str, node_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                """SELECT * FROM orchestration_worktrees
                   WHERE task_id = ? AND node_id = ? AND kind = 'execution' AND status != 'removed'
                   ORDER BY created_at DESC LIMIT 1""",
                (task_id, node_id),
            ).fetchone()
            if row:
                return self._worktree_row(row)
            fallback = conn.execute(
                """SELECT * FROM orchestration_worktrees
                   WHERE task_id = ? AND node_id IS NULL AND kind = 'task' AND status != 'removed'
                   ORDER BY created_at DESC LIMIT 1""",
                (task_id,),
            ).fetchone()
        return self._worktree_row(fallback) if fallback else None

    def create_run_attempt(
        self,
        *,
        task_id: str,
        node_id: str | None = None,
        step_id: str | None = None,
        conversation_id: str | None = None,
        provider: str | None = None,
        model: str | None = None,
        worktree_path: str | None = None,
        status: str = "queued",
    ) -> dict:
        attempt_id = str(uuid.uuid4())
        now = _now()
        started_at = now if status == "running" else None
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO orchestration_run_attempts
                   (id, task_id, node_id, step_id, conversation_id, provider, model,
                    worktree_path, status, started_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    attempt_id,
                    task_id,
                    node_id,
                    step_id,
                    conversation_id,
                    provider,
                    model,
                    worktree_path,
                    status,
                    started_at,
                ),
            )
        self.append_event(
            task_id=task_id,
            node_id=node_id,
            step_id=step_id,
            run_attempt_id=attempt_id,
            type="run_attempt_created",
            payload={"provider": provider, "model": model, "status": status},
        )
        return self.get_run_attempt(attempt_id) or {}

    def update_run_attempt(
        self,
        attempt_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> dict | None:
        attempt = self.get_run_attempt(attempt_id)
        if not attempt:
            return None
        completed_at = _now() if status in {"completed", "failed", "cancelled"} else None
        started_at = attempt.get("started_at") or (_now() if status == "running" else None)
        with self._conn() as conn:
            conn.execute(
                """UPDATE orchestration_run_attempts
                   SET status = ?, error = COALESCE(?, error), started_at = COALESCE(started_at, ?),
                       completed_at = COALESCE(?, completed_at)
                   WHERE id = ?""",
                (status, error, started_at, completed_at, attempt_id),
            )
        self.append_event(
            task_id=attempt["task_id"],
            node_id=attempt["node_id"],
            step_id=attempt["step_id"],
            run_attempt_id=attempt_id,
            type="run_attempt_updated",
            payload={"status": status, "error": error},
        )
        return self.get_run_attempt(attempt_id)

    def get_run_attempt(self, attempt_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM orchestration_run_attempts WHERE id = ?", (attempt_id,)).fetchone()
        return dict(row) if row else None

    def create_worktree(
        self,
        *,
        task_id: str,
        repo_path: str,
        worktree_path: str,
        base_branch: str,
        branch_name: str,
        node_id: str | None = None,
        kind: str = "execution",
        base_commit: str | None = None,
        head_commit: str | None = None,
        status: str = "created",
        dirty_count: int = 0,
        dirty_summary: list[dict] | None = None,
    ) -> dict:
        self._require_task(task_id)
        if node_id:
            node = self._require_node(node_id)
            if node["task_id"] != task_id:
                raise ValueError("worktree_node_must_belong_to_task")
        self._require_status(status, WORKTREE_STATUSES, "worktree_status")
        self._require_status(kind, WORKTREE_KINDS, "worktree_kind")
        worktree_id = str(uuid.uuid4())
        now = _now()
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO orchestration_worktrees
                   (id, task_id, node_id, repo_path, worktree_path, kind, base_branch, branch_name,
                    base_commit, head_commit, status, dirty_count, dirty_summary_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    worktree_id,
                    task_id,
                    node_id,
                    repo_path,
                    worktree_path,
                    kind,
                    base_branch,
                    branch_name,
                    base_commit,
                    head_commit,
                    status,
                    dirty_count,
                    _json_dumps(dirty_summary or []),
                    now,
                    now,
                ),
            )
        if kind == "task" and node_id is None:
            self.update_task(task_id, {"base_repo_path": repo_path, "base_branch": base_branch, "task_branch": branch_name, "worktree_path": worktree_path})
        self.append_event(
            task_id=task_id,
            node_id=node_id,
            type="worktree_created",
            payload={"branch_name": branch_name, "worktree_path": worktree_path, "kind": kind, "status": status},
        )
        return self.get_worktree(worktree_id) or {}

    def list_worktrees(self, task_id: str | None = None) -> list[dict]:
        with self._conn() as conn:
            if task_id:
                rows = conn.execute("SELECT * FROM orchestration_worktrees WHERE task_id = ? ORDER BY created_at ASC", (task_id,)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM orchestration_worktrees ORDER BY updated_at DESC").fetchall()
        return [self._worktree_row(row) for row in rows]

    def get_worktree(self, worktree_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM orchestration_worktrees WHERE id = ?", (worktree_id,)).fetchone()
        return self._worktree_row(row) if row else None

    def update_worktree(self, worktree_id: str, updates: dict[str, Any]) -> dict | None:
        worktree = self.get_worktree(worktree_id)
        if not worktree:
            return None
        allowed = {"head_commit", "status", "dirty_count", "dirty_summary", "worktree_path", "branch_name", "base_branch", "kind"}
        values = {key: value for key, value in updates.items() if key in allowed}
        if not values:
            return worktree
        if "status" in values:
            self._require_status(values["status"], WORKTREE_STATUSES, "worktree_status")
        if "kind" in values:
            self._require_status(values["kind"], WORKTREE_KINDS, "worktree_kind")
        assignments = []
        params: list[Any] = []
        for key, value in values.items():
            column = "dirty_summary_json" if key == "dirty_summary" else key
            assignments.append(f"{column} = ?")
            params.append(_json_dumps(value or []) if key == "dirty_summary" else value)
        assignments.append("updated_at = ?")
        params.append(_now())
        params.append(worktree_id)
        with self._conn() as conn:
            conn.execute(f"UPDATE orchestration_worktrees SET {', '.join(assignments)} WHERE id = ?", params)
        self.append_event(
            task_id=worktree["task_id"],
            node_id=worktree["node_id"],
            type="worktree_updated",
            payload=values,
        )
        return self.get_worktree(worktree_id)

    def mark_worktree_removed(self, worktree_id: str) -> dict | None:
        worktree = self.get_worktree(worktree_id)
        if not worktree:
            return None
        updated = self.update_worktree(worktree_id, {"status": "removed", "dirty_count": 0, "dirty_summary": []})
        self.append_event(
            task_id=worktree["task_id"],
            node_id=worktree["node_id"],
            type="worktree_removed",
            payload={"branch_name": worktree["branch_name"], "worktree_path": worktree["worktree_path"]},
        )
        return updated

    def append_event(
        self,
        *,
        type: str,
        payload: dict | None = None,
        task_id: str | None = None,
        node_id: str | None = None,
        step_id: str | None = None,
        run_attempt_id: str | None = None,
    ) -> dict:
        event_id = str(uuid.uuid4())
        created_at = _now()
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO orchestration_events
                   (id, task_id, node_id, step_id, run_attempt_id, type, payload_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (event_id, task_id, node_id, step_id, run_attempt_id, type, _json_dumps(payload or {}), created_at),
            )
        return self.get_event(event_id) or {}

    def get_event(self, event_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM orchestration_events WHERE id = ?", (event_id,)).fetchone()
        return self._event_row(row) if row else None

    def list_events(self, *, task_id: str | None = None, limit: int = 100) -> list[dict]:
        with self._conn() as conn:
            if task_id:
                rows = conn.execute(
                    "SELECT * FROM orchestration_events WHERE task_id = ? ORDER BY created_at DESC LIMIT ?",
                    (task_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM orchestration_events ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        return [self._event_row(row) for row in rows]

    def calculate_readiness(self, task_id: str) -> dict:
        with self._conn() as conn:
            node_rows = conn.execute("SELECT * FROM orchestration_nodes WHERE task_id = ?", (task_id,)).fetchall()
            edge_rows = conn.execute("SELECT * FROM orchestration_edges WHERE task_id = ?", (task_id,)).fetchall()
            step_rows = conn.execute(
                """SELECT s.* FROM orchestration_steps s
                   JOIN orchestration_nodes n ON n.id = s.node_id
                   WHERE n.task_id = ?
                   ORDER BY s.node_id ASC, s.order_index ASC, s.created_at ASC""",
                (task_id,),
            ).fetchall()
        nodes = [self._node_row(row) for row in node_rows]
        edges = [self._edge_row(row) for row in edge_rows]
        steps_by_node: dict[str, list[dict]] = {}
        for row in step_rows:
            step = self._step_row(row)
            steps_by_node.setdefault(step["node_id"], []).append(step)
        terminal_complete = {"complete", "skipped"}
        node_status = {}
        for node in nodes:
            node_steps = steps_by_node.get(node["id"], [])
            if node_steps and all(step["status"] in terminal_complete for step in node_steps):
                node_status[node["id"]] = "complete"
            else:
                node_status[node["id"]] = node["status"]
        blocked_by = {
            node["id"]: [
                edge["from_node_id"] for edge in edges
                if edge["to_node_id"] == node["id"] and node_status.get(edge["from_node_id"]) not in terminal_complete
            ]
            for node in nodes
        }
        runnable = []
        for node in nodes:
            node_steps = steps_by_node.get(node["id"], [])
            first_open = next((step for step in node_steps if step["status"] not in terminal_complete), None)
            if not blocked_by[node["id"]] and node["status"] not in {"complete", "skipped", "cancelled"} and first_open:
                runnable.append({
                    "node_id": node["id"],
                    "step_id": first_open["id"],
                    "step_type": first_open["type"],
                })
        return {
            "runnable": runnable,
            "blocked": [{"node_id": node_id, "blocked_by": deps} for node_id, deps in blocked_by.items() if deps],
        }

    def recalculate_task_readiness(self, task_id: str) -> None:
        readiness = self.calculate_readiness(task_id)
        runnable_node_ids = {item["node_id"] for item in readiness["runnable"]}
        blocked_node_ids = {item["node_id"] for item in readiness["blocked"]}
        with self._conn() as conn:
            rows = conn.execute("SELECT id, status FROM orchestration_nodes WHERE task_id = ?", (task_id,)).fetchall()
            for row in rows:
                current = row["status"]
                if current in {"running", "failed", "complete", "skipped", "cancelled"}:
                    if current != "complete":
                        continue
                steps = conn.execute(
                    "SELECT status FROM orchestration_steps WHERE node_id = ? ORDER BY order_index ASC",
                    (row["id"],),
                ).fetchall()
                if steps and all(step["status"] in {"complete", "skipped"} for step in steps):
                    next_status = "complete"
                elif row["id"] in blocked_node_ids:
                    next_status = "blocked"
                elif row["id"] in runnable_node_ids:
                    next_status = "ready"
                else:
                    next_status = "not_started"
                if next_status != current:
                    conn.execute("UPDATE orchestration_nodes SET status = ?, updated_at = ? WHERE id = ?", (next_status, _now(), row["id"]))

    def _next_step_order(self, node_id: str) -> int:
        with self._conn() as conn:
            value = conn.execute("SELECT COALESCE(MAX(order_index), -1) + 1 FROM orchestration_steps WHERE node_id = ?", (node_id,)).fetchone()[0]
        return int(value)

    def _would_create_cycle(self, task_id: str, from_node_id: str, to_node_id: str) -> bool:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT from_node_id, to_node_id FROM orchestration_edges WHERE task_id = ?",
                (task_id,),
            ).fetchall()
        outgoing: dict[str, list[str]] = {}
        for row in rows:
            outgoing.setdefault(row["from_node_id"], []).append(row["to_node_id"])
        outgoing.setdefault(from_node_id, []).append(to_node_id)
        stack = [to_node_id]
        visited: set[str] = set()
        while stack:
            current = stack.pop()
            if current == from_node_id:
                return True
            if current in visited:
                continue
            visited.add(current)
            stack.extend(outgoing.get(current, []))
        return False

    def _require_task(self, task_id: str) -> dict:
        task = self.get_task(task_id)
        if not task:
            raise KeyError("task_not_found")
        return task

    def _require_node(self, node_id: str) -> dict:
        node = self.get_node(node_id)
        if not node:
            raise KeyError("node_not_found")
        return node

    def _require_status(self, value: str, allowed: set[str], label: str) -> None:
        if value not in allowed:
            raise ValueError(f"invalid_{label}")

    def _task_row(self, row: sqlite3.Row) -> dict:
        item = dict(row)
        item["labels"] = _json_loads(item.pop("labels_json"), [])
        return item

    def _node_row(self, row: sqlite3.Row) -> dict:
        item = dict(row)
        item["skill_ids"] = _json_loads(item.pop("skill_ids_json"), [])
        return item

    def _edge_row(self, row: sqlite3.Row) -> dict:
        return dict(row)

    def _step_row(self, row: sqlite3.Row) -> dict:
        item = dict(row)
        item["config"] = _json_loads(item.pop("config_json"), {})
        return item

    def _event_row(self, row: sqlite3.Row) -> dict:
        item = dict(row)
        item["payload"] = _json_loads(item.pop("payload_json"), {})
        return item

    def _worktree_row(self, row: sqlite3.Row) -> dict:
        item = dict(row)
        item["dirty_summary"] = _json_loads(item.pop("dirty_summary_json"), [])
        return item
