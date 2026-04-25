from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import AsyncIterator, ClassVar, Literal

AgentStatus = Literal["idle", "starting", "running", "stopping", "dead"]


class CLIAgent(ABC):
    provider_type: ClassVar[str] = "unknown"

    def __init__(self, slot_id: int, workdir: Path) -> None:
        self.slot_id = slot_id
        self.workdir = workdir
        self.status: AgentStatus = "idle"

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def kill(self) -> None: ...

    @abstractmethod
    async def send(self, text: str) -> None: ...

    @abstractmethod
    def stream(self) -> AsyncIterator[str]: ...

    @property
    def cmd(self) -> list[str]:
        """Base command. Subclasses override and may append extra_flags from manifest."""
        return []
