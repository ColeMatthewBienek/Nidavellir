from __future__ import annotations

from typing import Any

from fastapi import WebSocket


def _subscribers(app: Any) -> set[WebSocket]:
    subscribers = getattr(app.state, "command_event_subscribers", None)
    if subscribers is None:
        subscribers = set()
        app.state.command_event_subscribers = subscribers
    return subscribers


def subscribe_command_events(app: Any, ws: WebSocket) -> None:
    _subscribers(app).add(ws)


def unsubscribe_command_events(app: Any, ws: WebSocket) -> None:
    _subscribers(app).discard(ws)


async def broadcast_command_event(app: Any, event: dict[str, Any]) -> None:
    stale: list[WebSocket] = []
    for subscriber in list(_subscribers(app)):
        try:
            await subscriber.send_json({"type": "command_event", "event": event})
        except Exception:
            stale.append(subscriber)
    for subscriber in stale:
        _subscribers(app).discard(subscriber)
