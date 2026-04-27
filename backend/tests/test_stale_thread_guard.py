"""Tests for stale-thread guard and provider/model switch behavior.

Spec: stale-thread-provider-switch-patch-spec.md

Codex writes its interactive output to stderr; we merge stderr into stdout
(stderr=STDOUT) so the stream state machine sees everything. Rust tracing log
lines that arrive in the merged stream are filtered in stream() before being
yielded to the client.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest


# ── Test 1: Rust ERROR log lines are filtered from CodexAgent.stream() ────────

@pytest.mark.asyncio
async def test_stream_filters_rust_error_log_lines():
    """Timestamped Rust ERROR lines must not appear in stream output."""
    from nidavellir.agents.codex_agent import CodexAgent

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))

    lines = [
        b"--------\n",
        b"--------\n",
        b"codex\n",
        b"Hello there.\n",
        b"2026-04-26T23:04:17.266850Z ERROR codex_core::session: failed to record rollout items: thread abc not found\n",
        b"More content.\n",
        b"tokens used\n",
        b"10\n",
        b"5\n",
        b"",
    ]

    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    agent._process = mock_process

    chunks = [chunk async for chunk in agent.stream()]
    full = "".join(chunks)

    assert "ERROR codex_core" not in full, "Rust error must be filtered"
    assert "Hello there." in full
    assert "More content." in full


# ── Test 2: WARN-level Rust log lines are also filtered ───────────────────────

@pytest.mark.asyncio
async def test_stream_filters_rust_warn_log_lines():
    """Timestamped Rust WARN lines must also be suppressed."""
    from nidavellir.agents.codex_agent import CodexAgent

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))

    lines = [
        b"--------\n",
        b"--------\n",
        b"codex\n",
        b"2026-04-26T10:00:00.000000Z WARN codex_core::rollout: something happened\n",
        b"Real answer.\n",
        b"tokens used\n",
        b"10\n",
        b"5\n",
        b"",
    ]

    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    agent._process = mock_process

    chunks = [chunk async for chunk in agent.stream()]
    full = "".join(chunks)

    assert "WARN codex_core" not in full
    assert "Real answer." in full


# ── Test 3: provider/model switch preserves existing conversation_id ──────────

@pytest.mark.asyncio
async def test_new_session_preserves_provided_conversation_id():
    """When new_session carries a conversation_id, ws must echo it back unchanged."""
    from nidavellir.routers.ws import _build_session_ready

    existing_id = "test-conversation-preserve-abc"
    result = _build_session_ready(
        provider_id="codex",
        model_id="gpt-5.4",
        conversation_id=existing_id,
    )

    assert result["conversation_id"] == existing_id
    assert result["type"] == "session_ready"


# ── Test 4: context_update emitted right after new_session ────────────────────

@pytest.mark.asyncio
async def test_context_update_emitted_on_new_session():
    """new_session must trigger an immediate context_update message."""
    from nidavellir.routers.ws import _build_context_update

    msg = _build_context_update(
        conversation_id="conv-x",
        model="gpt-5.4",
        provider="codex",
    )

    assert msg["type"] == "context_update"
    assert msg["model"] == "gpt-5.4"
    assert msg["provider"] == "codex"
    assert msg["conversation_id"] == "conv-x"


# ── Test 5: multiple Rust log lines interspersed in merged stream are filtered ─

@pytest.mark.asyncio
async def test_multiple_rust_log_lines_all_filtered():
    """All Rust log lines in the merged stdout+stderr stream must be stripped."""
    from nidavellir.agents.codex_agent import CodexAgent

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))

    lines = [
        b"--------\n",
        b"2026-04-26T23:00:00Z WARN codex_core::init: starting up\n",
        b"--------\n",
        b"codex\n",
        b"Clean response.\n",
        b"2026-04-26T23:00:01Z ERROR codex_core::session: stale thread write\n",
        b"Second paragraph.\n",
        b"2026-04-26T23:00:02Z INFO codex_core::rollout: recorded\n",
        b"tokens used\n",
        b"10\n",
        b"5\n",
        b"",
    ]

    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    agent._process = mock_process

    chunks = [chunk async for chunk in agent.stream()]
    full = "".join(chunks)

    assert "Clean response." in full
    assert "Second paragraph." in full
    assert "ERROR" not in full
    assert "WARN" not in full
    assert "INFO" not in full
    assert "codex_core" not in full
