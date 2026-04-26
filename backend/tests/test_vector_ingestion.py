"""
Tests for SPEC-12D Phase 2A — Vector Ingestion Layer.

All tests are unit tests that mock Ollama and use an in-memory Qdrant client
so they run offline and fast. Integration against live Ollama is left for
manual verification.
"""
from __future__ import annotations

import httpx
import pytest

from nidavellir.memory.store import MemoryStore


# ── Helpers ───────────────────────────────────────────────────────────────────

FAKE_DIM = 768
FAKE_VEC = [0.1] * FAKE_DIM


def _mem(id: str, content: str, *, confidence=0.9, importance=5) -> dict:
    return {
        "id": id, "content": content, "category": "project",
        "memory_type": "fact", "workflow": "chat",
        "scope_type": "workflow", "scope_id": "chat",
        "tags": "", "confidence": confidence, "importance": importance,
        "source": "manual",
    }


def _fake_embed(text: str, model: str = "nomic-embed-text") -> list[float]:
    return FAKE_VEC


# ══════════════════════════════════════════════════════════════════════════════
# 1. embedding.py unit tests
# ══════════════════════════════════════════════════════════════════════════════

def test_embed_raises_on_connection_error(monkeypatch):
    """embed() must propagate HTTP errors so callers can log them."""
    import nidavellir.memory.embedding as emb

    def bad_post(*a, **kw):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(emb.httpx, "post", bad_post)

    with pytest.raises(httpx.ConnectError):
        emb.embed("anything")


def test_embed_raises_on_non_200(monkeypatch):
    """embed() must raise on a non-200 response."""
    import nidavellir.memory.embedding as emb

    class FakeResp:
        status_code = 500
        def raise_for_status(self): raise httpx.HTTPStatusError("500", request=None, response=self)

    monkeypatch.setattr(emb.httpx, "post", lambda *a, **kw: FakeResp())

    with pytest.raises(httpx.HTTPStatusError):
        emb.embed("anything")


def test_embed_returns_list_from_response(monkeypatch):
    """embed() must extract the 'embedding' key and return a list of floats."""
    import nidavellir.memory.embedding as emb

    class FakeResp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return {"embedding": FAKE_VEC}

    monkeypatch.setattr(emb.httpx, "post", lambda *a, **kw: FakeResp())

    result = emb.embed("hello world")

    assert isinstance(result, list)
    assert len(result) == FAKE_DIM
    assert all(isinstance(v, float) for v in result)


# ══════════════════════════════════════════════════════════════════════════════
# 2. vector_store.py unit tests
# ══════════════════════════════════════════════════════════════════════════════

def test_vector_store_collection_created_on_init():
    """VectorStore must create the Qdrant collection on first init."""
    from nidavellir.memory.vector_store import VectorStore, COLLECTION

    vs = VectorStore(":memory:")

    collections = {c.name for c in vs._client.get_collections().collections}
    assert COLLECTION in collections


def test_vector_store_upsert_stores_point():
    """upsert() must store a retrievable point."""
    from nidavellir.memory.vector_store import VectorStore

    vs = VectorStore(":memory:")
    vs.upsert("mem-001", FAKE_VEC, {"content": "hello", "workflow": "chat"})

    point = vs.get_by_memory_id("mem-001")
    assert point is not None
    assert point["memory_id"] == "mem-001"
    assert point["content"] == "hello"


def test_vector_store_upsert_idempotent():
    """Upserting the same id twice must not create duplicate points."""
    from nidavellir.memory.vector_store import VectorStore, COLLECTION

    vs = VectorStore(":memory:")
    vs.upsert("mem-dup", FAKE_VEC, {"content": "v1"})
    vs.upsert("mem-dup", FAKE_VEC, {"content": "v2"})

    count = vs._client.count(collection_name=COLLECTION).count
    assert count == 1


def test_vector_store_is_ready_returns_true():
    from nidavellir.memory.vector_store import VectorStore

    vs = VectorStore(":memory:")
    assert vs.is_ready() is True


# ══════════════════════════════════════════════════════════════════════════════
# 3. store.py integration — embedding hook
# ══════════════════════════════════════════════════════════════════════════════

def test_save_memories_logs_embedding_created(tmp_path, monkeypatch):
    """After a successful save, embedding_created event must be logged."""
    import nidavellir.memory.embedding as emb
    monkeypatch.setattr(emb, "embed", _fake_embed)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m1", "FastAPI backend")])

    events = store.get_events(event_type="embedding_created")
    assert events, "embedding_created event must be logged"
    assert events[0]["memory_id"] == "m1"


def test_save_memories_embedding_failure_does_not_prevent_save(tmp_path, monkeypatch):
    """If embedding fails, the SQLite write must still succeed."""
    import nidavellir.memory.embedding as emb

    def exploding_embed(text, model="nomic-embed-text"):
        raise RuntimeError("Ollama down")

    monkeypatch.setattr(emb, "embed", exploding_embed)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m2", "Some memory")])

    # Memory must be in SQLite
    active = store.get_active_memories("chat")
    assert any(m["id"] == "m2" for m in active), "memory must still be saved"

    # Failure must be logged
    events = store.get_events(event_type="embedding_failed")
    assert events, "embedding_failed event must be logged"
    assert events[0]["memory_id"] == "m2"


def test_save_memories_skips_embedding_when_no_vector_path(tmp_path, monkeypatch):
    """Store without vector_path must not generate any embedding events."""
    import nidavellir.memory.embedding as emb

    calls: list[str] = []

    def tracking_embed(text, model="nomic-embed-text"):
        calls.append(text)
        return FAKE_VEC

    monkeypatch.setattr(emb, "embed", tracking_embed)

    store = MemoryStore(str(tmp_path / "mem.db"))  # no vector_path
    store.save_memories([_mem("m3", "Memory without vector store")])

    assert not calls, "embed() must not be called when vector_path is None"

    events = store.get_events(event_type="embedding_created")
    assert not events


def test_save_memories_upserts_to_qdrant(tmp_path, monkeypatch):
    """After save, the Qdrant collection must contain the new point."""
    import nidavellir.memory.embedding as emb

    monkeypatch.setattr(emb, "embed", _fake_embed)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m4", "Qdrant test")])

    point = store._vector_store.get_by_memory_id("m4")
    assert point is not None
    assert point["memory_id"] == "m4"


def test_save_memories_low_confidence_not_embedded(tmp_path, monkeypatch):
    """Memories below CONFIDENCE_STORE_THRESHOLD must not be embedded."""
    import nidavellir.memory.embedding as emb

    calls: list[str] = []

    def tracking_embed(text, model="nomic-embed-text"):
        calls.append(text)
        return FAKE_VEC

    monkeypatch.setattr(emb, "embed", tracking_embed)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("low", "Low confidence", confidence=0.3)])

    assert not calls, "embed() must not be called for rejected memories"


def test_embedding_payload_contains_metadata(tmp_path, monkeypatch):
    """The Qdrant payload must include key memory metadata."""
    import nidavellir.memory.embedding as emb

    monkeypatch.setattr(emb, "embed", _fake_embed)

    store = MemoryStore(str(tmp_path / "mem.db"), vector_path=":memory:")
    store.save_memories([_mem("m5", "Metadata test", confidence=0.9, importance=7)])

    payload = store._vector_store.get_by_memory_id("m5")
    assert payload is not None
    assert payload["memory_id"] == "m5"
    assert payload["confidence"] == 0.9
    assert payload["importance"] == 7
    assert payload["workflow"] == "chat"
