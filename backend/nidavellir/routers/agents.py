from fastapi import APIRouter, Request

from nidavellir.pool.agent_pool import SlotStatus
from nidavellir.agents.registry import PROVIDER_REGISTRY

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("", response_model=list[SlotStatus])
async def list_agents(request: Request) -> list[SlotStatus]:
    pool = getattr(request.app.state, "agent_pool", None)
    if pool is None:
        return []
    return pool.status()


@router.get("/providers")
async def list_providers() -> dict:
    """
    Returns the full provider manifest for all registered providers.
    The frontend uses this as its single source of truth — no provider
    metadata should be hardcoded in frontend code.
    """
    return {
        "providers": [m.to_api_dict() for m in PROVIDER_REGISTRY.values()]
    }
