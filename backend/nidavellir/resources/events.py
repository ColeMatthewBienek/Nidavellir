from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket


def _subscribers(app: Any) -> set[WebSocket]:
    subscribers = getattr(app.state, "resource_event_subscribers", None)
    if subscribers is None:
        subscribers = set()
        app.state.resource_event_subscribers = subscribers
    return subscribers


def subscribe_resource_events(app: Any, ws: WebSocket) -> None:
    _subscribers(app).add(ws)


def unsubscribe_resource_events(app: Any, ws: WebSocket) -> None:
    _subscribers(app).discard(ws)


async def broadcast_resource_event(app: Any, event: dict[str, Any]) -> None:
    payload = {
        "revision": getattr(app.state, "resource_event_revision", 0) + 1,
        "created_at": datetime.now(UTC).isoformat(),
        **event,
    }
    app.state.resource_event_revision = payload["revision"]

    stale: list[WebSocket] = []
    for subscriber in list(_subscribers(app)):
        try:
            await subscriber.send_json({"type": "resource_event", "event": payload})
        except Exception:
            stale.append(subscriber)
    for subscriber in stale:
        _subscribers(app).discard(subscriber)
