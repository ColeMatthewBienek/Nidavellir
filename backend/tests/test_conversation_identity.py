"""Tests for conversation identity enforcement before chat send.

Spec: conversation-identity-before-send-patch.md

All tests written before implementation (TDD RED → GREEN).
"""
from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.tokens.store import TokenUsageStore
from nidavellir.main import app


def _setup_stores(tmp_path):
    app.state.memory_store = MemoryStore(str(tmp_path / "mem.db"))
    app.state.token_store  = TokenUsageStore(str(tmp_path / "tok.db"))
    return app.state.memory_store


# ── Helpers ────────────────────────────────────────────────────────────────────

class FakeAgent:
    def __init__(self):
        self.sent = []
        self.started = False

    async def start(self): self.started = True

    async def send(self, text: str): self.sent.append(text)

    async def stream(self):
        yield "Agent response text."

    async def kill(self): pass

    def get_usage(self): return None


class FakeWS:
    def __init__(self):
        self.sent_json = []

    async def send_json(self, data): self.sent_json.append(data)

    @property
    def app(self): return app


async def _noop_extract(*args, **kwargs):
    pass


def _conv(store, *, messages=0) -> str:
    cid = str(uuid.uuid4())
    store.create_conversation(cid, workflow="chat", model_id="claude-sonnet-4-6", provider_id="claude")
    for i in range(messages):
        role = "user" if i % 2 == 0 else "agent"
        store.append_message(cid, str(uuid.uuid4()), role, f"Turn {i} content")
    return cid


def test_conversation_messages_have_persisted_status(tmp_path):
    store = _setup_stores(tmp_path)
    cid = str(uuid.uuid4())
    mid = str(uuid.uuid4())
    store.create_conversation(cid)
    store.append_message(cid, mid, "user", "Do the work.", status="running")

    msg = store.get_conversation_messages(cid)[0]
    assert msg["status"] == "running"

    assert store.update_message_status(mid, "interrupted")
    assert store.get_conversation_messages(cid)[0]["status"] == "interrupted"


# ── Backend Test 1 — message without conversation_id creates one ───────────────

@pytest.mark.asyncio
async def test_first_message_without_conversation_id_creates_conversation(tmp_path, monkeypatch):
    """When message arrives with no conversation_id, backend must create one and persist."""
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    store = _setup_stores(tmp_path)
    agent = FakeAgent()
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: agent)
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    from nidavellir.routers import ws as ws_router
    ws = FakeWS()

    # Simulate message handler with no active conversation_id
    result_id = await ws_router.handle_message_with_identity(
        ws=ws,
        content="Hello, this is my first message.",
        conversation_id=None,
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        workflow="chat",
        store=store,
        token_store=None,
    )

    # A conversation must have been created
    assert result_id is not None and result_id != ""
    conv = store.get_conversation(result_id)
    assert conv, "Conversation must exist in DB"

    # User message must be persisted
    msgs = store.get_conversation_messages(result_id)
    user_msgs = [m for m in msgs if m["role"] == "user"]
    assert len(user_msgs) >= 1
    assert user_msgs[0]["content"] == "Hello, this is my first message."


# ── Backend Test 2 — follow-up loads prior messages into provider payload ──────

@pytest.mark.asyncio
async def test_follow_up_includes_prior_messages_in_payload(tmp_path, monkeypatch):
    """Follow-up send must include prior turns in the outbound payload."""
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    store = _setup_stores(tmp_path)
    agent = FakeAgent()
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: agent)
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    from nidavellir.routers import ws as ws_router
    ws = FakeWS()

    # Seed a conversation with prior turns
    cid = str(uuid.uuid4())
    store.create_conversation(cid, workflow="chat", model_id="claude-sonnet-4-6", provider_id="claude")
    store.append_message(cid, str(uuid.uuid4()), "user",  "Write a 100 word happy story.")
    store.append_message(cid, str(uuid.uuid4()), "agent", "Once upon a time in a sunny village...")

    await ws_router.handle_message_with_identity(
        ws=ws,
        content="Make it rhyme in a rap pattern.",
        conversation_id=cid,
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        workflow="chat",
        store=store,
        token_store=None,
    )

    # The agent must have received the prior conversation history in its payload
    assert len(agent.sent) == 1
    payload = agent.sent[0]
    assert "happy story" in payload.lower() or "sunny village" in payload.lower(), (
        "Prior messages must appear in outbound provider payload"
    )
    assert "rap pattern" in payload.lower() or "make it rhyme" in payload.lower()


