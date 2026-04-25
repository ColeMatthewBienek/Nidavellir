from fastapi import APIRouter, Request

from nidavellir.pool.agent_pool import SlotStatus
from nidavellir.agents.registry import PROVIDER_REGISTRY
from nidavellir.agents.models import list_agent_models

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


@router.get("/models")
async def list_models() -> dict:
    """
    Returns a flat list of all selectable agent model definitions.
    Each entry is a (provider, model) pair the frontend can present in the selector.
    Claude and Codex models are hardcoded; Ollama models are discovered via `ollama list`.
    """
    return {
        "models": [m.to_dict() for m in list_agent_models()]
    }
