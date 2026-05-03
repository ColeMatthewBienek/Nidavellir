from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from nidavellir.pool.agent_pool import SlotStatus
from nidavellir.agents.registry import PROVIDER_REGISTRY
from nidavellir.agents.models import list_agent_models
from nidavellir.agents.safety import ProviderDangerousness, ProviderSafetyStore

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("", response_model=list[SlotStatus])
async def list_agents(request: Request) -> list[SlotStatus]:
    pool = getattr(request.app.state, "agent_pool", None)
    if pool is None:
        return []
    return pool.status()


class ProviderSafetyUpdate(BaseModel):
    dangerousness: ProviderDangerousness


def _safety_store(request: Request) -> ProviderSafetyStore | None:
    return getattr(request.app.state, "provider_safety_store", None)


def _provider_payloads(request: Request) -> list[dict]:
    store = _safety_store(request)
    policies = {policy.provider_id: policy for policy in store.list_policies()} if store else {}
    payloads = []
    for manifest in PROVIDER_REGISTRY.values():
        payload = manifest.to_api_dict()
        policy = policies.get(manifest.id)
        if policy:
            payload.update({
                "dangerousness": policy.dangerousness,
                "effective_dangerousness": policy.effective_dangerousness,
                "dangerousness_warning": policy.warning,
            })
        payloads.append(payload)
    return payloads


@router.get("/providers")
async def list_providers(request: Request) -> dict:
    """
    Returns the full provider manifest for all registered providers.
    The frontend uses this as its single source of truth — no provider
    metadata should be hardcoded in frontend code.
    """
    return {
        "providers": _provider_payloads(request)
    }


@router.get("/provider-policies")
async def list_provider_policies(request: Request) -> dict:
    store = _safety_store(request)
    if store is None:
        raise HTTPException(status_code=503, detail="provider_safety_store_not_available")
    return {"policies": [policy.model_dump(mode="json") for policy in store.list_policies()]}


@router.put("/provider-policies/{provider_id}")
async def update_provider_policy(provider_id: str, body: ProviderSafetyUpdate, request: Request) -> dict:
    store = _safety_store(request)
    if store is None:
        raise HTTPException(status_code=503, detail="provider_safety_store_not_available")
    try:
        policy = store.set_policy(provider_id, body.dangerousness)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="provider_not_found") from exc
    return policy.model_dump(mode="json")


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
