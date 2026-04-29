from __future__ import annotations

from abc import ABC, abstractmethod
import os
from pathlib import Path
from typing import AsyncIterator, ClassVar, Literal, TypeAlias

from .events import AgentActivityEvent

AgentStatus = Literal["idle", "starting", "running", "stopping", "dead"]
AgentStreamItem: TypeAlias = str | AgentActivityEvent | dict[str, object]


class CLIAgent(ABC):
    provider_type: ClassVar[str] = "unknown"

    def __init__(self, slot_id: int, workdir: Path, model_id: str | None = None) -> None:
        self.slot_id  = slot_id
        self.workdir  = workdir
        self.model_id = model_id
        self.status: AgentStatus = "idle"

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def kill(self) -> None: ...

    @abstractmethod
    async def send(self, text: str) -> None: ...

    async def steer(self, text: str) -> bool:
        """Attempt mid-turn steering for interactive transports.

        One-shot CLI providers should keep this default and use queued steering.
        """
        return False

    @abstractmethod
    def stream(self) -> AsyncIterator[AgentStreamItem]: ...

    @property
    def cmd(self) -> list[str]:
        """Base command. Subclasses override and may append extra_flags from manifest."""
        return []

    def process_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.setdefault("UV_CACHE_DIR", "/tmp/uv-cache")
        return env
