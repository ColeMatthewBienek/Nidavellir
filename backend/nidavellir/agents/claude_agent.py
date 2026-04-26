from __future__ import annotations

import asyncio
from pathlib import Path
from typing import AsyncIterator, ClassVar

from .base import CLIAgent


class ClaudeAgent(CLIAgent):
    provider_type: ClassVar[str] = "claude"

    def __init__(self, slot_id: int, workdir: Path, model_id: str | None = None) -> None:
        super().__init__(slot_id, workdir, model_id=model_id)
        self._process: asyncio.subprocess.Process | None = None

    @property
    def cmd(self) -> list[str]:
        from nidavellir.agents.registry import PROVIDER_REGISTRY
        manifest = PROVIDER_REGISTRY["claude"]
        base = ["claude", "--print"]
        if self.model_id:
            base += ["--model", self.model_id]
        for flag in manifest.extra_flags:
            if flag not in base:
                base.append(flag)
        return base

    async def start(self) -> None:
        self._process = await asyncio.create_subprocess_exec(
            *self.cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=self.workdir,
        )
        self.status = "running"

    async def send(self, text: str) -> None:
        if self._process and self._process.stdin:
            self._process.stdin.write((text + "\n").encode())
            await self._process.stdin.drain()
            self._process.stdin.close()

    async def stream(self) -> AsyncIterator[str]:
        if not self._process or not self._process.stdout:
            return
        while True:
            line = await self._process.stdout.readline()
            if not line:
                break
            yield line.decode(errors="replace")

    async def kill(self) -> None:
        if self._process:
            try:
                self._process.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                try:
                    self._process.kill()
                except ProcessLookupError:
                    pass
        self.status = "dead"
