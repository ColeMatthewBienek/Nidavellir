from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from nidavellir.agents.base import CLIAgent
from nidavellir.routers import ws as ws_router


class FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)


class HangingAgent(CLIAgent):
    provider_type = "test"

    def __init__(self, slot_id: int, workdir: Path, model_id: str | None = None) -> None:
        super().__init__(slot_id, workdir, model_id)
        self.started = False
        self.killed = False
        self._ready = asyncio.Event()

    async def start(self) -> None:
        self.started = True

    async def kill(self) -> None:
        self.killed = True

    async def send(self, text: str) -> None:
        self._ready.set()

    async def stream(self):
        await self._ready.wait()
        await asyncio.Event().wait()
        yield "unreachable"


class ActivityAgent(CLIAgent):
    provider_type = "test"

    async def start(self) -> None:
        self.status = "running"

    async def kill(self) -> None:
        self.status = "dead"

    async def send(self, text: str) -> None:
        self.sent = text

    async def stream(self):
        yield {"type": "tool_start", "id": "tool-1", "name": "Bash", "args": "pwd", "raw": "tool"}
        yield "done text"
        yield {"type": "tool_end", "id": "tool-1", "status": "success", "summary": "ok"}


@pytest.mark.asyncio
async def test_handle_message_cancellation_kills_agent_and_emits_cancelled(monkeypatch, tmp_path):
    agent = HangingAgent(slot_id=0, workdir=tmp_path)
    fake_ws = FakeWS()

    monkeypatch.setattr(
        ws_router._agent_registry,
        "make_agent",
        lambda provider_id, slot_id, workdir, model_id: agent,
    )

    task = asyncio.create_task(
        ws_router._handle_message(
            fake_ws,
            "slow request",
            "test",
            "test-model",
            memory_context="",
        )
    )
    await asyncio.wait_for(agent._ready.wait(), timeout=1)

    task.cancel()
    response, returned_agent, outcome = await task

    assert response == ""
    assert returned_agent is agent
    assert outcome == "cancelled"
    assert agent.killed is True
    assert {"type": "cancelled"} in fake_ws.sent


@pytest.mark.asyncio
async def test_handle_message_streams_activity_frames_separately_from_answer(monkeypatch, tmp_path):
    agent = ActivityAgent(slot_id=0, workdir=tmp_path)
    fake_ws = FakeWS()

    monkeypatch.setattr(
        ws_router._agent_registry,
        "make_agent",
        lambda provider_id, slot_id, workdir, model_id: agent,
    )

    response, returned_agent, outcome = await ws_router._handle_message(
        fake_ws,
        "inspect",
        "test",
        "test-model",
        memory_context="",
        workdir=tmp_path,
    )

    assert response == "done text"
    assert returned_agent is agent
    assert outcome == "completed"
    assert {"type": "chunk", "content": "done text"} in fake_ws.sent
    assert {
        "type": "activity",
        "event": {"type": "tool_start", "id": "tool-1", "name": "Bash", "args": "pwd", "raw": "tool"},
    } in fake_ws.sent
    assert {
        "type": "activity",
        "event": {"type": "tool_end", "id": "tool-1", "status": "success", "summary": "ok"},
    } in fake_ws.sent
