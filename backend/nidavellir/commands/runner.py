from __future__ import annotations

import asyncio
import time
from pathlib import Path

MAX_CAPTURE_CHARS = 64_000


def _trim_output(text: str) -> str:
    if len(text) <= MAX_CAPTURE_CHARS:
        return text
    omitted = len(text) - MAX_CAPTURE_CHARS
    return text[:MAX_CAPTURE_CHARS] + f"\n\n[truncated {omitted} chars]"


class CommandRunner:
    async def run(self, *, command: str, cwd: str, timeout_seconds: int = 120) -> dict:
        started = time.monotonic()
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(Path(cwd)),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        timed_out = False
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            timed_out = True
            proc.kill()
            stdout_bytes, stderr_bytes = await proc.communicate()

        duration_ms = int((time.monotonic() - started) * 1000)
        return {
            "exit_code": proc.returncode,
            "stdout": _trim_output(stdout_bytes.decode(errors="replace")),
            "stderr": _trim_output(stderr_bytes.decode(errors="replace")),
            "timed_out": timed_out,
            "duration_ms": duration_ms,
        }
