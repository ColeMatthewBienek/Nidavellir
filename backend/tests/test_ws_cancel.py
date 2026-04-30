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


class SteeringStore:
    def __init__(self) -> None:
        self.queued: list[tuple[str, str]] = []

    def queue_steering_comment(self, conversation_id: str, content: str) -> list[str]:
        self.queued.append((conversation_id, content))
        return [item for _, item in self.queued]


class LiveSteeringAgent:
    def __init__(self, accepted: bool = True, raises: bool = False) -> None:
        self.accepted = accepted
        self.raises = raises
        self.notes: list[str] = []

    async def steer(self, text: str) -> bool:
        self.notes.append(text)
        if self.raises:
            raise RuntimeError("transport rejected steering")
        return self.accepted


@pytest.mark.asyncio
async def test_apply_steering_sends_live_when_provider_transport_supports_it(monkeypatch):
    agent = LiveSteeringAgent(accepted=True)
    record = ws_router.TurnRecord("turn-live", "conv-live")
    record.live_agent = agent
    app = SimpleNamespace(state=SimpleNamespace())
    ws = FakeWS()
    store = SteeringStore()
    monkeypatch.setattr(
        ws_router._agent_registry,
        "PROVIDER_REGISTRY",
        {
            "test": SimpleNamespace(
                supports_live_steering=True,
            )
        },
    )

    status = await ws_router._apply_steering(
        ws=ws,
        app=app,
        store=store,
        provider_id="test",
        record=record,
        content="Please keep the review pane open.",
    )

    assert status == "accepted"
    assert agent.notes == ["Please keep the review pane open."]
    assert store.queued == []
    assert record.steering_comments == ["Please keep the review pane open."]
    assert record.frames == [
        {
            "type": "activity",
            "event": {"type": "steering_signal", "content": "Please keep the review pane open."},
            "turn_id": "turn-live",
        }
    ]
    assert ws.sent == [
        {"type": "steer_ack", "status": "accepted", "turn_id": "turn-live"}
    ]


@pytest.mark.asyncio
async def test_apply_steering_queues_when_live_transport_declines(monkeypatch):
    agent = LiveSteeringAgent(accepted=False)
    record = ws_router.TurnRecord("turn-queued", "conv-queued")
    record.live_agent = agent
    app = SimpleNamespace(state=SimpleNamespace())
    ws = FakeWS()
    store = SteeringStore()
    monkeypatch.setattr(
        ws_router._agent_registry,
        "PROVIDER_REGISTRY",
        {
            "test": SimpleNamespace(
                supports_live_steering=True,
            )
        },
    )

    status = await ws_router._apply_steering(
        ws=ws,
        app=app,
        store=store,
        provider_id="test",
        record=record,
        content="Use a smaller diff.",
    )

    assert status == "queued"
    assert agent.notes == ["Use a smaller diff."]
    assert store.queued == [("conv-queued", "Use a smaller diff.")]
    assert ws.sent == [
        {"type": "steer_ack", "status": "queued", "turn_id": "turn-queued"}
    ]


@pytest.mark.asyncio
async def test_apply_steering_reports_gone_without_active_running_turn():
    app = SimpleNamespace(state=SimpleNamespace())
    ws = FakeWS()
    store = SteeringStore()

    status = await ws_router._apply_steering(
        ws=ws,
        app=app,
        store=store,
        provider_id="test",
        record=None,
        content="Too late.",
        turn_id="turn-missing",
    )

    assert status == "gone"
    assert store.queued == []
    assert ws.sent == [
        {"type": "steer_ack", "status": "gone", "turn_id": "turn-missing"}
    ]


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


@pytest.mark.asyncio
async def test_handle_message_exposes_live_agent_for_future_interactive_steering(monkeypatch, tmp_path):
    agent = ActivityAgent(slot_id=0, workdir=tmp_path)
    fake_ws = FakeWS()
    started_agents = []

    monkeypatch.setattr(
        ws_router._agent_registry,
        "make_agent",
        lambda provider_id, slot_id, workdir, model_id: agent,
    )

    await ws_router._handle_message(
        fake_ws,
        "inspect",
        "test",
        "test-model",
        memory_context="",
        workdir=tmp_path,
        on_agent_started=started_agents.append,
    )

    assert started_agents == [agent]
    assert await agent.steer("mid-turn note") is False
