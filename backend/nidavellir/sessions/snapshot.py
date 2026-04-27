from __future__ import annotations


def create_snapshot(store, conversation_id: str) -> dict:
    """Extract a lightweight context snapshot from a conversation."""
    messages = store.get_conversation_messages(conversation_id)

    # Build a plain-text summary from message content
    lines = []
    for msg in messages[:20]:  # cap at 20 messages for snapshot
        role = msg.get("role", "unknown")
        content = msg.get("content", "").strip()
        if content:
            lines.append(f"{role}: {content[:300]}")

    summary = "\n".join(lines) if lines else ""

    return {
        "conversation_id": conversation_id,
        "message_count":   len(messages),
        "summary":         summary,
    }
