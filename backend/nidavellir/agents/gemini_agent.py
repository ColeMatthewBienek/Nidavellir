from __future__ import annotations

from pathlib import Path
from typing import AsyncIterator, ClassVar

from .base import CLIAgent


class GeminiAgent(CLIAgent):
    provider_type: ClassVar[str] = "gemini"

    def __init__(self, slot_id: int, workdir: Path, model_id: str | None = None) -> None:
        super().__init__(slot_id, workdir, model_id=model_id)

    @property
    def cmd(self) -> list[str]:
        return ["gemini"]

    async def start(self) -> None:
        self.status = "running"

    async def kill(self) -> None:
        self.status = "dead"

    async def send(self, text: str) -> None:
        pass

    async def stream(self) -> AsyncIterator[str]:  # type: ignore[override]
        return
        yield
