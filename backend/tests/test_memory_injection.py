"""
Tests for SPEC-12A memory injection pass:
  - confidence threshold gating (store vs inject)
  - FTS-exclusive retrieval when results exist
  - recency fallback only when FTS returns nothing
  - fallback logging
  - injection event logging with full payload
  - _handle_message prepends memory_context; DB stores original only
"""
from __future__ import annotations

import json
import pytest

from nidavellir.memory.store import MemoryStore
from nidavellir.memory.injector import get_context_pack, get_context_prefix


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mem(id: str, content: str, *, confidence=0.9, importance=5, tags="", category="project") -> dict:
    return {
        "id":          id,
        "content":     content,
        "category":    category,
        "memory_type": "fact",
        "workflow":    "chat",
        "scope_type":  "workflow",
        "scope_id":    "chat",
        "tags":        tags,
        "confidence":  confidence,
        "importance":  importance,
        "source":      "manual",
    }


# ══════════════════════════════════════════════════════════════════════════════
# 1. Confidence threshold
# ══════════════════════════════════════════════════════════════════════════════

def test_stored_below_inject_threshold_not_in_pack(tmp_path):
    """confidence=0.55 must be stored but must not appear in context pack."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("low", "Low confidence memory", confidence=0.55)])

    active = store.get_active_memories("chat", limit=10)
    assert any(m["id"] == "low" for m in active), "0.55-confidence memory should be stored"

    pack = get_context_pack(store, "Low confidence memory", "chat")
    assert all(m["id"] != "low" for m in pack.memories), "0.55-confidence memory must not be injected"


def test_above_inject_threshold_in_pack(tmp_path):
    """confidence=0.75 must appear in context pack."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("high", "High confidence memory", confidence=0.75)])

    pack = get_context_pack(store, "High confidence memory", "chat")
    assert any(m["id"] == "high" for m in pack.memories), "0.75-confidence memory must be injected"


# ══════════════════════════════════════════════════════════════════════════════
# 2. FTS-exclusive retrieval when results exist
# ══════════════════════════════════════════════════════════════════════════════

def test_fts_results_used_exclusively_when_present(tmp_path, monkeypatch):
    """When FTS matches with sufficient quality, recency-only unrelated memories are not mixed in."""
    store = MemoryStore(str(tmp_path / "mem.db"))

    # Only this one should match the FTS query
    store.save_memories([_mem("fts_hit", "zygote embryonic development", confidence=0.9, tags="biology")])
    # High-importance recency memory — would win in recency sort but should not appear
    store.save_memories([_mem("recency_only", "Python packaging guide", confidence=0.9, importance=10)])

    # BM25 scores in a 2-doc corpus may be weak; force a qualifying score via monkeypatch
    original_search = store.search_fts

    def patched_search(query, workflow, limit=10):
        results = original_search(query, workflow, limit)
        for r in results:
            r["relevance_score"] = -0.5  # force score well below FTS_SCORE_THRESHOLD
        return results

    monkeypatch.setattr(store, "search_fts", patched_search)

    pack = get_context_pack(store, "zygote embryonic", "chat")

    ids = {m["id"] for m in pack.memories}
    assert "fts_hit" in ids,          "FTS-matched memory must be included"
    assert "recency_only" not in ids, "Recency-only memory must not be mixed in when FTS qualifies"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Recency fallback when FTS has no results
# ══════════════════════════════════════════════════════════════════════════════

def test_recency_fallback_when_fts_empty(tmp_path):
    """Query that matches nothing in FTS → recency fallback returns stored memories."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("recent", "A useful project fact", confidence=0.9)])

    pack = get_context_pack(store, "xyznonexistentterm99999", "chat")
    assert any(m["id"] == "recent" for m in pack.memories), "recency fallback must include stored memory"


def test_empty_query_uses_recency(tmp_path):
    """Empty query always falls back to recency."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("recent", "A useful project fact", confidence=0.9)])

    pack = get_context_pack(store, "", "chat")
    assert any(m["id"] == "recent" for m in pack.memories)


# ══════════════════════════════════════════════════════════════════════════════
# 4. Fallback logging
# ══════════════════════════════════════════════════════════════════════════════

def test_fallback_logged_when_fts_returns_nothing(tmp_path):
    """retrieval_fallback event is logged when FTS yields no results."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "Some memory", confidence=0.9)])

    get_context_pack(store, "xyznonexistentterm99999", "chat")

    events = store.get_events(event_type="retrieval_fallback")
    assert events, "retrieval_fallback event must be logged"
    payload = json.loads(events[0]["payload_json"])
    assert "query" in payload
    assert payload["reason"] == "fallback_recency"


def test_fallback_logged_for_empty_query(tmp_path):
    """retrieval_fallback event is logged for empty query."""
    store = MemoryStore(str(tmp_path / "mem.db"))

    get_context_pack(store, "", "chat")

    events = store.get_events(event_type="retrieval_fallback")
    assert events, "retrieval_fallback event must be logged for empty query"


# ══════════════════════════════════════════════════════════════════════════════
# 5. Injection event logging
# ══════════════════════════════════════════════════════════════════════════════

def test_injection_events_logged(tmp_path):
    """An 'injected' event is logged for each memory added to context pack."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI is a backend framework", confidence=0.9, tags="fastapi")])

    pack = get_context_pack(store, "FastAPI backend", "chat", session_id="sess1")

    assert pack.memories, "at least one memory must be injected"
    events = store.get_events(event_type="injected")
    assert events, "injected event must be logged"


