from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import nidavellir.agents.registry as _agent_registry
from nidavellir.memory.injector import get_context_prefix

router = APIRouter(tags=["ws"])

DEFAULT_PROVIDER = "claude"
DEFAULT_MODEL    = "claude-sonnet-4-6"
WORKDIR          = Path(os.environ.get("NIDAVELLIR_WORKDIR", "./workspace"))

_EXTRACTION_MODEL = "claude-haiku-4-5"

_EXTRACTION_PROMPT = """\
You are a memory extraction assistant. Given a conversation, extract key facts, decisions, preferences, or insights worth remembering for future sessions.

Return ONLY a JSON array of memory objects (no other text). Each object must have:
  - "id": unique string (use uuid format)
  - "content": the memory text (concise, self-contained)
  - "category": one of: decision, preference, project, insight, person, task, thought
  - "memory_type": one of: fact, decision, preference, procedure, warning, relationship, task, tool_result
  - "confidence": float 0.0-1.0
  - "importance": integer 1-10
  - "tags": comma-separated keywords or ""

Return [] if nothing is worth remembering.

Conversation:
{transcript}
"""


async def extract_memories(
    transcript: str,
    workflow: str,
    model_id: str = _EXTRACTION_MODEL,
) -> list[dict]:
    """Run claude --print to extract memories. Module-level so tests can monkeypatch."""
    prompt = _EXTRACTION_PROMPT.format(transcript=transcript)

    proc = await asyncio.create_subprocess_exec(
        "claude", "--print", "--model", model_id,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate(prompt.encode())
    raw = stdout.decode().strip()

    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    memories: list[dict] = json.loads(raw)
    for m in memories:
        m.setdefault("id", str(uuid.uuid4()))
        m["workflow"]   = workflow
        m["scope_type"] = "workflow"
        m["scope_id"]   = workflow
        m["source"]     = "extracted"
    return memories


async def _extract_and_store(
    *,
    store,
    conversation_id: str,
    workflow: str,
    model_id: str = _EXTRACTION_MODEL,
) -> None:
    """Fire-and-forget extraction. Swallows all exceptions and logs extraction_failed."""
    try:
        messages = store.get_conversation_messages(conversation_id)
        if not messages:
            return

        lines = []
        for msg in messages:
            role    = msg.get("role", "unknown")
            content = msg.get("content", "")
            lines.append(f"{role}: {content}")
        transcript = "\n".join(lines)

        memories = await extract_memories(transcript, workflow, model_id)
        if memories:
            store.save_memories(memories)
    except Exception as exc:
        store.log_event(
            event_type="extraction_failed",
            event_subject="extraction",
            payload={"error": str(exc)},
        )


async def _handle_message(
    ws: WebSocket,
    content: str,
    provider_id: str,
    model_id: str | None,
    memory_context: str = "",
) -> str:
    """Runs one full agent turn.

    Prepends memory_context to the outbound prompt but never persists it.
    Returns the full agent response string. Does NOT persist messages.
    All exceptions are caught and sent as error frames.
    """
    agent = None
    response_parts: list[str] = []
    try:
        WORKDIR.mkdir(parents=True, exist_ok=True)
        agent = _agent_registry.make_agent(provider_id, slot_id=0, workdir=WORKDIR, model_id=model_id)
        await agent.start()

        outbound = f"{memory_context}\n\n{content}" if memory_context else content
        await agent.send(outbound)

        async for chunk in agent.stream():
            response_parts.append(chunk)
            await ws.send_json({"type": "chunk", "content": chunk})

        await ws.send_json({"type": "done"})
        return "".join(response_parts)
    except Exception as exc:
        await ws.send_json({"type": "error", "message": str(exc)})
        return ""
    finally:
        if agent is not None:
            try:
                await agent.kill()
            except Exception:
                pass


@router.websocket("/api/ws")
async def chat_websocket(ws: WebSocket) -> None:
    await ws.accept()

    provider_id:     str       = DEFAULT_PROVIDER
    model_id:        str       = DEFAULT_MODEL
    workflow:        str       = "chat"
    conversation_id: str | None = None
    store = None

    try:
        store = ws.app.state.memory_store
    except AttributeError:
        pass

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await ws.send_json({"type": "pong"})

            elif msg_type == "new_session":
                provider_id     = data.get("provider_id", DEFAULT_PROVIDER)
                model_id        = data.get("model_id",    DEFAULT_MODEL)
                workflow        = data.get("workflow",    "chat")
                conversation_id = data.get("conversation_id") or str(uuid.uuid4())

                if store is not None:
                    try:
                        store.create_conversation(
                            conversation_id,
                            workflow=workflow,
                            model_id=model_id,
                            provider_id=provider_id,
                        )
                    except Exception:
                        pass

                await ws.send_json({
                    "type":            "session_ready",
                    "provider_id":     provider_id,
                    "model_id":        model_id,
                    "conversation_id": conversation_id,
                })

            elif msg_type == "message":
                content = data.get("content", "").strip()
                if not content:
                    continue

                memory_context = ""
                if store is not None and conversation_id is not None:
                    # Detect first turn BEFORE appending the user message
                    is_first_turn = store.count_conversation_messages(conversation_id) == 0
                    store.append_message(
                        conversation_id, str(uuid.uuid4()), "user", content
                    )
                    if is_first_turn:
                        memory_context = get_context_prefix(
                            store, content, workflow,
                            session_id=conversation_id,
                        )

                response = await _handle_message(
                    ws, content, provider_id, model_id or None,
                    memory_context=memory_context,
                )

                if store is not None and conversation_id is not None and response:
                    store.append_message(
                        conversation_id, str(uuid.uuid4()), "agent", response
                    )
                    asyncio.create_task(
                        _extract_and_store(
                            store=store,
                            conversation_id=conversation_id,
                            workflow=workflow,
                        )
                    )

    except WebSocketDisconnect:
        pass
