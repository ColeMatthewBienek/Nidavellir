from __future__ import annotations

from typing import Any
from pydantic import BaseModel

from nidavellir.agents.registry import PROVIDER_REGISTRY


class SlotStatus(BaseModel):
    slot_id:       int
    provider_type: str
    status:        str


class AgentPool:
    def __init__(self) -> None:
        self._slots: dict[int, Any] = {}

    def _check_manifest_cap(self, provider_type: str) -> None:
        """Raises RuntimeError if adding a slot would exceed the manifest hard cap."""
        manifest = PROVIDER_REGISTRY.get(provider_type)
        if manifest is None or manifest.max_concurrent_slots is None:
            return
        current = sum(
            1 for slot in self._slots.values()
            if getattr(slot, "provider_type", None) == provider_type
        )
        if current >= manifest.max_concurrent_slots:
            raise RuntimeError(
                f"Provider '{provider_type}' is at its hard cap of "
                f"{manifest.max_concurrent_slots} concurrent slot(s). "
                f"Cannot add another slot."
            )

    def status(self) -> list[SlotStatus]:
        return [
            SlotStatus(
                slot_id=slot_id,
                provider_type=getattr(agent, "provider_type", "unknown"),
                status=getattr(agent, "status", "unknown"),
            )
            for slot_id, agent in self._slots.items()
        ]
