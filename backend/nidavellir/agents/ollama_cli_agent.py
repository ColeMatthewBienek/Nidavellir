from __future__ import annotations

import json
from pathlib import Path
from typing import AsyncIterator, ClassVar

import httpx

from .base import CLIAgent

OLLAMA_API_BASE   = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen3.6:27b"


class OllamaCliAgent(CLIAgent):
    provider_type: ClassVar[str] = "ollama"

    def __init__(self, slot_id: int, workdir: Path, model_id: str | None = None) -> None:
        super().__init__(slot_id, workdir, model_id=model_id)
        self._client: httpx.AsyncClient | None = None
        self._prompt: str | None = None
        self._last_done_payload: dict | None = None

    def get_usage(self) -> dict | None:
        p = self._last_done_payload
        if not p:
            return None
        return {
            "input_tokens":  p.get("prompt_eval_count"),
            "output_tokens": p.get("eval_count"),
            "accurate":      p.get("prompt_eval_count") is not None,
        }

    @property
    def cmd(self) -> list[str]:
        # Ollama uses its HTTP API — cmd is kept for protocol compat but unused.
        return ["ollama", "run", self.model_id or DEFAULT_OLLAMA_MODEL]

    async def start(self) -> None:
        self._client = httpx.AsyncClient(timeout=300.0)
        self.status = "running"

    async def send(self, text: str) -> None:
        self._prompt = text

    async def stream(self) -> AsyncIterator[str]:
        if not self._client or not self._prompt:
            return

        model = self.model_id or DEFAULT_OLLAMA_MODEL
        payload = {
            "model":  model,
            "prompt": self._prompt,
            "stream": True,
            "think":  False,   # disable chain-of-thought for clean output
        }

        async with self._client.stream(
            "POST",
            f"{OLLAMA_API_BASE}/api/generate",
            json=payload,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                chunk = data.get("response", "")
                if chunk:
                    yield chunk
                if data.get("done"):
                    self._last_done_payload = data
                    break

    async def kill(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
        self.status = "dead"
