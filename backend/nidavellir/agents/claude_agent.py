from __future__ import annotations

from pathlib import Path
from typing import AsyncIterator, ClassVar

from .base import CLIAgent


class ClaudeAgent(CLIAgent):
    provider_type: ClassVar[str] = "claude"

    def __init__(self, slot_id: int, workdir: Path) -> None:
        super().__init__(slot_id, workdir)

    @property
    def cmd(self) -> list[str]:
        from nidavellir.agents.registry import PROVIDER_REGISTRY
        manifest = PROVIDER_REGISTRY["claude"]
        base = [
            "claude",
            "--print",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
        ]
        for flag in manifest.extra_flags:
            if flag not in base:
                base.append(flag)
        return base

    async def start(self) -> None:
        self.status = "running"

    async def kill(self) -> None:
        self.status = "dead"

    async def send(self, text: str) -> None:
        pass

    async def stream(self) -> AsyncIterator[str]:  # type: ignore[override]
        return
        yield  # makes this a generator
