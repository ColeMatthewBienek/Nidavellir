from __future__ import annotations

import asyncio
import json
import logging
import traceback
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import nidavellir.agents.registry as _agent_registry
from nidavellir.agents.events import frontend_event
from nidavellir.memory.injector import get_context_prefix
from nidavellir.prompt.assembly import assemble_prompt
from nidavellir.prompt.models import PromptAssemblyResult, PromptSection
from nidavellir.project_instructions.discovery import discover_project_instructions
from nidavellir.sessions.handoff import build_seed, mode_uses_prior_context, normalize_handoff_mode
from nidavellir.sessions.snapshot import create_snapshot
from nidavellir.skills.activation import activate_skills
from nidavellir.skills.compilers.generic import GenericSkillCompiler
from nidavellir.skills.models import SkillTaskContext
from nidavellir.workspace import effective_default_working_directory

_log = logging.getLogger(__name__)

router = APIRouter(tags=["ws"])

DEFAULT_PROVIDER = "claude"
DEFAULT_MODEL    = "claude-sonnet-4-6"
WORKDIR          = Path(effective_default_working_directory())


class TurnRecord:
    def __init__(self, turn_id: str, conversation_id: str | None) -> None:
        self.turn_id = turn_id
        self.conversation_id = conversation_id
        self.status = "running"
        self.frames: list[dict[str, Any]] = []
        self.steering_comments: list[str] = []
        self.live_agent: Any | None = None
        self.subscribers: set[WebSocket] = set()
        self.task: asyncio.Task | None = None


class TurnBroadcaster:
    """WebSocket-like sender that buffers turn frames and fans out to attached clients."""

    def __init__(self, app: Any, record: TurnRecord) -> None:
        self.app = app
        self.record = record

    async def send_json(self, payload: dict[str, Any]) -> None:
        frame = dict(payload)
        frame.setdefault("turn_id", self.record.turn_id)
        frame_type = frame.get("type")
        if frame_type == "done":
            self.record.status = "completed"
        elif frame_type == "cancelled":
            self.record.status = "cancelled"
        elif frame_type == "error":
            self.record.status = "interrupted"
        self.record.frames.append(frame)
        stale: list[WebSocket] = []
        for subscriber in list(self.record.subscribers):
            try:
                await subscriber.send_json(frame)
            except Exception:
                stale.append(subscriber)
        for subscriber in stale:
            self.record.subscribers.discard(subscriber)


def _turn_registry(app: Any) -> dict[str, TurnRecord]:
    registry = getattr(app.state, "active_turns", None)
    if registry is None:
        registry = {}
        app.state.active_turns = registry
    return registry


async def _attach_turn_subscriber(record: TurnRecord, ws: WebSocket) -> None:
    record.subscribers.add(ws)
    for frame in record.frames:
        await ws.send_json(frame)


async def _apply_steering(
    *,
    ws: WebSocket,
    app: Any,
    store: Any,
    provider_id: str,
    record: TurnRecord | None,
    content: str,
    turn_id: str | None = None,
) -> str:
    """Apply a mid-turn steering note through the best available transport.

    Interactive providers may accept the note live through CLIAgent.steer().
    One-shot providers persist the note so the next turn prompt can include it.
    """
    if not record or record.status != "running":
        await ws.send_json({
            "type": "steer_ack",
            "status": "gone",
            "turn_id": turn_id,
        })
        return "gone"

    record.steering_comments.append(content)
    manifest = _agent_registry.PROVIDER_REGISTRY.get(provider_id)
    live_sent = False
    if manifest and manifest.supports_live_steering and record.live_agent is not None:
        try:
            live_sent = bool(await record.live_agent.steer(content))
        except Exception:
            _log.exception("live_steering_failed", extra={
                "provider": provider_id,
                "turn_id": record.turn_id,
                "conversation_id": record.conversation_id,
            })
            live_sent = False

    if not live_sent and store is not None and record.conversation_id and hasattr(store, "queue_steering_comment"):
        store.queue_steering_comment(record.conversation_id, content)

    await TurnBroadcaster(app, record).send_json({
        "type": "activity",
        "event": {"type": "steering_signal", "content": content},
    })
    status = "accepted" if live_sent else "queued"
    await ws.send_json({
        "type": "steer_ack",
        "status": status,
        "turn_id": record.turn_id,
    })
    return status


async def _retire_turn_later(app: Any, turn_id: str, delay_seconds: int = 300) -> None:
    await asyncio.sleep(delay_seconds)
    _turn_registry(app).pop(turn_id, None)


