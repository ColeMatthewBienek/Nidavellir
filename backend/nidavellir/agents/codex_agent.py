from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import AsyncIterator, ClassVar

from .base import AgentStreamItem, CLIAgent
from .events import AgentActivityEvent

DEFAULT_CODEX_MODEL = "gpt-5.4"
CODEX_STREAM_LIMIT_BYTES = 32 * 1024 * 1024

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
        self._message_snapshots: dict[str, str] = {}

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
        return ["codex", "exec", "--json", "-m", model]

    async def start(self) -> None:
        # Codex writes its interactive output (dividers, role labels, content) to
        # stderr. Merging stderr into stdout lets the stream state machine see it.
        # Rust log lines (stale-thread errors) are filtered in stream() below.
        self._process = await asyncio.create_subprocess_exec(
            *self.cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            limit=CODEX_STREAM_LIMIT_BYTES,
            cwd=self.workdir,
            env=self.process_env(),
        )
        self.status = "running"

    async def send(self, text: str) -> None:
        if self._process and self._process.stdin:
            self._process.stdin.write((text + "\n").encode())
            await self._process.stdin.drain()
            self._process.stdin.close()

    async def stream(self) -> AsyncIterator[AgentStreamItem]:
        """
        Prefer Codex JSON events. If an older CLI ignores --json or tests feed
        legacy terminal output, fall back to the historical state machine:
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
            stripped = line.strip()

            event = self._parse_json_event(stripped)
            if event is not None:
                for out in event:
                    yield out
                continue

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

    def _parse_json_event(self, line: str) -> list[AgentStreamItem] | None:
        if not line.startswith("{"):
            return None
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            return None
        if not isinstance(payload, dict):
            return []

        event_type = str(payload.get("type") or payload.get("msg", {}).get("type") or "")
        item = payload.get("item")
        if not isinstance(item, dict):
            item = payload.get("data") if isinstance(payload.get("data"), dict) else payload

        outputs: list[AgentStreamItem] = []

        if event_type in {"thread.started", "session.started"}:
            thread_id = payload.get("thread_id") or payload.get("session_id") or item.get("id")
            detail = f"Codex session {thread_id} started" if thread_id else "Codex session started"
            outputs.append(AgentActivityEvent.progress(provider="codex", content=detail))
            return outputs

        if event_type in {"turn.started", "plan.started"}:
            outputs.append(AgentActivityEvent.progress(provider="codex", content=event_type.replace(".", " ")))
            return outputs

        if event_type == "plan.updated":
            text = self._extract_text(item) or self._extract_text(payload)
            outputs.append(AgentActivityEvent(type="skill_use", provider="codex", name="plan", detail=text or "updated", raw=payload))
            return outputs

        if event_type == "turn.completed":
            self._capture_usage(payload)
            return outputs

        if event_type == "turn.failed":
            message = self._extract_error(payload) or "Codex turn failed"
            outputs.append(AgentActivityEvent.error(provider="codex", message=message, raw=payload))
            return outputs

        if event_type == "error":
            message = self._extract_error(payload) or "Codex error"
            outputs.append(AgentActivityEvent.error(provider="codex", message=message, raw=payload))
            return outputs

        item_type = str(item.get("type") or item.get("kind") or "")
        item_id = str(item.get("id") or item.get("call_id") or item.get("tool_call_id") or f"codex-{abs(hash(line))}")

        if item_type in {"reasoning", "reasoning_message"}:
            text = self._extract_text(item)
            if text:
                outputs.append(AgentActivityEvent.reasoning(provider="codex", content=text))
            return outputs

        if item_type in {"agent_message", "message", "assistant_message"}:
            text = self._extract_text(item)
            if text:
                previous = self._message_snapshots.get(item_id, "")
                if text == previous:
                    return outputs
                if previous and text.startswith(previous):
                    outputs.append(text[len(previous):])
                else:
                    outputs.append(text)
                self._message_snapshots[item_id] = text
            return outputs

        if self._is_tool_like(item_type):
            name = self._tool_name(item_type, item)
            args = self._tool_args(item_type, item)
            if event_type.endswith(".started") or event_type == "item.started":
                outputs.append(AgentActivityEvent.tool_start(
                    provider="codex",
                    tool_id=item_id,
                    name=name,
                    args=args,
                    raw=payload,
                ))
                return outputs
            if event_type.endswith(".completed") or event_type == "item.completed":
                status = self._status(item)
                summary = self._tool_summary(item)
                outputs.append(AgentActivityEvent.tool_end(
                    provider="codex",
                    tool_id=item_id,
                    status=status,
                    summary=summary,
                    raw=payload,
                ))
                return outputs
            if event_type.endswith(".delta") or event_type == "item.delta":
                text = self._extract_text(item) or str(item.get("delta") or "")
                if text:
                    outputs.append(AgentActivityEvent.tool_delta(
                        provider="codex",
                        tool_id=item_id,
                        content=text,
                        raw=payload,
                    ))
                return outputs

        text = self._extract_text(payload)
        if text:
            outputs.append(text)
        return outputs

    def _capture_usage(self, payload: dict) -> None:
        usage = payload.get("usage")
        if not isinstance(usage, dict):
            usage = payload.get("token_usage") if isinstance(payload.get("token_usage"), dict) else None
        if not usage:
            return
        input_tokens = usage.get("input_tokens") or usage.get("prompt_tokens")
        output_tokens = usage.get("output_tokens") or usage.get("completion_tokens")
        try:
            if input_tokens is not None:
                self._last_input_tokens = int(input_tokens)
            if output_tokens is not None:
                self._last_output_tokens = int(output_tokens)
        except (TypeError, ValueError):
            return

    def _extract_error(self, payload: dict) -> str | None:
        err = payload.get("error")
        if isinstance(err, dict):
            message = err.get("message") or err.get("error")
            return str(message) if message else None
        if isinstance(err, str):
            return err
        message = payload.get("message")
        return str(message) if message else None

    def _extract_text(self, payload: dict) -> str:
        for key in ("text", "content", "message", "delta", "summary"):
            value = payload.get(key)
            if isinstance(value, str):
                return value
        content = payload.get("content")
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if isinstance(part, str):
                    parts.append(part)
                elif isinstance(part, dict):
                    text = part.get("text") or part.get("content")
                    if isinstance(text, str):
                        parts.append(text)
            return "".join(parts)
        return ""

    def _is_tool_like(self, item_type: str) -> bool:
        return item_type in {
            "command_execution",
            "file_read",
            "file_edit",
            "file_create",
            "file_delete",
            "mcp_tool_call",
            "tool_call",
            "function_call",
            "patch",
            "apply_patch",
        }

    def _tool_name(self, item_type: str, item: dict) -> str:
        if item_type == "command_execution":
            return "exec"
        return str(item.get("name") or item.get("tool") or item_type or "tool")

    def _tool_args(self, item_type: str, item: dict) -> str:
        if item_type == "command_execution":
            return str(item.get("command") or item.get("cmd") or "")
        if item_type.startswith("file_"):
            return str(item.get("path") or item.get("file_path") or "")
        for key in ("arguments", "args", "input", "query", "prompt"):
            value = item.get(key)
            if value is None:
                continue
            if isinstance(value, str):
                return value
            try:
                return json.dumps(value, ensure_ascii=False, sort_keys=True)
            except TypeError:
                return str(value)
        return ""

    def _status(self, item: dict) -> str:
        raw = str(item.get("status") or item.get("outcome") or "success").lower()
        return "error" if raw in {"error", "failed", "failure"} or item.get("error") else "success"

    def _tool_summary(self, item: dict) -> str:
        for key in ("output", "result", "summary", "stderr", "stdout", "error"):
            value = item.get(key)
            if value is None:
                continue
            if isinstance(value, str):
                return value[:1200]
            try:
                return json.dumps(value, ensure_ascii=False, sort_keys=True)[:1200]
            except TypeError:
                return str(value)[:1200]
        status = item.get("status")
        return str(status) if status else ""

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
