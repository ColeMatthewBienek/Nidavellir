from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import AsyncIterator, ClassVar

from .base import CLIAgent

DEFAULT_CODEX_MODEL = "gpt-5.4"

log = logging.getLogger(__name__)

# Matches ANSI CSI/OSC/other escape sequences
_ANSI_RE = re.compile(
    r'\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x20-\x7e])'
    r'|[\x80-\x9f]'
)

# Matches Rust/tracing-style log lines: "2026-04-26T23:04:17Z ERROR module::path: ..."
_RUST_LOG_RE = re.compile(
    r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?\s+(?:ERROR|WARN|INFO|DEBUG|TRACE)\s+'
)


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _is_rust_log_line(line: str) -> bool:
    return bool(_RUST_LOG_RE.match(line))


class CodexAgent(CLIAgent):
    provider_type: ClassVar[str] = "codex"

    def __init__(self, slot_id: int, workdir: Path, model_id: str | None = None) -> None:
        super().__init__(slot_id, workdir, model_id=model_id)
        self._process: asyncio.subprocess.Process | None = None
        self._last_input_tokens:  int | None = None
        self._last_output_tokens: int | None = None

    def get_usage(self) -> dict | None:
        if self._last_input_tokens is None and self._last_output_tokens is None:
            return None
        return {
            "input_tokens":  self._last_input_tokens,
            "output_tokens": self._last_output_tokens,
            "accurate":      self._last_input_tokens is not None,
        }

    @property
    def cmd(self) -> list[str]:
        model = self.model_id or DEFAULT_CODEX_MODEL
        return ["codex", "exec", "-m", model]

    async def start(self) -> None:
        self._process = await asyncio.create_subprocess_exec(
            *self.cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.workdir,
        )
        self.status = "running"
        # Drain stderr in background so stale-thread errors don't pollute stdout
        asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self) -> None:
        """Read Codex stderr to /dev/null; log stale-thread writes as warnings only."""
        if not self._process or not self._process.stderr:
            return
        try:
            while True:
                raw = await self._process.stderr.readline()
                if not raw:
                    break
                line = raw.decode(errors="replace").rstrip("\n")
                if line:
                    log.warning(
                        "codex_stderr",
                        extra={"event": "stale_thread_write_ignored", "line": line},
                    )
        except Exception:
            pass

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

            # ── Rust/tracing log lines: filter stale-thread errors ───────────
            if _is_rust_log_line(line):
                log.warning(
                    "codex_rust_log_filtered",
                    extra={"event": "stale_thread_write_ignored", "line": line},
                )
                continue

            # ── Footer: capture token counts then stop ────────────────────────
            if line.strip() == "tokens used":
                # Next two non-empty lines are input and output token counts
                try:
                    in_line  = (await self._process.stdout.readline()).decode(errors="replace").strip()
                    out_line = (await self._process.stdout.readline()).decode(errors="replace").strip()
                    self._last_input_tokens  = int(in_line.replace(",", ""))
                    self._last_output_tokens = int(out_line.replace(",", ""))
                except Exception:
                    pass
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
