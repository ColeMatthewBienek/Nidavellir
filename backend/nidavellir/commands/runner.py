from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Awaitable, Callable

MAX_CAPTURE_CHARS = 64_000
CommandEventCallback = Callable[[dict], Awaitable[None]]


def _trim_output(text: str) -> str:
    if len(text) <= MAX_CAPTURE_CHARS:
        return text
    omitted = len(text) - MAX_CAPTURE_CHARS
    return text[:MAX_CAPTURE_CHARS] + f"\n\n[truncated {omitted} chars]"


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

        stdout_parts: list[str] = []
        stderr_parts: list[str] = []

        async def read_stream(stream: asyncio.StreamReader | None, stream_name: str, parts: list[str]) -> None:
            if stream is None:
                return
            while True:
                chunk = await stream.read(4096)
                if not chunk:
                    return
                text = chunk.decode(errors="replace")
                parts.append(text)
                await emit({"type": "output", "stream": stream_name, "content": text})

        stdout_task = asyncio.create_task(read_stream(proc.stdout, "stdout", stdout_parts))
        stderr_task = asyncio.create_task(read_stream(proc.stderr, "stderr", stderr_parts))
        timed_out = False
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            timed_out = True
            proc.kill()
            await proc.wait()
        await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)

        duration_ms = int((time.monotonic() - started) * 1000)
        stdout = _trim_output("".join(stdout_parts))
        stderr = _trim_output("".join(stderr_parts))
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
