"""Tests for stale-thread guard and provider/model switch behavior.

Spec: stale-thread-provider-switch-patch-spec.md

Invariants:
  1. Rust-style log lines from Codex must not appear in the stream.
  2. Stale async callbacks (error log lines) must not crash or reach the user.
  3. Provider/model switch preserves an existing conversation_id.
  4. context_update is emitted immediately after new_session.
  5. CodexAgent stderr is drained separately and does not pollute stdout.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest


# ── Test 1: Rust ERROR log lines are filtered from CodexAgent.stream() ────────

@pytest.mark.asyncio
async def test_stream_filters_rust_error_log_lines():
    """Timestamped Rust ERROR lines from Codex must not appear in stream output."""
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
    mock_process.stderr = AsyncMock()
    mock_process.stderr.readline = AsyncMock(side_effect=[b""])
    agent._process = mock_process

    chunks = [chunk async for chunk in agent.stream()]
    full = "".join(chunks)

    assert "ERROR codex_core" not in full, "Rust error must be filtered from stream"
    assert "Hello there." in full, "Normal response must be yielded"
    assert "More content." in full, "Normal response must be yielded"


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
    mock_process.stderr = AsyncMock()
    mock_process.stderr.readline = AsyncMock(side_effect=[b""])
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


# ── Test 5: CodexAgent stderr drain does not propagate to stream ──────────────

@pytest.mark.asyncio
async def test_codex_stderr_drain_does_not_propagate():
    """Error lines on Codex stderr must be swallowed server-side, not yielded."""
    from nidavellir.agents.codex_agent import CodexAgent

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))

    stdout_lines = [
        b"--------\n",
        b"--------\n",
        b"codex\n",
        b"Clean response.\n",
        b"tokens used\n",
        b"10\n",
        b"5\n",
        b"",
    ]
    stderr_lines = [
        b"2026-04-26T23:00:00Z ERROR codex_core::session: stale thread write\n",
        b"",
    ]

    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=stdout_lines)
    mock_stderr = AsyncMock()
    mock_stderr.readline = AsyncMock(side_effect=stderr_lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    mock_process.stderr = mock_stderr
    agent._process = mock_process

    chunks = [chunk async for chunk in agent.stream()]
    full = "".join(chunks)

    assert "Clean response." in full
    assert "ERROR" not in full
    assert "stale thread" not in full
