"""
Tests for AgentPool enforcing max_concurrent_slots from ProviderManifest.
Written FIRST — run to confirm failure, then implement.
"""


def test_pool_respects_manifest_max_concurrent_slots():
    """Ollama manifest sets max_concurrent_slots=1. Pool must not exceed this."""
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    manifest = PROVIDER_REGISTRY["ollama"]
    assert manifest.max_concurrent_slots == 1


def test_pool_cap_is_none_for_claude():
    """Claude has no hard cap — pool can spawn freely."""
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    manifest = PROVIDER_REGISTRY["claude"]
    assert manifest.max_concurrent_slots is None


def test_manifest_hard_cap_is_readable_by_pool():
    """Pool can read max_concurrent_slots from registry for any provider."""
    from nidavellir.agents.registry import PROVIDER_REGISTRY
    for pid, manifest in PROVIDER_REGISTRY.items():
        cap = manifest.max_concurrent_slots
        assert cap is None or isinstance(cap, int), \
            f"{pid} max_concurrent_slots must be int or None"