def test_injection_event_payload_fields(tmp_path):
    """injected event payload must contain all required fields."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    store.save_memories([_mem("m1", "FastAPI is a backend framework", confidence=0.9, tags="fastapi")])

    get_context_pack(store, "FastAPI backend", "chat", session_id="sess1")

    events = store.get_events(event_type="injected")
    assert events

    payload = json.loads(events[0]["payload_json"])
    for field in ("query", "rank", "score", "reason", "scope_match", "injected"):
        assert field in payload, f"payload missing '{field}'"
    assert payload["injected"] is True


def test_no_injection_events_when_pack_empty(tmp_path):
    """No injected events when nothing passes the confidence threshold."""
    store = MemoryStore(str(tmp_path / "mem.db"))
    # Nothing stored above inject threshold
    store.save_memories([_mem("low", "Low confidence fact", confidence=0.55)])

    get_context_pack(store, "Low confidence fact", "chat")

    events = store.get_events(event_type="injected")
    assert not events, "no injected events when pack is empty"


# ══════════════════════════════════════════════════════════════════════════════
# 6. _handle_message: memory_context prepended; DB stores original
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_handle_message_prepends_memory_context(tmp_path, monkeypatch):
    """_handle_message sends memory_context+content to agent but returns just the response."""
    from nidavellir.routers import ws as ws_router
    import nidavellir.agents.registry as reg_mod

    received_content: list[str] = []

    class FakeAgent:
        async def start(self): pass
        async def send(self, content): received_content.append(content)
        async def stream(self):
            yield "test response"
        async def kill(self): pass

    monkeypatch.setattr(reg_mod, "make_agent", lambda *a, **kw: FakeAgent())

    sent: list[dict] = []

    class FakeWS:
        async def send_json(self, data): sent.append(data)

    response = await ws_router._handle_message(
        ws=FakeWS(),
        content="How do I set up the project?",
        provider_id="claude",
        model_id="claude-haiku-4-5",
        memory_context="## Memory Context\n\n- Use FastAPI.\n\n---\n",
    )

    assert len(received_content) == 1, "agent.send must be called exactly once"
    assert "## Memory Context" in received_content[0], "agent must receive memory prefix"
    assert "How do I set up the project?" in received_content[0], "agent must receive original content"
    assert response == "test response", "_handle_message must return full response string"

    # WebSocket frames
    chunk_frames = [f for f in sent if f.get("type") == "chunk"]
    done_frames  = [f for f in sent if f.get("type") == "done"]
    assert chunk_frames, "chunk frames must be sent"
    assert done_frames,  "done frame must be sent"


@pytest.mark.asyncio
async def test_db_stores_original_not_prefixed(tmp_path, monkeypatch):
    """After a full turn via ws handler pattern, DB stores original user content, not prefixed."""
    from nidavellir.routers import ws as ws_router
    import nidavellir.agents.registry as reg_mod
    import uuid

    store = MemoryStore(str(tmp_path / "mem.db"))
    store.create_conversation("conv1")
    store.save_memories([_mem("m1", "Use FastAPI for the backend.", confidence=0.9, tags="fastapi")])

    class FakeAgent:
        async def start(self): pass
        async def send(self, content): pass
        async def stream(self):
            yield "Agent response"
        async def kill(self): pass

    monkeypatch.setattr(reg_mod, "make_agent", lambda *a, **kw: FakeAgent())

    class FakeWS:
        async def send_json(self, data): pass

    # Simulate what chat_websocket does on first turn
    original_content = "Tell me about the backend"
    assert store.count_conversation_messages("conv1") == 0

    store.append_message("conv1", str(uuid.uuid4()), "user", original_content)

    memory_context = get_context_prefix(store, original_content, "chat")

    response = await ws_router._handle_message(
        ws=FakeWS(),
        content=original_content,
        provider_id="claude",
        model_id="claude-haiku-4-5",
        memory_context=memory_context,
    )

    store.append_message("conv1", str(uuid.uuid4()), "agent", response)

    msgs = store.get_conversation_messages("conv1")
    user_msgs = [m for m in msgs if m["role"] == "user"]
    assert len(user_msgs) == 1
    assert user_msgs[0]["content"] == original_content, "DB must store original, not prefixed"
    assert "Memory Context" not in user_msgs[0]["content"]
