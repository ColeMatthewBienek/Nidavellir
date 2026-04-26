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


def _build_session_ready(
    *,
    provider_id: str,
    model_id: str,
    conversation_id: str,
) -> dict:
    return {
        "type":            "session_ready",
        "provider_id":     provider_id,
        "model_id":        model_id,
        "conversation_id": conversation_id,
    }


def _build_context_update(
    *,
    conversation_id: str | None,
    model: str,
    provider: str,
) -> dict:
    return {
        "type":            "context_update",
        "conversation_id": conversation_id,
        "model":           model,
        "provider":        provider,
    }

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
) -> tuple[str, object]:
    """Runs one full agent turn.

    Returns (full_response_text, agent_instance).
    Caller must kill the agent. Does NOT persist messages.
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
        return "".join(response_parts), agent
    except Exception as exc:
        await ws.send_json({"type": "error", "message": str(exc)})
        return "", agent
    # Note: caller handles kill so usage can be read first


async def _ingest_turn_usage(
    agent,
    provider_id: str,
    model_id: str,
    session_id: str,
    token_store,
) -> dict | None:
    """Read usage from agent, store record, return context totals dict."""
    if token_store is None:
        return None
    try:
        from nidavellir.tokens.adapters import (
            parse_codex_token_lines,
            parse_ollama_done,
            parse_claude_jsonl_entry,
            ProviderUsageResult,
        )
        from nidavellir.tokens.ingestion import ingest_provider_response
        from nidavellir.tokens.claude_reader import read_latest_claude_usage

        usage: ProviderUsageResult | None = None
        request_id = str(uuid.uuid4())

        if provider_id == "claude":
            entry = await read_latest_claude_usage(cwd=WORKDIR)
            if entry:
                usage = parse_claude_jsonl_entry(entry)
                if usage and usage.request_id:
                    request_id = usage.request_id
        elif provider_id == "codex" and hasattr(agent, "get_usage"):
            raw = agent.get_usage()
            if raw:
                usage = parse_codex_token_lines(raw.get("input_tokens"), raw.get("output_tokens"))
        elif provider_id == "ollama" and hasattr(agent, "get_usage"):
            raw = agent.get_usage()
            if raw:
                usage = parse_ollama_done({"prompt_eval_count": raw.get("input_tokens"),
                                           "eval_count": raw.get("output_tokens"),
                                           "model": model_id, "done": True})

        if usage is None:
            usage = ProviderUsageResult(accurate=False)

        ingest_provider_response(token_store, request_id, usage, finish_reason="end_turn")
        return token_store.session_totals(session_id)
    except Exception:
        return None


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

                await ws.send_json(_build_session_ready(
                    provider_id=provider_id,
                    model_id=model_id,
                    conversation_id=conversation_id,
                ))
                # Emit context_update so frontend refreshes pressure for new provider/model
                await ws.send_json(_build_context_update(
                    conversation_id=conversation_id,
                    model=model_id,
                    provider=provider_id,
                ))

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

                response, agent = await _handle_message(
                    ws, content, provider_id, model_id or None,
                    memory_context=memory_context,
                )

                # Read token usage from agent before killing it
                token_store = getattr(ws.app.state, "token_store", None)
                session_totals = await _ingest_turn_usage(
                    agent=agent,
                    provider_id=provider_id,
                    model_id=model_id or DEFAULT_MODEL,
                    session_id=conversation_id or "default",
                    token_store=token_store,
                )

                # Kill agent after usage is read
                if agent is not None:
                    try:
                        await agent.kill()
                    except Exception:
                        pass

                # Signal the frontend to refresh context pressure from payload
                # Do NOT compute current_tokens here — the API endpoint calculates
                # it correctly from conversation_messages (the next request payload).
                try:
                    await ws.send_json({
                        "type":            "context_update",
                        "conversation_id": conversation_id,
                        "model":           model_id or DEFAULT_MODEL,
                        "provider":        provider_id,
                    })
                except Exception:
                    pass

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