@pytest.mark.asyncio
async def test_interrupted_prior_user_request_is_not_active_instruction(tmp_path, monkeypatch):
    """Interrupted turn status, not dangling shape, must drive resume context."""
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    store = _setup_stores(tmp_path)
    agent = FakeAgent()
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: agent)
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    cid = str(uuid.uuid4())
    store.create_conversation(cid, workflow="chat", model_id="gpt-5.5", provider_id="codex")
    store.append_message(
        cid,
        str(uuid.uuid4()),
        "user",
        "Bugfix the resume provider and model retention.",
        status="interrupted",
    )

    ws = FakeWS()
    await ws_router.handle_message_with_identity(
        ws=ws,
        content="What model are you?",
        conversation_id=cid,
        provider_id="codex",
        model_id="gpt-5.5",
        workflow="chat",
        store=store,
        token_store=None,
    )

    assert len(agent.sent) == 1
    payload = agent.sent[0]
    assert "Interrupted prior user request, not completed" in payload
    assert "Do not act on this unless the current user message explicitly asks to continue it" in payload
    assert payload.rstrip().endswith("What model are you?")


@pytest.mark.asyncio
async def test_successful_turn_marks_user_and_agent_messages_completed(tmp_path, monkeypatch):
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    store = _setup_stores(tmp_path)
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: FakeAgent())
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    ws = FakeWS()
    cid = await ws_router.handle_message_with_identity(
        ws=ws,
        content="What model are you?",
        conversation_id=None,
        provider_id="codex",
        model_id="gpt-5.5",
        workflow="chat",
        store=store,
        token_store=None,
    )

    messages = store.get_conversation_messages(cid)
    assert [m["role"] for m in messages] == ["user", "agent"]
    assert [m["status"] for m in messages] == ["completed", "completed"]


@pytest.mark.asyncio
async def test_child_session_injects_handoff_seed_into_payload(tmp_path, monkeypatch):
    """A continued child session must inject its seed into the outbound payload."""
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    from nidavellir.sessions.continuity import switch_session

    store = _setup_stores(tmp_path)
    agent = FakeAgent()
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: agent)
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    parent_id = str(uuid.uuid4())
    store.create_conversation(parent_id, workflow="chat", model_id="claude-sonnet-4-6", provider_id="claude")
    store.append_message(parent_id, str(uuid.uuid4()), "user", "Write a happy story about a lighthouse.")
    store.append_message(parent_id, str(uuid.uuid4()), "agent", "The lighthouse smiled over a silver bay.")
    child_id = switch_session(
        store,
        parent_id,
        new_provider="codex",
        new_model="gpt-5.4",
        mode="continue_with_prior_context",
    )

    ws = FakeWS()
    await ws_router.handle_message_with_identity(
        ws=ws,
        content="Make it rhyme like a rap.",
        conversation_id=child_id,
        provider_id="codex",
        model_id="gpt-5.4",
        workflow="chat",
        store=store,
        token_store=None,
    )

    assert len(agent.sent) == 1
    payload = agent.sent[0]
    assert "prior session context" in payload.lower()
    assert "lighthouse" in payload.lower()
    assert "make it rhyme" in payload.lower()