def _build_session_ready(
    *,
    provider_id: str,
    model_id: str,
    conversation_id: str,
    working_directory: str | None = None,
    working_directory_display: str | None = None,
) -> dict:
    payload = {
        "type":            "session_ready",
        "provider_id":     provider_id,
        "model_id":        model_id,
        "conversation_id": conversation_id,
    }
    if working_directory:
        payload["working_directory"] = working_directory
        payload["working_directory_display"] = working_directory_display or working_directory
    return payload


def _build_context_update(
    *,
    conversation_id: str | None,
    model: str,
    provider: str,
) -> dict | None:
    """Return a context_update payload, or None if conversation_id is missing."""
    import logging
    if not conversation_id:
        logging.getLogger(__name__).warning(
            "context_update_suppressed",
            extra={"reason": "missing_conversation_id"},
        )
        return None
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


class MemoryExtractionError(RuntimeError):
    """Extraction failure with diagnostic payload safe for memory_events."""

    def __init__(self, message: str, payload: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.payload = payload or {}


def _sample_text(text: str, limit: int = 500) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


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
    stdout, stderr = await proc.communicate(prompt.encode())
    raw = stdout.decode().strip()
    stderr_text = stderr.decode(errors="replace").strip()

    if proc.returncode != 0:
        raise MemoryExtractionError(
            "memory extraction subprocess failed",
            {
                "stage": "claude_subprocess",
                "returncode": proc.returncode,
                "model": model_id,
                "workflow": workflow,
                "stderr_sample": _sample_text(stderr_text),
                "stdout_sample": _sample_text(raw),
                "transcript_chars": len(transcript),
            },
        )

    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    if not raw:
        raise MemoryExtractionError(
            "memory extraction returned empty output",
            {
                "stage": "parse_extraction_output",
                "model": model_id,
                "workflow": workflow,
                "stderr_sample": _sample_text(stderr_text),
                "stdout_sample": "",
                "transcript_chars": len(transcript),
            },
        )

    try:
        memories: list[dict] = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MemoryExtractionError(
            "memory extraction returned invalid JSON",
            {
                "stage": "parse_extraction_output",
                "model": model_id,
                "workflow": workflow,
                "error": str(exc),
                "json_error_line": exc.lineno,
                "json_error_column": exc.colno,
                "stderr_sample": _sample_text(stderr_text),
                "stdout_sample": _sample_text(raw),
                "transcript_chars": len(transcript),
            },
        ) from exc

    if not isinstance(memories, list):
        raise MemoryExtractionError(
            "memory extraction JSON was not an array",
            {
                "stage": "validate_extraction_output",
                "model": model_id,
                "workflow": workflow,
                "output_type": type(memories).__name__,
                "stdout_sample": _sample_text(raw),
                "transcript_chars": len(transcript),
            },
        )

    for m in memories:
        if not isinstance(m, dict):
            raise MemoryExtractionError(
                "memory extraction array contained a non-object item",
                {
                    "stage": "validate_extraction_output",
                    "model": model_id,
                    "workflow": workflow,
                    "item_type": type(m).__name__,
                    "stdout_sample": _sample_text(raw),
                    "transcript_chars": len(transcript),
                },
            )
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
    messages: list[dict] = []
    transcript = ""
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
        payload: dict[str, Any] = {
            "stage": "store_extraction",
            "error": str(exc),
            "error_type": type(exc).__name__,
            "conversation_id": conversation_id,
            "workflow": workflow,
            "model": model_id,
            "message_count": len(messages),
            "transcript_chars": len(transcript),
            "traceback": _sample_text("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)), 2000),
        }
        if isinstance(exc, MemoryExtractionError):
            payload.update(exc.payload)
            payload.setdefault("error", str(exc))
            payload["error_type"] = type(exc).__name__
            payload["conversation_id"] = conversation_id
            payload["message_count"] = len(messages)
            payload["transcript_chars"] = len(transcript)

        _log.exception("memory_extraction_failed", extra={"diagnostics": payload})
        store.log_event(
            event_type="extraction_failed",
            event_subject="extraction",
            session_id=conversation_id,
            payload=payload,
        )


async def _handle_message(
    ws: WebSocket,
    content: str,
    provider_id: str,
    model_id: str | None,
    memory_context: str = "",
    workdir: Path | None = None,
    workdir_explicit: bool = False,
    on_agent_started=None,
) -> tuple[str, object, str]:
    """Runs one full agent turn.

    Returns (full_response_text, agent_instance).
    Caller must kill the agent. Does NOT persist messages.
    """
    agent = None
    response_parts: list[str] = []
    heartbeat_task: asyncio.Task | None = None

    async def send_activity(event: dict) -> None:
        await ws.send_json({"type": "activity", "event": event})

    async def heartbeat() -> None:
        elapsed = 0
        try:
            while True:
                await asyncio.sleep(10)
                elapsed += 10
                await send_activity({
                    "type": "progress",
                    "content": f"Provider is still working ({elapsed}s elapsed)",
                })
        except asyncio.CancelledError:
            raise
        except Exception:
            return

    try:
        run_workdir = workdir or WORKDIR
        _preflight_agent_workdir(run_workdir, explicit=workdir_explicit)
        await send_activity({
            "type": "progress",
            "content": f"Starting {provider_id} in {run_workdir}",
            "metadata": {"working_directory": str(run_workdir.resolve(strict=False))},
        })
        agent = _agent_registry.make_agent(provider_id, slot_id=0, workdir=run_workdir, model_id=model_id)
        await agent.start()
        if on_agent_started is not None:
            on_agent_started(agent)
        await send_activity({
            "type": "progress",
            "content": "Provider process started",
        })

        outbound = (
            f"{memory_context}\n\nCurrent user message:\nUser: {content}"
            if memory_context else content
        )
        await agent.send(outbound)
        await send_activity({
            "type": "progress",
            "content": "Prompt sent to provider",
        })
        heartbeat_task = asyncio.create_task(heartbeat())

        async for item in agent.stream():
            if isinstance(item, dict) or hasattr(item, "to_frontend"):
                await send_activity(frontend_event(item))
                continue
            chunk = str(item)
            if not chunk:
                continue
            response_parts.append(chunk)
            await ws.send_json({"type": "chunk", "content": chunk})

        if heartbeat_task is not None:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
        await send_activity({
            "type": "progress",
            "content": "Provider stream finished",
        })
        await ws.send_json({"type": "done"})
        return "".join(response_parts), agent, "completed"
    except asyncio.CancelledError:
        if heartbeat_task is not None:
            heartbeat_task.cancel()
        if agent is not None:
            try:
                await agent.kill()
            except Exception:
                pass
        try:
            await ws.send_json({"type": "cancelled"})
        except Exception:
            pass
        return "", agent, "cancelled"
    except Exception as exc:
        if heartbeat_task is not None:
            heartbeat_task.cancel()
        await ws.send_json({"type": "error", "message": str(exc)})
        return "", agent, "interrupted"
    # Note: caller handles kill so usage can be read first


async def _ingest_turn_usage(
    agent,
    provider_id: str,
    model_id: str,
    session_id: str,
    token_store,
    workdir: Path | None = None,
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
        usage_workdir = workdir or WORKDIR

        if provider_id == "claude":
            entry = await read_latest_claude_usage(cwd=usage_workdir)
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


def _build_conversation_history(messages: list[dict]) -> str:
    """Format prior conversation turns into a text block for the provider payload."""
    if not messages:
        return ""
    lines = []
    for msg in messages:
        role    = msg.get("role", "unknown").capitalize()
        content = (msg.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines)


def _split_interrupted_tail(messages: list[dict]) -> tuple[list[dict], dict | None]:
    """Separate a persisted interrupted/cancelled user request from history."""
    interrupted_statuses = {"pending", "running", "interrupted", "cancelled"}
    completed = [msg for msg in messages if msg.get("status", "completed") == "completed"]
    if (
        messages
        and messages[-1].get("role") == "user"
        and messages[-1].get("status") in interrupted_statuses
    ):
        return completed, messages[-1]
    return completed, None


def _conversation_workdir(conv: dict | None) -> Path:
    if conv and conv.get("working_directory"):
        return Path(conv["working_directory"])
    return WORKDIR


def _conversation_workdir_explicit(conv: dict | None) -> bool:
    return bool(conv and conv.get("working_directory"))


def _looks_like_empty_scratch_workdir(path: Path) -> bool:
    try:
        entries = [item.name for item in path.iterdir() if item.name not in {".gitkeep"}]
    except OSError:
        return False
    return path.name == "workspace" and not entries


def _preflight_agent_workdir(path: Path, *, explicit: bool) -> None:
    if not path.exists():
        raise RuntimeError(f"working_directory_not_found: {path}")
    if not path.is_dir():
        raise RuntimeError(f"working_directory_not_a_directory: {path}")
    if not os_access_writable(path):
        raise RuntimeError(f"working_directory_not_writable: {path}")
    if not explicit and _looks_like_empty_scratch_workdir(path):
        raise RuntimeError(
            "working_directory_empty_scratch: set /cwd to the project directory before running an agent"
        )


def os_access_writable(path: Path) -> bool:
    import os
    return os.access(path, os.W_OK)


def resolve_new_session_state(
    *,
    store,
    requested_conversation_id: str | None,
    requested_provider: str,
    requested_model: str,
    workflow: str = "chat",
) -> tuple[str, str, str]:
    """Resolve websocket session state without overwriting an existing conversation.

    Reconnect/resume is server-authoritative: if the conversation exists, keep its
    persisted active provider/model even when the frontend has stale local state.
    """
    conversation_id = requested_conversation_id or str(uuid.uuid4())
    if store is None:
        return conversation_id, requested_provider, requested_model

    conv = store.get_conversation(conversation_id)
    if conv:
        provider = conv.get("active_provider") or conv.get("provider_id") or requested_provider
        model = conv.get("active_model") or conv.get("model_id") or requested_model
        return conversation_id, provider, model

    store.create_conversation(
        conversation_id,
        workflow=workflow,
        model_id=requested_model,
        provider_id=requested_provider,
        working_directory=effective_default_working_directory(),
        working_directory_display=effective_default_working_directory(),
    )
    return conversation_id, requested_provider, requested_model


def switch_active_session_for_conversation(
    store,
    conversation_id: str,
    *,
    new_provider: str,
    new_model: str,
    mode: str = "start_clean",
) -> dict:
    """Create a new execution session boundary without changing conversation id."""
    conv = store.get_conversation(conversation_id)
    if not conv:
        raise ValueError("conversation_not_found")

    prior_messages = store.get_conversation_messages(conversation_id)
    seed_text: str | None = None
    if mode_uses_prior_context(mode):
        snap = create_snapshot(store, conversation_id)
        if snap["message_count"] > 0:
            seed_text = build_seed(snap)

    session_id = str(uuid.uuid4())
    store.update_conversation(
        conversation_id,
        {
            "active_session_id": session_id,
            "active_provider": new_provider,
            "active_model": new_model,
            "provider_id": new_provider,
            "model_id": new_model,
            "continuity_mode": normalize_handoff_mode(mode),
            "seed_text": seed_text,
            "seed_turn_start": len(prior_messages) // 2,
        },
    )
    return {
        "conversation_id": conversation_id,
        "session_id": session_id,
        "seed": seed_text,
        "mode": normalize_handoff_mode(mode),
    }


def ensure_context_capacity_for_conversation(
    store,
    conversation_id: str,
    *,
    provider_id: str,
    model_id: str,
) -> dict:
    """Roll over to a seeded active session when the conversation payload is blocked."""
    from nidavellir.tokens.context_meter import compute_context_pressure, estimate_payload_tokens

    messages = store.get_conversation_messages(conversation_id)
    current_tokens = estimate_payload_tokens(messages)
    if hasattr(store, "active_file_text_tokens"):
        current_tokens += store.active_file_text_tokens(conversation_id)
    pressure = compute_context_pressure(current_tokens, model_id, provider_id)
    pressure_dict = {
        "current_tokens": pressure.current_tokens,
        "usable_tokens": pressure.usable_tokens,
        "percent_used": pressure.percent_used,
        "state": pressure.state,
    }
    conv = store.get_conversation(conversation_id)
    if pressure.state != "blocked":
        return {
            "rolled_over": False,
            "conversation_id": conversation_id,
            "session_id": conv.get("active_session_id") if conv else None,
            "pressure": pressure_dict,
        }

    switched = switch_active_session_for_conversation(
        store,
        conversation_id,
        new_provider=provider_id,
        new_model=model_id,
        mode="continue_with_prior_context",
    )
    return {
        "rolled_over": True,
        "conversation_id": conversation_id,
        "session_id": switched["session_id"],
        "pressure": pressure_dict,
    }


def _build_provider_context(
    *,
    store,
    conversation_id: str,
    prior_messages: list[dict],
    current_content: str,
    workflow: str,
) -> tuple[str, bool, int]:
    """Build non-user context prepended to the provider request."""
    from nidavellir.sessions.handoff import should_inject_seed
    from nidavellir.tokens.context_meter import estimate_payload_tokens

    turn_number = len(prior_messages) // 2
    is_first_turn = len(prior_messages) == 0
    context_parts: list[str] = []
    completed_messages, interrupted_tail = _split_interrupted_tail(prior_messages)

    conv = store.get_conversation(conversation_id)
    seed = conv.get("seed_text") if conv else store.get_conversation_seed(conversation_id)
    seed_turn_start = int(conv.get("seed_turn_start") or 0) if conv else 0
    includes_seed = bool(seed and should_inject_seed(max(0, turn_number - seed_turn_start)))
    history_start = seed_turn_start * 2 if includes_seed else 0
    history_text = _build_conversation_history(completed_messages[history_start:])
    if history_text:
        context_parts.append(
            "Prior transcript for background only. The current user message is the only instruction to act on."
        )
        context_parts.append(history_text)
    if interrupted_tail:
        interrupted_content = (interrupted_tail.get("content") or "").strip()
        if interrupted_content:
            context_parts.append(
                "Interrupted prior user request, not completed. Do not act on this unless the current user message explicitly asks to continue it:\n"
                f"User: {interrupted_content}"
            )
    if hasattr(store, "pop_queued_steering_comments"):
        queued_steering = store.pop_queued_steering_comments(conversation_id)
        if queued_steering:
            lines = "\n".join(f"- {item}" for item in queued_steering)
            context_parts.append(
                "Queued steering notes from the user during the previous active turn. "
                "Treat these as constraints/background for the current user message, not as a separate completed request:\n"
                f"{lines}"
            )
    if includes_seed:
        context_parts.append(seed)
    file_context = store.build_file_context_block(conversation_id) if hasattr(store, "build_file_context_block") else ""
    if file_context:
        context_parts.append(file_context)

    if is_first_turn:
        prefix = get_context_prefix(store, current_content, workflow, session_id=conversation_id)
        if prefix:
            context_parts.append(prefix)

    memory_context = "\n\n".join(part.strip() for part in context_parts if part and part.strip())
    seed_tokens = estimate_payload_tokens([{"role": "system", "content": seed or ""}]) if includes_seed else 0
    _log.debug("handoff_seed_loaded_for_payload", extra={
        "event": "handoff_seed_loaded_for_payload",
        "conversation_id": conversation_id,
        "seed_present": bool(seed),
        "seed_length": len(seed or ""),
        "turn_index": turn_number,
        "should_inject_seed": includes_seed,
    })
    return memory_context, includes_seed, seed_tokens


def _build_prompt_assembly(
    *,
    store,
    skill_store,
    conversation_id: str,
    provider_id: str,
    model_id: str,
    current_content: str,
    memory_context: str,
    workdir: Path,
) -> PromptAssemblyResult:
    """Build the provider payload through structured sections."""
    sections: list[PromptSection] = []
    from nidavellir.project_instructions.discovery import default_global_instruction_files
    project_instructions = discover_project_instructions(
        cwd=workdir,
        provider=provider_id,
        global_instruction_files=default_global_instruction_files(),
    )
    if project_instructions.rendered_text:
        sections.append(PromptSection(
            name="project instructions",
            content=project_instructions.rendered_text,
            source="project_instructions",
            token_estimate=project_instructions.token_estimate,
            metadata={
                "instruction_paths": [item.path for item in project_instructions.instructions],
                "instruction_scopes": [item.scope for item in project_instructions.instructions],
                "suppressed": [item.model_dump(mode="json") for item in project_instructions.suppressed],
            },
        ))

    if memory_context:
        sections.append(PromptSection(
            name="conversation/session context",
            content=memory_context,
            source="conversation",
        ))

    selected_files: list[str] = []
    if hasattr(store, "list_conversation_files"):
        try:
            selected_files = [row.get("original_path") or row.get("file_name") for row in store.list_conversation_files(conversation_id)]
            selected_files = [path for path in selected_files if path]
        except Exception:
            selected_files = []

    if skill_store is not None:
        context = SkillTaskContext(
            conversation_id=conversation_id,
            session_id=conversation_id,
            user_message=current_content,
            repo_path=str(workdir),
            selected_files=selected_files,
            provider=provider_id,
            model=model_id,
        )
        activation = activate_skills(skill_store.list_skills(), context)
        compiled = GenericSkillCompiler().compile(
            activation.activated,
            suppressed=[item.model_dump() for item in activation.suppressed],
        )
        if compiled.prompt_fragment:
            sections.append(PromptSection(
                name="activated skills",
                content=compiled.prompt_fragment,
                source="skills",
                token_estimate=compiled.estimated_tokens,
                metadata={
                    "injected_skill_ids": compiled.injected_skill_ids,
                    "suppressed_skill_ids": [item["skill_id"] for item in compiled.suppressed],
                },
            ))
        for log in activation.logs:
            try:
                skill_store.log_activation(
                    skill_id=log.skill_id,
                    conversation_id=conversation_id,
                    session_id=conversation_id,
                    provider=provider_id,
                    model=model_id,
                    trigger_reason=log.reason,
                    score=log.score,
                    matched_triggers=log.matched_triggers,
                    compatibility_status=log.compatibility_status,
                    diagnostics=[],
                    token_estimate=log.token_estimate,
                    injected=log.injected,
                )
            except Exception:
                _log.exception("skill_activation_log_failed")

    sections.append(PromptSection(
        name="user message",
        content=current_content,
        source="user",
    ))
    return assemble_prompt(sections)


async def handle_message_with_identity(
    *,
    ws,
    content: str,
    conversation_id: str | None,
    provider_id: str,
    model_id: str,
    workflow: str = "chat",
    store,
    token_store,
    on_agent_started=None,
) -> str | None:
    """Handle one user message turn with full conversation identity enforcement.

    Returns the resolved conversation_id (may differ from input if auto-created).
    Sends WS error and returns None if the conversation cannot be resolved.
    """
    # ── Resolve conversation identity ─────────────────────────────────────────
    if conversation_id:
        # Validate provided id exists — reject phantoms
        conv = store.get_conversation(conversation_id)
        if not conv:
            _log.warning("chat_send_rejected", extra={
                "event": "chat_send_rejected",
                "reason": "conversation_not_found",
                "conversation_id": conversation_id,
            })
            await ws.send_json({
                "type":            "error",
                "error":           "conversation_not_found",
                "conversation_id": conversation_id,
            })
            return None
    else:
        # Auto-create on first send
        conversation_id = str(uuid.uuid4())
        store.create_conversation(
            conversation_id,
            workflow=workflow,
            model_id=model_id,
            provider_id=provider_id,
            working_directory=effective_default_working_directory(),
            working_directory_display=effective_default_working_directory(),
        )
        _log.info("conversation_created_for_send", extra={
            "event":           "conversation_created_for_send",
            "conversation_id": conversation_id,
            "reason":          "missing_conversation_id_on_first_send",
        })
        try:
            await ws.send_json({
                "type":            "conversation_created",
                "conversation_id": conversation_id,
            })
        except Exception:
            pass
        conv = store.get_conversation(conversation_id)

    # ── Build provider payload with conversation history ──────────────────────
    prior_messages = store.get_conversation_messages(conversation_id)
    workdir = _conversation_workdir(conv)
    workdir_explicit = _conversation_workdir_explicit(conv)

    # Persist user message BEFORE building payload
    user_message_id = str(uuid.uuid4())
    store.append_message(conversation_id, user_message_id, "user", content, status="running")
    _log.debug("conversation_message_persisted", extra={
        "event": "conversation_message_persisted",
        "conversation_id": conversation_id,
        "role": "user",
    })

    memory_context, includes_seed, seed_tokens = _build_provider_context(
        store=store,
        conversation_id=conversation_id,
        prior_messages=prior_messages,
        current_content=content,
        workflow=workflow,
    )
    skill_store = getattr(ws.app.state, "skill_store", None)
    assembly = _build_prompt_assembly(
        store=store,
        skill_store=skill_store,
        conversation_id=conversation_id,
        provider_id=provider_id,
        model_id=model_id or DEFAULT_MODEL,
        current_content=content,
        memory_context=memory_context,
        workdir=workdir,
    )

    _log.debug("provider_payload_built", extra={
        "event":           "provider_payload_built",
        "conversation_id": conversation_id,
        "message_count":   len(prior_messages) + 1,
        "provider":        provider_id,
        "model":           model_id,
        "includes_handoff_seed": includes_seed,
        "handoff_seed_tokens_estimate": seed_tokens,
        "injected_skill_ids": assembly.injected_skill_ids,
    })

    # ── Run agent ─────────────────────────────────────────────────────────────
    response, agent, outcome = await _handle_message(
        ws, assembly.rendered_text, provider_id, model_id or None,
        memory_context="",
        workdir=workdir,
        workdir_explicit=workdir_explicit,
        on_agent_started=on_agent_started,
    )

    # Read token usage before killing
    await _ingest_turn_usage(
        agent=agent,
        provider_id=provider_id,
        model_id=model_id or DEFAULT_MODEL,
        session_id=conversation_id,
        token_store=token_store,
        workdir=workdir,
    )
    if agent is not None:
        try:
            await agent.kill()
        except Exception:
            pass

    # ── Persist assistant response ─────────────────────────────────────────────
    if response:
        store.update_message_status(user_message_id, "completed")
        store.append_message(conversation_id, str(uuid.uuid4()), "agent", response, status="completed")
        _log.debug("conversation_message_persisted", extra={
            "event": "conversation_message_persisted",
            "conversation_id": conversation_id,
            "role": "agent",
        })
        asyncio.create_task(
            _extract_and_store(store=store, conversation_id=conversation_id, workflow=workflow)
        )
    else:
        store.update_message_status(
            user_message_id,
            "cancelled" if outcome == "cancelled" else "interrupted",
        )

    # ── Emit context_update ───────────────────────────────────────────────────
    try:
        _cu = _build_context_update(
            conversation_id=conversation_id,
            model=model_id or DEFAULT_MODEL,
            provider=provider_id,
        )
        if _cu:
            await ws.send_json(_cu)
    except Exception:
        pass

    return conversation_id


@router.websocket("/api/ws")
async def chat_websocket(ws: WebSocket) -> None:
    await ws.accept()

    provider_id:     str       = DEFAULT_PROVIDER
    model_id:        str       = DEFAULT_MODEL
    workflow:        str       = "chat"
    conversation_id: str | None = None
    store = None
    current_task: asyncio.Task | None = None
    current_turn_id: str | None = None

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
                requested_provider = data.get("provider_id", DEFAULT_PROVIDER)
                requested_model    = data.get("model_id",    DEFAULT_MODEL)
                workflow           = data.get("workflow",    "chat")
                conversation_id, provider_id, model_id = resolve_new_session_state(
                    store=store,
                    requested_conversation_id=data.get("conversation_id"),
                    requested_provider=requested_provider,
                    requested_model=requested_model,
                    workflow=workflow,
                )
                conv = store.get_conversation(conversation_id) if store else None
                workdir = _conversation_workdir(conv)
                workdir_display = (
                    conv.get("working_directory_display")
                    if conv and conv.get("working_directory_display")
                    else str(workdir)
                )

                await ws.send_json(_build_session_ready(
                    provider_id=provider_id,
                    model_id=model_id,
                    conversation_id=conversation_id,
                    working_directory=str(workdir),
                    working_directory_display=workdir_display,
                ))
                # Emit context_update so frontend refreshes pressure for new provider/model
                _cu = _build_context_update(
                    conversation_id=conversation_id,
                    model=model_id,
                    provider=provider_id,
                )
                if _cu:
                    await ws.send_json(_cu)

            elif msg_type == "session_switch":
                if current_task and not current_task.done():
                    current_task.cancel()
                    try:
                        await current_task
                    except asyncio.CancelledError:
                        pass
                    current_task = None
                    current_turn_id = None
                mode     = data.get("mode", "clean")
                old_id   = data.get("old_conversation_id") or conversation_id
                new_prov = data.get("provider_id", provider_id)
                new_mod  = data.get("model_id",    model_id)
                _log.info("session_switch_requested", extra={
                    "event": "session_switch_requested",
                    "decision": mode,
                    "parent_conversation_id": old_id,
                    "target_provider": new_prov,
                    "target_model": new_mod,
                })

                if store is not None and old_id:
                    try:
                        switched = switch_active_session_for_conversation(
                            store,
                            old_id,
                            new_provider=new_prov,
                            new_model=new_mod,
                            mode=mode,
                        )
                        conversation_id = switched["conversation_id"]
                    except Exception:
                        conversation_id = str(uuid.uuid4())
                else:
                    conversation_id = str(uuid.uuid4())

                provider_id = new_prov
                model_id    = new_mod

                seed = store.get_conversation_seed(conversation_id) if store else None
                conv = store.get_conversation(conversation_id) if store else {}
                await ws.send_json({
                    "type":            "session_switch_ready",
                    "conversation_id": conversation_id,
                    "session_id":       conv.get("active_session_id"),
                    "provider_id":      provider_id,
                    "model_id":         model_id,
                    "provider":         provider_id,
                    "model":            model_id,
                    "working_directory": conv.get("working_directory") or str(_conversation_workdir(conv)),
                    "working_directory_display": conv.get("working_directory_display") or str(_conversation_workdir(conv)),
                    "mode":            normalize_handoff_mode(mode),
                    "seed":            seed,
                })
                _cu2 = _build_context_update(
                    conversation_id=conversation_id,
                    model=model_id,
                    provider=provider_id,
                )
                if _cu2:
                    await ws.send_json(_cu2)

            elif msg_type == "message":
                content = data.get("content", "").strip()
                if not content:
                    continue
                turn_id = data.get("turn_id") or str(uuid.uuid4())
                registry = _turn_registry(ws.app)
                existing_turn = registry.get(turn_id)
                if existing_turn and existing_turn.status == "running":
                    existing_turn.subscribers.add(ws)
                    await ws.send_json({
                        "type": "resume_connection_ready",
                        "turn_id": turn_id,
                        "conversation_id": existing_turn.conversation_id,
                        "status": existing_turn.status,
                    })
                    continue
                if current_task and not current_task.done():
                    await ws.send_json({"type": "error", "message": "agent already running"})
                    continue

                # Use conversation_id from message payload if provided
                # (handles reconnect case where WS scope lost its identity)
                msg_conv_id = data.get("conversation_id") or conversation_id
                if store is not None and msg_conv_id:
                    try:
                        conv = store.get_conversation(msg_conv_id)
                    except Exception:
                        conv = None
                    if conv:
                        provider_id = (
                            conv.get("active_provider")
                            or conv.get("provider_id")
                            or provider_id
                        )
                        model_id = (
                            conv.get("active_model")
                            or conv.get("model_id")
                            or model_id
                        )

                record = TurnRecord(turn_id, msg_conv_id)
                record.subscribers.add(ws)
                registry[turn_id] = record
                broadcaster = TurnBroadcaster(ws.app, record)
                current_turn_id = turn_id

                async def run_turn() -> None:
                    nonlocal conversation_id, current_task, current_turn_id
                    try:
                        ws.app.state.agent_running = True
                        if store is not None:
                            token_store = getattr(ws.app.state, "token_store", None)
                            result_conv_id = await handle_message_with_identity(
                                ws=broadcaster,
                                content=content,
                                conversation_id=msg_conv_id,
                                provider_id=provider_id,
                                model_id=model_id or DEFAULT_MODEL,
                                workflow=workflow,
                                store=store,
                                token_store=token_store,
                                on_agent_started=lambda agent: setattr(record, "live_agent", agent),
                            )
                            if result_conv_id:
                                conversation_id = result_conv_id
                        else:
                            # No store — fall back to stateless single-turn mode
                            response, agent, _outcome = await _handle_message(
                                broadcaster, content, provider_id, model_id or None,
                                memory_context="",
                                on_agent_started=lambda agent: setattr(record, "live_agent", agent),
                            )
                            token_store = getattr(ws.app.state, "token_store", None)
                            await _ingest_turn_usage(
                                agent=agent,
                                provider_id=provider_id,
                                model_id=model_id or DEFAULT_MODEL,
                                session_id=conversation_id or "default",
                                token_store=token_store,
                                workdir=WORKDIR,
                            )
                            if agent is not None:
                                try:
                                    await agent.kill()
                                except Exception:
                                    pass
                    except asyncio.CancelledError:
                        try:
                            await broadcaster.send_json({"type": "cancelled"})
                        except Exception:
                            pass
                    finally:
                        ws.app.state.agent_running = False
                        record.subscribers.discard(ws)
                        current_task = None
                        current_turn_id = None
                        asyncio.create_task(_retire_turn_later(ws.app, record.turn_id))

                current_task = asyncio.create_task(run_turn())
                record.task = current_task

            elif msg_type == "resume_connection":
                turn_id = data.get("turn_id")
                registry = _turn_registry(ws.app)
                record = registry.get(turn_id) if turn_id else None
                if not record:
                    await ws.send_json({
                        "type": "resume_connection_ready",
                        "turn_id": turn_id,
                        "conversation_id": data.get("conversation_id"),
                        "status": "gone",
                    })
                    continue
                await _attach_turn_subscriber(record, ws)
                current_turn_id = record.turn_id
                current_task = record.task
                await ws.send_json({
                    "type": "resume_connection_ready",
                    "turn_id": record.turn_id,
                    "conversation_id": record.conversation_id,
                    "status": record.status,
                })

            elif msg_type == "cancel":
                turn_id = data.get("turn_id") or current_turn_id
                record = _turn_registry(ws.app).get(turn_id) if turn_id else None
                task = record.task if record else current_task
                if task and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                    current_task = None
                    current_turn_id = None
                else:
                    await ws.send_json({"type": "cancelled"})

            elif msg_type == "steer":
                content = (data.get("content") or "").strip()
                if not content:
                    continue
                turn_id = data.get("turn_id") or current_turn_id
                record = _turn_registry(ws.app).get(turn_id) if turn_id else None
                await _apply_steering(
                    ws=ws,
                    app=ws.app,
                    store=store,
                    provider_id=provider_id,
                    record=record,
                    content=content,
                    turn_id=turn_id,
                )

            elif msg_type == "redirect":
                content = (data.get("content") or "").strip()
                if not content:
                    continue
                turn_id = data.get("turn_id") or current_turn_id
                record = _turn_registry(ws.app).get(turn_id) if turn_id else None
                if not record or record.status != "running":
                    await ws.send_json({
                        "type": "redirect_ack",
                        "status": "gone",
                        "turn_id": turn_id,
                    })
                    continue
                record.steering_comments.append(content)
                if store is not None and record.conversation_id and hasattr(store, "queue_steering_comment"):
                    store.queue_steering_comment(record.conversation_id, content)
                await TurnBroadcaster(ws.app, record).send_json({
                    "type": "activity",
                    "event": {"type": "steering_signal", "content": f"Redirected: {content}"},
                })
                task = record.task if record else current_task
                if task and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                    current_task = None
                    current_turn_id = None
                await ws.send_json({
                    "type": "redirect_ack",
                    "status": "queued",
                    "turn_id": record.turn_id,
                })

    except WebSocketDisconnect:
        if current_turn_id:
            record = _turn_registry(ws.app).get(current_turn_id)
            if record:
                record.subscribers.discard(ws)
        pass
