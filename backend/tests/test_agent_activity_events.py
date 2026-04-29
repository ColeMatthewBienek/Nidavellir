from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest


def test_activity_event_serializes_frontend_shape():
    from nidavellir.agents.events import AgentActivityEvent

    event = AgentActivityEvent.tool_start(
        provider="codex",
        tool_id="tool-1",
        name="exec",
        args="/bin/bash -lc pwd",
        raw={"type": "item.started"},
    )

    assert event.to_frontend() == {
        "type": "tool_start",
        "provider": "codex",
        "id": "tool-1",
        "name": "exec",
        "args": "/bin/bash -lc pwd",
        "raw": {"type": "item.started"},
    }


def test_codex_cmd_requests_structured_json_stream():
    from nidavellir.agents.codex_agent import CodexAgent

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"), model_id="gpt-5.4")

    assert "exec" in agent.cmd
    assert "--json" in agent.cmd


@pytest.mark.asyncio
async def test_codex_start_uses_large_stream_reader_limit(monkeypatch):
    from nidavellir.agents import codex_agent
    from nidavellir.agents.codex_agent import CodexAgent

    mock_process = MagicMock()
    mock_process.stdin = MagicMock()
    mock_process.stdout = MagicMock()
    create = AsyncMock(return_value=mock_process)
    monkeypatch.setattr(codex_agent.asyncio, "create_subprocess_exec", create)

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"), model_id="gpt-5.4")
    await agent.start()

    assert create.call_args.kwargs["limit"] == codex_agent.CODEX_STREAM_LIMIT_BYTES
    assert create.call_args.kwargs["limit"] >= 16 * 1024 * 1024
    assert create.call_args.kwargs["env"]["UV_CACHE_DIR"] == "/tmp/uv-cache"


@pytest.mark.asyncio
async def test_codex_stream_emits_tool_activity_before_text():
    from nidavellir.agents.codex_agent import CodexAgent

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))
    lines = [
        json.dumps({
            "type": "item.started",
            "item": {
                "id": "call-1",
                "type": "command_execution",
                "command": "/bin/bash -lc pwd",
            },
        }).encode() + b"\n",
        json.dumps({
            "type": "item.completed",
            "item": {
                "id": "call-1",
                "type": "command_execution",
                "status": "success",
                "output": "/tmp\n",
            },
        }).encode() + b"\n",
        json.dumps({
            "type": "item.completed",
            "item": {
                "id": "msg-1",
                "type": "agent_message",
                "text": "I am done.",
            },
        }).encode() + b"\n",
        b"",
    ]
    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    agent._process = mock_process

    items = [item async for item in agent.stream()]

    assert items[0].to_frontend() == {
        "type": "tool_start",
        "provider": "codex",
        "id": "call-1",
        "name": "exec",
        "args": "/bin/bash -lc pwd",
        "raw": {
            "type": "item.started",
            "item": {
                "id": "call-1",
                "type": "command_execution",
                "command": "/bin/bash -lc pwd",
            },
        },
    }
    assert items[1].to_frontend()["type"] == "tool_end"
    assert items[2] == "I am done."


@pytest.mark.asyncio
async def test_codex_stream_dedupes_assistant_message_snapshots():
    from nidavellir.agents.codex_agent import CodexAgent

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))
    lines = [
        json.dumps({
            "type": "item.completed",
            "item": {
                "id": "msg-1",
                "type": "agent_message",
                "text": "First sentence.",
            },
        }).encode() + b"\n",
        json.dumps({
            "type": "item.completed",
            "item": {
                "id": "msg-1",
                "type": "agent_message",
                "text": "First sentence. Second sentence.",
            },
        }).encode() + b"\n",
        json.dumps({
            "type": "item.completed",
            "item": {
                "id": "msg-1",
                "type": "agent_message",
                "text": "First sentence. Second sentence.",
            },
        }).encode() + b"\n",
        b"",
    ]
    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    agent._process = mock_process

    items = [item async for item in agent.stream()]

    assert items == ["First sentence.", " Second sentence."]


@pytest.mark.asyncio
async def test_codex_stream_maps_reasoning_and_file_edits_to_activity():
    from nidavellir.agents.codex_agent import CodexAgent

    agent = CodexAgent(slot_id=0, workdir=Path("/tmp"))
    lines = [
        json.dumps({
            "type": "item.completed",
            "item": {
                "id": "reason-1",
                "type": "reasoning",
                "text": "Need inspect files",
            },
        }).encode() + b"\n",
        json.dumps({
            "type": "item.started",
            "item": {
                "id": "edit-1",
                "type": "file_edit",
                "path": "frontend/src/App.tsx",
            },
        }).encode() + b"\n",
        b"",
    ]
    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    agent._process = mock_process

    events = [item.to_frontend() async for item in agent.stream()]

    assert events[0] == {
        "type": "reasoning_signal",
        "provider": "codex",
        "content": "Need inspect files",
    }
    assert events[1]["type"] == "tool_start"
    assert events[1]["name"] == "file_edit"
    assert events[1]["args"] == "frontend/src/App.tsx"


@pytest.mark.asyncio
async def test_claude_stream_event_emits_tool_start_before_final_message():
    from nidavellir.agents.claude_agent import ClaudeAgent

    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"))
    lines = [
        json.dumps({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "Bash",
                    "input": {"command": "pwd"},
                },
            },
        }).encode() + b"\n",
        json.dumps({
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "Finished."},
                ],
            },
        }).encode() + b"\n",
        b"",
    ]
    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    agent._process = mock_process

    items = [item async for item in agent.stream()]

    assert items[0].to_frontend()["type"] == "tool_start"
    assert items[0].to_frontend()["id"] == "toolu_1"
    assert items[0].to_frontend()["name"] == "Bash"
    assert items[1] == "Finished."


@pytest.mark.asyncio
async def test_claude_stream_event_maps_thinking_to_reasoning_signal():
    from nidavellir.agents.claude_agent import ClaudeAgent

    agent = ClaudeAgent(slot_id=0, workdir=Path("/tmp"))
    lines = [
        json.dumps({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": {
                    "type": "thinking",
                    "thinking": "I need inspect the repo.",
                },
            },
        }).encode() + b"\n",
        b"",
    ]
    mock_stdout = AsyncMock()
    mock_stdout.readline = AsyncMock(side_effect=lines)
    mock_process = MagicMock()
    mock_process.stdout = mock_stdout
    agent._process = mock_process

    events = [item.to_frontend() async for item in agent.stream()]

    assert events == [{
        "type": "reasoning_signal",
        "provider": "claude",
        "content": "I need inspect the repo.",
    }]
