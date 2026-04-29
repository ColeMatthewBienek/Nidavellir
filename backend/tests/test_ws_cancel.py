from __future__ import annotations

import asyncio
from types import SimpleNamespace
from pathlib import Path

import pytest

from nidavellir.agents.base import CLIAgent
from nidavellir.routers import ws as ws_router


class FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)


def test_turn_broadcaster_buffers_frames_and_marks_completion():
    record = ws_router.TurnRecord("turn-1", "conv-1")
    app = SimpleNamespace(state=SimpleNamespace())
    broadcaster = ws_router.TurnBroadcaster(app, record)
    subscriber = FakeWS()
    record.subscribers.add(subscriber)

    asyncio.run(broadcaster.send_json({"type": "chunk", "content": "hello"}))
    asyncio.run(broadcaster.send_json({"type": "done"}))

    assert record.status == "completed"
    assert record.frames == [
        {"type": "chunk", "content": "hello", "turn_id": "turn-1"},
        {"type": "done", "turn_id": "turn-1"},
    ]
    assert subscriber.sent == record.frames


def test_turn_record_buffers_steering_activity_frames():
    record = ws_router.TurnRecord("turn-steer", "conv-1")
    app = SimpleNamespace(state=SimpleNamespace())
    broadcaster = ws_router.TurnBroadcaster(app, record)
    subscriber = FakeWS()
    record.subscribers.add(subscriber)
    record.steering_comments.append("Keep the Git tab as a tree.")

    asyncio.run(broadcaster.send_json({
        "type": "activity",
        "event": {"type": "steering_signal", "content": "Keep the Git tab as a tree."},
    }))

    assert record.steering_comments == ["Keep the Git tab as a tree."]
    assert record.frames == [{
        "type": "activity",
        "event": {"type": "steering_signal", "content": "Keep the Git tab as a tree."},
        "turn_id": "turn-steer",
    }]
    assert subscriber.sent == record.frames


@pytest.mark.asyncio
async def test_attach_turn_subscriber_replays_buffered_frames():
    record = ws_router.TurnRecord("turn-2", "conv-2")
    app = SimpleNamespace(state=SimpleNamespace())
    broadcaster = ws_router.TurnBroadcaster(app, record)
    await broadcaster.send_json({"type": "activity", "event": {"type": "progress", "content": "working"}})
    subscriber = FakeWS()

    await ws_router._attach_turn_subscriber(record, subscriber)

    assert record.subscribers == {subscriber}
    assert subscriber.sent == [
        {
            "type": "activity",
            "event": {"type": "progress", "content": "working"},
            "turn_id": "turn-2",
        }
    ]


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
