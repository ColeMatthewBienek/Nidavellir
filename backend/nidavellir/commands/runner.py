from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Awaitable, Callable

MAX_CAPTURE_CHARS = 64_000
CommandEventCallback = Callable[[dict], Awaitable[None]]


class OutputCapture:
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.size = 0
        self.truncated = False

    def append(self, text: str) -> str | None:
        if self.truncated:
            return None
        remaining = MAX_CAPTURE_CHARS - self.size
        if remaining <= 0:
            self.truncated = True
            marker = "\n\n[truncated output]"
            self.parts.append(marker)
            return marker
        if len(text) <= remaining:
            self.parts.append(text)
            self.size += len(text)
            return text
        self.parts.append(text[:remaining])
        self.size += remaining
        self.truncated = True
        marker = f"\n\n[truncated {len(text) - remaining} chars]"
        self.parts.append(marker)
        return text[:remaining] + marker

    def text(self) -> str:
        return "".join(self.parts)


class CommandRunner:
    async def run(
        self,
        *,
        command: str,
        cwd: str,
        timeout_seconds: int = 120,
        on_event: CommandEventCallback | None = None,
    ) -> dict:
        started = time.monotonic()

        async def emit(event: dict) -> None:
            if on_event is None:
                return
            try:
                await on_event(event)
            except Exception:
                return

        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(Path(cwd)),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await emit({"type": "started", "pid": proc.pid})

        stdout_capture = OutputCapture()
        stderr_capture = OutputCapture()

        async def read_stream(stream: asyncio.StreamReader | None, stream_name: str, capture: OutputCapture) -> None:
            if stream is None:
                return
            while True:
                chunk = await stream.read(4096)
                if not chunk:
                    return
                text = chunk.decode(errors="replace")
                emitted = capture.append(text)
                if emitted:
                    await emit({"type": "output", "stream": stream_name, "content": emitted})

        stdout_task = asyncio.create_task(read_stream(proc.stdout, "stdout", stdout_capture))
        stderr_task = asyncio.create_task(read_stream(proc.stderr, "stderr", stderr_capture))
        timed_out = False
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            timed_out = True
            proc.kill()
            await proc.wait()
        await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)

        duration_ms = int((time.monotonic() - started) * 1000)
        stdout = stdout_capture.text()
        stderr = stderr_capture.text()
        await emit({
            "type": "finished",
            "exit_code": proc.returncode,
            "timed_out": timed_out,
            "duration_ms": duration_ms,
        })
        return {
            "exit_code": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "timed_out": timed_out,
            "duration_ms": duration_ms,
        }
