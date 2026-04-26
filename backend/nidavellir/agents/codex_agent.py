from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import AsyncIterator, ClassVar

from .base import CLIAgent

DEFAULT_CODEX_MODEL = "gpt-5.4"

# Matches ANSI CSI/OSC/other escape sequences
_ANSI_RE = re.compile(
    r'\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x20-\x7e])'
    r'|[\x80-\x9f]'
)


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


class CodexAgent(CLIAgent):
    provider_type: ClassVar[str] = "codex"

    def __init__(self, slot_id: int, workdir: Path, model_id: str | None = None) -> None:
        super().__init__(slot_id, workdir, model_id=model_id)
        self._process: asyncio.subprocess.Process | None = None

    @property
    def cmd(self) -> list[str]:
        model = self.model_id or DEFAULT_CODEX_MODEL
        return ["codex", "exec", "-m", model]

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
        """
        Codex stdout has a structured header, user echo, and token-count footer.
        State machine:
          PREAMBLE  → skip until second '--------'
          SKIP_USER → skip user echo until 'codex' role label
          RESPONSE  → yield content until 'tokens used'
          DONE      → stop
        All lines are ANSI-stripped. ERROR lines raise RuntimeError.
        """
        if not self._process or not self._process.stdout:
            return

        divider_count = 0
        past_header   = False
        in_response   = False

        while True:
            raw = await self._process.stdout.readline()
            if not raw:
                break

            line = _strip_ansi(raw.decode(errors="replace")).rstrip("\n")

            # ── Error detection: codex prints JSON errors to stdout ────────────
            if line.startswith("ERROR:"):
                payload = line[len("ERROR:"):].strip()
                try:
                    err = json.loads(payload)
                    msg = err.get("error", {}).get("message", payload)
                except Exception:
                    msg = payload
                raise RuntimeError(msg)

            # ── Header: skip until second '--------' ──────────────────────────
            if not past_header:
                if line.strip() == "--------":
                    divider_count += 1
                    if divider_count >= 2:
                        past_header = True
                continue

            # ── Warnings: skip (bubblewrap etc.) ─────────────────────────────
            if line.startswith("warning:"):
                continue

            # ── Footer: stop at 'tokens used' ────────────────────────────────
            if line.strip() == "tokens used":
                break

            # ── Role labels: 'user' skips, 'codex' starts response ────────────
            if line.strip() == "user":
                continue
            if line.strip() == "codex":
                in_response = True
                continue

            # ── Skip numeric-only lines (token counts) ────────────────────────
            if line.strip().replace(",", "").isdigit():
                continue

            # ── Yield response content ────────────────────────────────────────
            if in_response:
                yield line + "\n"

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
