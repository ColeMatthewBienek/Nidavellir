from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator, Literal

from pydantic import BaseModel

from nidavellir.agents.registry import PROVIDER_REGISTRY

ProviderDangerousness = Literal["restricted", "ask", "trusted", "free_rein"]

DDL = """
CREATE TABLE IF NOT EXISTS provider_safety_policies (
  provider_id TEXT PRIMARY KEY,
  dangerousness TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


class ProviderSafetyPolicy(BaseModel):
    provider_id: str
    dangerousness: ProviderDangerousness
    effective_dangerousness: ProviderDangerousness
    supports_mediated_tool_approval: bool
    warning: str | None = None
    updated_at: str | None = None


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _coerce_mode(value: str | None) -> ProviderDangerousness:
    if value in {"restricted", "ask", "trusted", "free_rein"}:
        return value  # type: ignore[return-value]
    return "restricted"


def effective_dangerousness(provider_id: str, requested: ProviderDangerousness) -> tuple[ProviderDangerousness, str | None]:
    manifest = PROVIDER_REGISTRY.get(provider_id)
    if manifest is None:
        return requested, None
    if requested == "ask" and not manifest.supports_mediated_tool_approval:
        return "restricted", "Provider-native tool approval is not yet mediated by Nidavellir; ask mode runs restricted."
    return requested, None


class ProviderSafetyStore:
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

    def list_policies(self) -> list[ProviderSafetyPolicy]:
        with self._conn() as conn:
            rows = {
                row["provider_id"]: row
                for row in conn.execute("SELECT * FROM provider_safety_policies").fetchall()
            }
        return [self.get_policy(provider_id, rows.get(provider_id)) for provider_id in PROVIDER_REGISTRY]

    def get_policy(self, provider_id: str, row: sqlite3.Row | None = None) -> ProviderSafetyPolicy:
        manifest = PROVIDER_REGISTRY[provider_id]
        if row is None:
            with self._conn() as conn:
                row = conn.execute(
                    "SELECT * FROM provider_safety_policies WHERE provider_id = ?",
                    (provider_id,),
                ).fetchone()
        requested = _coerce_mode(row["dangerousness"] if row else manifest.default_dangerousness)
        effective, warning = effective_dangerousness(provider_id, requested)
        return ProviderSafetyPolicy(
            provider_id=provider_id,
            dangerousness=requested,
            effective_dangerousness=effective,
            supports_mediated_tool_approval=manifest.supports_mediated_tool_approval,
            warning=warning,
            updated_at=row["updated_at"] if row else None,
        )

    def set_policy(self, provider_id: str, dangerousness: ProviderDangerousness) -> ProviderSafetyPolicy:
        if provider_id not in PROVIDER_REGISTRY:
            raise KeyError(provider_id)
        updated_at = _now()
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO provider_safety_policies (provider_id, dangerousness, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(provider_id) DO UPDATE SET
                     dangerousness = excluded.dangerousness,
                     updated_at = excluded.updated_at""",
                (provider_id, dangerousness, updated_at),
            )
        return self.get_policy(provider_id)
