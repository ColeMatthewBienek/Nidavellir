"""
Tests for context meter fix — SPEC context-meter-fix-spec.md.

Context pressure must derive from the next request payload (conversation messages),
never from accumulated session token totals in token_usage_records.

All tests written before implementation.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient, ASGITransport

from nidavellir.main import app
from nidavellir.tokens.store import TokenUsageStore
from nidavellir.tokens.context_meter import (
    estimate_payload_tokens,
    compute_context_pressure,
)
from nidavellir.memory.store import MemoryStore


def _token_store(tmp_path):
    s = TokenUsageStore(str(tmp_path / "tokens.db"))
    app.state.token_store = s
    return s


def _memory_store(tmp_path):
    s = MemoryStore(str(tmp_path / "memory.db"))
    app.state.memory_store = s
    return s


def _large_usage_record(store, session_id="s1"):
    """Insert high historical token usage that must NOT affect context pressure."""
    store.insert({
        "id":                     str(uuid.uuid4()),
        "request_id":             str(uuid.uuid4()),
        "session_id":             session_id,
        "provider":               "anthropic",
        "model":                  "claude-sonnet-4-6",
        "preflight_input_tokens": None,
        "preflight_source":       None,
        "reported_input_tokens":  150_000,   # huge — near limit
        "reported_output_tokens": 30_000,
        "reported_total_tokens":  180_000,
        "suspect":                False,
        "anomaly":                False,
    })


# ══════════════════════════════════════════════════════════════════════════════
# 1. Unit — estimate_payload_tokens
# ══════════════════════════════════════════════════════════════════════════════

def test_estimate_payload_tokens_empty():
    assert estimate_payload_tokens([]) == 0


def test_estimate_payload_tokens_from_messages():
    messages = [
        {"role": "user",  "content": "Hello world"},
        {"role": "agent", "content": "Hi there, how can I help you today?"},
    ]
    tokens = estimate_payload_tokens(messages)
    assert tokens > 0
    # Rough sanity: total chars / 4 ≈ token estimate
    total_chars = sum(len(m["content"]) for m in messages)
    assert tokens == pytest.approx(total_chars // 4, abs=2)


def test_estimate_payload_tokens_scales_with_content():
    short_msg = [{"role": "user", "content": "Hi"}]
    long_msg  = [{"role": "user", "content": "A" * 4000}]
    assert estimate_payload_tokens(long_msg) > estimate_payload_tokens(short_msg)


# ══════════════════════════════════════════════════════════════════════════════
# 2. High historical usage, small next payload → LOW pressure
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_high_historical_small_payload_gives_low_pressure(tmp_path):
    """High session token totals must NOT cause high context pressure."""
    token_store  = _token_store(tmp_path)
    memory_store = _memory_store(tmp_path)

    conv_id = str(uuid.uuid4())
    memory_store.create_conversation(conv_id)

    # Insert massive historical usage records — these must be ignored
    _large_usage_record(token_store, session_id=conv_id)

    # Next payload is tiny — just one short message
    memory_store.append_message(conv_id, str(uuid.uuid4()), "user", "Hi")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"/api/context/usage?conversation_id={conv_id}"
                        f"&model=claude-sonnet-4-6&provider=anthropic")

    assert r.status_code == 200
    body = r.json()
    # A one-word message should be < 1% of 192k tokens
    assert body["percentUsed"] < 1.0, (
        f"Expected low pressure from tiny payload, got {body['percentUsed']}%. "
        f"currentTokens={body['currentTokens']} — session totals must not be used."
    )
    assert body["state"] == "ok"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Low historical usage, large next payload → HIGH pressure
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_low_historical_large_payload_gives_high_pressure(tmp_path):
    """Large next payload must cause high context pressure regardless of history."""
    _token_store(tmp_path)   # empty — no historical records
    memory_store = _memory_store(tmp_path)

    conv_id = str(uuid.uuid4())
    memory_store.create_conversation(conv_id)

    # Fill the conversation with large messages (simulating a long context)
    big_content = "A" * 140_000  # ~35k tokens at 4 chars/token
    memory_store.append_message(conv_id, str(uuid.uuid4()), "user",  big_content)
    memory_store.append_message(conv_id, str(uuid.uuid4()), "agent", big_content)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"/api/context/usage?conversation_id={conv_id}"
                        f"&model=claude-sonnet-4-6&provider=anthropic")

    body = r.json()
    # ~70k tokens in 192k usable → ~36% — should be "warn" or higher
    assert body["percentUsed"] > 20.0, (
        f"Expected high pressure from large payload, got {body['percentUsed']}%."
    )


# ══════════════════════════════════════════════════════════════════════════════
# 4. /api/context/usage returns payload-based currentTokens
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_context_usage_returns_payload_token_count(tmp_path):
    """currentTokens must equal the estimated tokens of conversation messages."""
    _token_store(tmp_path)
    memory_store = _memory_store(tmp_path)

    conv_id = str(uuid.uuid4())
    memory_store.create_conversation(conv_id)

    content = "Hello, how are you today?"
    memory_store.append_message(conv_id, str(uuid.uuid4()), "user", content)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"/api/context/usage?conversation_id={conv_id}"
                        f"&model=claude-sonnet-4-6&provider=anthropic")

    body = r.json()
    expected_tokens = len(content) // 4
    # Allow a small tolerance for implementation variance
    assert abs(body["currentTokens"] - expected_tokens) <= 5, (
        f"currentTokens {body['currentTokens']} != estimated payload tokens {expected_tokens}"
    )


# ══════════════════════════════════════════════════════════════════════════════
# 5. Model switch recalculates against new model limit, same payload
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_model_switch_recalculates_pressure_same_payload(tmp_path):
    """Same payload gives different percentUsed for different model context limits."""
    _token_store(tmp_path)
    memory_store = _memory_store(tmp_path)

    conv_id = str(uuid.uuid4())
    memory_store.create_conversation(conv_id)

    content = "B" * 40_000   # ~10k tokens
    memory_store.append_message(conv_id, str(uuid.uuid4()), "user", content)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r_claude = await c.get(
            f"/api/context/usage?conversation_id={conv_id}"
            f"&model=claude-sonnet-4-6&provider=anthropic"
        )
        r_codex  = await c.get(
            f"/api/context/usage?conversation_id={conv_id}"
            f"&model=gpt-5.4&provider=codex"
        )

    body_claude = r_claude.json()
    body_codex  = r_codex.json()

    # Same payload, but Codex has smaller context → higher percentage
    assert body_codex["percentUsed"] > body_claude["percentUsed"], (
        "Smaller context model must show higher pressure for identical payload"
    )
    # currentTokens must be identical (same conversation messages)
    assert body_claude["currentTokens"] == body_codex["currentTokens"]


# ══════════════════════════════════════════════════════════════════════════════
# 6. Session totals still accumulate in dashboard (separate path unchanged)
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_dashboard_still_uses_historical_records(tmp_path):
    """Dashboard token totals must still reflect accumulated historical records."""
    token_store  = _token_store(tmp_path)
    _memory_store(tmp_path)

    _large_usage_record(token_store, session_id="s1")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/tokens/dashboard")

    body = r.json()
    # The large record must appear in dashboard totals
    total_input = sum(p["total_input"] for p in body["providers"])
    assert total_input == 150_000, (
        "Dashboard must still reflect historical usage records"
    )
