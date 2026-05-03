from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import AsyncIterator, ClassVar

from .base import AgentStreamItem, CLIAgent
from .events import AgentActivityEvent


class ClaudeAgent(CLIAgent):
    provider_type: ClassVar[str] = "claude"

    def __init__(
        self,
        slot_id: int,
        workdir: Path,
        model_id: str | None = None,
        dangerousness: str = "restricted",
    ) -> None:
        super().__init__(slot_id, workdir, model_id=model_id, dangerousness=dangerousness)
        self._process: asyncio.subprocess.Process | None = None

    @property
    def cmd(self) -> list[str]:
        base = [
            "claude",
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        if self.model_id:
            base += ["--model", self.model_id]
        for flag in self.provider_safety_flags():
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
            env=self.process_env(),
        )
        self.status = "running"

    async def send(self, text: str) -> None:
        if self._process and self._process.stdin:
            self._process.stdin.write((text + "\n").encode())
            await self._process.stdin.drain()
            self._process.stdin.close()

    async def stream(self) -> AsyncIterator[AgentStreamItem]:
        if not self._process or not self._process.stdout:
            return
        tool_names: dict[str, str] = {}
        emitted_tool_starts: set[str] = set()
        emitted_tool_results: set[str] = set()
        block_tool_ids: dict[int, str] = {}
        last_text_snapshot = ""
        emitted_text = False
        while True:
            line = await self._process.stdout.readline()
            if not line:
                break
            raw = line.decode(errors="replace").strip()
            if not raw:
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError:
                yield raw + "\n"
                continue

            msg_type = item.get("type")
            if msg_type == "system":
                subtype = item.get("subtype")
                yield AgentActivityEvent.progress(
                    provider="claude",
                    content=f"Claude session {subtype or 'started'}",
                )
                continue

            if msg_type == "stream_event":
                event = item.get("event")
                if not isinstance(event, dict):
                    continue
                async_items = self._convert_stream_event(
                    item,
                    event,
                    block_tool_ids=block_tool_ids,
                    emitted_tool_starts=emitted_tool_starts,
                    emitted_tool_results=emitted_tool_results,
                )
                for out in async_items:
                    if isinstance(out, str):
                        delta, last_text_snapshot = self._dedupe_text_chunk(last_text_snapshot, out)
                        if not delta:
                            continue
                        emitted_text = True
                        out = delta
                    yield out
                continue

            if msg_type == "assistant":
                message = item.get("message") if isinstance(item.get("message"), dict) else item
                content_items = message.get("content", []) if isinstance(message, dict) else []
                for content in content_items if isinstance(content_items, list) else []:
                    if not isinstance(content, dict):
                        continue
                    content_type = content.get("type")
                    if content_type == "text":
                        text = content.get("text")
                        if isinstance(text, str) and text:
                            delta, last_text_snapshot = self._dedupe_text_chunk(last_text_snapshot, text)
                            if delta:
                                emitted_text = True
                                yield delta
                    elif content_type == "tool_use":
                        tool_id = str(content.get("id") or f"claude-tool-{len(tool_names) + 1}")
                        if tool_id in emitted_tool_starts:
                            continue
                        name = str(content.get("name") or "tool")
                        tool_names[tool_id] = name
                        emitted_tool_starts.add(tool_id)
                        args = content.get("input")
                        try:
                            args_text = json.dumps(args, ensure_ascii=False, sort_keys=True) if args is not None else ""
                        except TypeError:
                            args_text = str(args)
                        yield AgentActivityEvent.tool_start(
                            provider="claude",
                            tool_id=tool_id,
                            name=name,
                            args=args_text,
                            raw=raw,
                        )
                    elif content_type == "thinking":
                        thinking = content.get("thinking") or content.get("text")
                        if isinstance(thinking, str) and thinking:
                            yield AgentActivityEvent.reasoning(provider="claude", content=thinking)
                continue

            if msg_type == "user":
                message = item.get("message") if isinstance(item.get("message"), dict) else item
                content_items = message.get("content", []) if isinstance(message, dict) else []
                for content in content_items if isinstance(content_items, list) else []:
                    if not isinstance(content, dict) or content.get("type") != "tool_result":
                        continue
                    tool_id = str(content.get("tool_use_id") or "")
                    if tool_id in emitted_tool_results:
                        continue
                    emitted_tool_results.add(tool_id)
                    status = "error" if content.get("is_error") else "success"
                    result_content = content.get("content")
                    summary = result_content if isinstance(result_content, str) else status
                    yield AgentActivityEvent.tool_end(
                        provider="claude",
                        tool_id=tool_id,
                        status=status,
                        summary=summary[:800] if isinstance(summary, str) else status,
                    )
                continue

            if msg_type == "result":
                result = item.get("result")
                if isinstance(result, str) and result and not emitted_text:
                    yield result
                continue

    def _convert_stream_event(
        self,
        raw_item: dict,
        event: dict,
        *,
        block_tool_ids: dict[int, str],
        emitted_tool_starts: set[str],
        emitted_tool_results: set[str],
    ) -> list[AgentStreamItem]:
        event_type = event.get("type")
        outputs: list[AgentStreamItem] = []

        if event_type == "content_block_start":
            index = event.get("index")
            block = event.get("content_block")
            if not isinstance(block, dict):
                return outputs
            block_type = block.get("type")
            if block_type == "text":
                text = block.get("text")
                if isinstance(text, str) and text:
                    outputs.append(text)
            elif block_type == "thinking":
                thinking = block.get("thinking") or block.get("text")
                if isinstance(thinking, str) and thinking:
                    outputs.append(AgentActivityEvent.reasoning(provider="claude", content=thinking))
            elif block_type == "tool_use":
                tool_id = str(block.get("id") or f"claude-tool-{len(emitted_tool_starts) + 1}")
                if isinstance(index, int):
                    block_tool_ids[index] = tool_id
                if tool_id in emitted_tool_starts:
                    return outputs
                emitted_tool_starts.add(tool_id)
                name = str(block.get("name") or "tool")
                args = block.get("input")
                outputs.append(AgentActivityEvent.tool_start(
                    provider="claude",
                    tool_id=tool_id,
                    name=name,
                    args=self._stringify_args(args),
                    raw=raw_item,
                ))
            return outputs

        if event_type == "content_block_delta":
            delta = event.get("delta")
            if not isinstance(delta, dict):
                return outputs
            delta_type = delta.get("type")
            if delta_type == "text_delta":
                text = delta.get("text")
                if isinstance(text, str) and text:
                    outputs.append(text)
            elif delta_type in {"thinking_delta", "signature_delta"}:
                text = delta.get("thinking") or delta.get("text")
                if isinstance(text, str) and text:
                    outputs.append(AgentActivityEvent.reasoning(provider="claude", content=text))
            elif delta_type == "input_json_delta":
                index = event.get("index")
                tool_id = block_tool_ids.get(index) if isinstance(index, int) else None
                partial = delta.get("partial_json")
                if tool_id and isinstance(partial, str) and partial:
                    outputs.append(AgentActivityEvent.tool_delta(
                        provider="claude",
                        tool_id=tool_id,
                        content=partial,
                        raw=raw_item,
                    ))
            return outputs

        if event_type == "content_block_stop":
            return outputs

        if event_type == "message_delta":
            delta = event.get("delta")
            usage = event.get("usage")
            if usage is None and isinstance(delta, dict):
                usage = delta.get("usage")
            if isinstance(usage, dict):
                outputs.append(AgentActivityEvent.progress(provider="claude", content="Claude usage updated"))
            return outputs

        return outputs

    def _dedupe_text_chunk(self, current: str, incoming: str) -> tuple[str, str]:
        if not incoming:
            return "", current
        if not current:
            return incoming, incoming
        if current.endswith(incoming):
            return "", current
        if incoming.strip() == current.strip():
            return "", current
        if incoming.startswith(current):
            return incoming[len(current):], incoming

        stripped = incoming.lstrip()
        if stripped.startswith(current):
            return stripped[len(current):], current + stripped[len(current):]

        max_overlap = min(len(current), len(incoming))
        for size in range(max_overlap, 0, -1):
            if current.endswith(incoming[:size]):
                delta = incoming[size:]
                return delta, current + delta

        return incoming, current + incoming

    def _stringify_args(self, args: object) -> str:
        if args is None:
            return ""
        if isinstance(args, str):
            return args
        try:
            return json.dumps(args, ensure_ascii=False, sort_keys=True)
        except TypeError:
            return str(args)

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
