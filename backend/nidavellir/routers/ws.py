import os
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from nidavellir.agents.registry import make_agent

router = APIRouter(tags=["ws"])

DEFAULT_PROVIDER = "claude"
DEFAULT_MODEL    = "claude-sonnet-4-6"
WORKDIR          = Path(os.environ.get("NIDAVELLIR_WORKDIR", "./workspace"))


async def _handle_message(
    ws: WebSocket, content: str, provider_id: str, model_id: str | None
) -> None:
    """Runs one full agent turn. All exceptions are caught and sent as error frames.
    Kill failures are swallowed so they never propagate to the connection loop."""
    agent = None
    try:
        WORKDIR.mkdir(parents=True, exist_ok=True)
        agent = make_agent(provider_id, slot_id=0, workdir=WORKDIR, model_id=model_id)
        await agent.start()
        await agent.send(content)
        async for chunk in agent.stream():
            await ws.send_json({"type": "chunk", "content": chunk})
        await ws.send_json({"type": "done"})
    except Exception as exc:
        await ws.send_json({"type": "error", "message": str(exc)})
    finally:
        if agent is not None:
            try:
                await agent.kill()
            except Exception:
                pass  # kill failures never propagate


@router.websocket("/api/ws")
async def chat_websocket(ws: WebSocket) -> None:
    await ws.accept()

    # Per-connection provider/model selection
    provider_id: str = DEFAULT_PROVIDER
    model_id:    str = DEFAULT_MODEL

    try:
        while True:  # connection loop — only exits on WebSocketDisconnect
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await ws.send_json({"type": "pong"})

            elif msg_type == "new_session":
                provider_id = data.get("provider_id", DEFAULT_PROVIDER)
                model_id    = data.get("model_id",    DEFAULT_MODEL)
                await ws.send_json({
                    "type":        "session_ready",
                    "provider_id": provider_id,
                    "model_id":    model_id,
                })

            elif msg_type == "message":
                content = data.get("content", "").strip()
                if not content:
                    continue
                await _handle_message(ws, content, provider_id, model_id or None)

    except WebSocketDisconnect:
        pass
    # Do NOT catch bare Exception — let real errors surface in logs