@pytest.mark.asyncio
async def test_child_session_seed_expires_after_8_turns(tmp_path, monkeypatch):
    """Seed must not be injected once the child has eight completed turns."""
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    from nidavellir.sessions.continuity import switch_session

    store = _setup_stores(tmp_path)
    agent = FakeAgent()
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: agent)
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    parent_id = str(uuid.uuid4())
    store.create_conversation(parent_id)
    store.append_message(parent_id, str(uuid.uuid4()), "user", "The prior topic was a lighthouse.")
    store.append_message(parent_id, str(uuid.uuid4()), "agent", "A lighthouse guided ships.")
    child_id = switch_session(
        store,
        parent_id,
        new_provider="codex",
        new_model="gpt-5.4",
        mode="continue_with_prior_context",
    )
    for i in range(16):
        role = "user" if i % 2 == 0 else "agent"
        store.append_message(child_id, str(uuid.uuid4()), role, f"Child turn content {i}")

    ws = FakeWS()
    await ws_router.handle_message_with_identity(
        ws=ws,
        content="Continue.",
        conversation_id=child_id,
        provider_id="codex",
        model_id="gpt-5.4",
        workflow="chat",
        store=store,
        token_store=None,
    )

    assert len(agent.sent) == 1
    payload = agent.sent[0]
    assert "prior session context" not in payload.lower()


# ── Backend Test 3 — unknown conversation_id sends WS error ───────────────────

@pytest.mark.asyncio
async def test_unknown_conversation_id_sends_error(tmp_path, monkeypatch):
    """If conversation_id is provided but not in DB, send WS error and skip agent."""
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    store = _setup_stores(tmp_path)
    agent = FakeAgent()
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: agent)
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    from nidavellir.routers import ws as ws_router
    ws = FakeWS()

    await ws_router.handle_message_with_identity(
        ws=ws,
        content="Hello.",
        conversation_id="ghost-id-that-does-not-exist",
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        workflow="chat",
        store=store,
        token_store=None,
    )

    # Agent must NOT have been called
    assert not agent.started, "Agent must not start for unknown conversation"
    assert not agent.sent

    # WS must have received an error frame
    error_frames = [f for f in ws.sent_json if f.get("type") == "error"]
    assert error_frames, "WS error frame must be sent for unknown conversation_id"
    assert any("conversation_not_found" in str(f) for f in error_frames)


# ── Backend Test 4 — assistant response persisted to same conversation ─────────

@pytest.mark.asyncio
async def test_assistant_response_persisted_to_same_conversation(tmp_path, monkeypatch):
    """Agent response must be saved to the same conversation."""
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    store = _setup_stores(tmp_path)
    agent = FakeAgent()
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: agent)
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    from nidavellir.routers import ws as ws_router
    ws = FakeWS()

    result_id = await ws_router.handle_message_with_identity(
        ws=ws,
        content="Tell me a joke.",
        conversation_id=None,
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        workflow="chat",
        store=store,
        token_store=None,
    )

    msgs = store.get_conversation_messages(result_id)
    agent_msgs = [m for m in msgs if m["role"] == "agent"]
    assert len(agent_msgs) >= 1
    assert agent_msgs[0]["content"] == "Agent response text."


# ── Backend Test 5 — context_update includes conversation_id after normal turn ─

@pytest.mark.asyncio
async def test_context_update_has_conversation_id_after_turn(tmp_path, monkeypatch):
    """After a normal turn, context_update must include a non-empty conversation_id."""
    import nidavellir.agents.registry as reg
    from nidavellir.routers import ws as ws_router
    store = _setup_stores(tmp_path)
    monkeypatch.setattr(reg, "make_agent", lambda *a, **kw: FakeAgent())
    monkeypatch.setattr(ws_router, "_extract_and_store", _noop_extract)

    from nidavellir.routers import ws as ws_router
    ws = FakeWS()

    await ws_router.handle_message_with_identity(
        ws=ws,
        content="Ping.",
        conversation_id=None,
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        workflow="chat",
        store=store,
        token_store=None,
    )

    ctx_updates = [f for f in ws.sent_json if f.get("type") == "context_update"]
    assert ctx_updates, "context_update must be emitted after turn"
    assert all(f.get("conversation_id") for f in ctx_updates), (
        "Every context_update must have a non-empty conversation_id"
    )

    suppressed = [f for f in ws.sent_json
                  if f.get("event") == "context_update_suppressed"]
    assert not suppressed, "context_update_suppressed must not occur in normal flow"
