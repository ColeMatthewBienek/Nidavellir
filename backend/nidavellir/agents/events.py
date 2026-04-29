from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

ActivityType = Literal[
    "progress",
    "tool_start",
    "tool_delta",
    "tool_end",
    "skill_use",
    "patch",
    "reasoning_signal",
    "error",
    "done",
]


@dataclass(frozen=True)
class AgentActivityEvent:
    type: ActivityType
    provider: str
    content: str | None = None
    id: str | None = None
    name: str | None = None
    args: str | None = None
    raw: Any | None = None
    status: Literal["success", "error", "running"] | str | None = None
    summary: str | None = None
    detail: str | None = None
    timestamp_ms: int | None = None

    def to_frontend(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type":     self.type,
            "provider": self.provider,
        }
        for key in (
            "content",
            "id",
            "name",
            "args",
            "raw",
            "status",
            "summary",
            "detail",
            "timestamp_ms",
        ):
            value = getattr(self, key)
            if value is not None:
                payload[key] = value
        return payload

    @classmethod
    def progress(cls, *, provider: str, content: str) -> "AgentActivityEvent":
        return cls(type="progress", provider=provider, content=content)

    @classmethod
    def reasoning(cls, *, provider: str, content: str, raw: Any | None = None) -> "AgentActivityEvent":
        return cls(type="reasoning_signal", provider=provider, content=content, raw=raw)

    @classmethod
    def tool_start(
        cls,
        *,
        provider: str,
        tool_id: str,
        name: str,
        args: str = "",
        raw: Any | None = None,
    ) -> "AgentActivityEvent":
        return cls(type="tool_start", provider=provider, id=tool_id, name=name, args=args, raw=raw)

    @classmethod
    def tool_delta(
        cls,
        *,
        provider: str,
        tool_id: str,
        content: str,
        raw: Any | None = None,
    ) -> "AgentActivityEvent":
        return cls(type="tool_delta", provider=provider, id=tool_id, content=content, raw=raw)

    @classmethod
    def tool_end(
        cls,
        *,
        provider: str,
        tool_id: str,
        status: Literal["success", "error"] | str,
        summary: str | None = None,
        raw: Any | None = None,
    ) -> "AgentActivityEvent":
        return cls(type="tool_end", provider=provider, id=tool_id, status=status, summary=summary, raw=raw)

    @classmethod
    def error(cls, *, provider: str, message: str, raw: Any | None = None) -> "AgentActivityEvent":
        return cls(type="error", provider=provider, content=message, raw=raw)


def frontend_event(item: object) -> dict[str, Any]:
    if isinstance(item, AgentActivityEvent):
        return item.to_frontend()
    if isinstance(item, dict):
        return item
    return {"type": "progress", "provider": "unknown", "content": str(item)}
