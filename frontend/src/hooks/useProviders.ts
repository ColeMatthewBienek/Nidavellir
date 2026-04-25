import { useEffect } from "react";
import { useAgentStore } from "@/store/agentStore";
import type { ProviderInfo } from "@/lib/types";

const API_BASE = "http://localhost:7430";

export function useProviders() {
  const providers       = useAgentStore((s) => s.providers);
  const providersLoaded = useAgentStore((s) => s.providersLoaded);
  const setProviders    = useAgentStore((s) => s.setProviders);
  // Note: each selector is separate to avoid object-ref churn with Zustand v5

  useEffect(() => {
    if (providersLoaded) return;
    fetch(`${API_BASE}/api/agents/providers`)
      .then((r) => r.json())
      .then((d) => setProviders((d as { providers: ProviderInfo[] }).providers))
      .catch((err) => console.warn("useProviders: fetch failed", err));
  }, [providersLoaded, setProviders]);

  const available   = providers.filter((p) => p.available);
  const getById     = (id: string) => providers.find((p) => p.id === id) ?? null;
  const withRole    = (role: string) => providers.filter((p) => p.roles.includes(role as ProviderInfo["roles"][number]));
  const isAvailable = (id: string) => getById(id)?.available ?? false;

  return {
    providers,
    available,
    loading: !providersLoaded,
    getById,
    withRole,
    isAvailable,
  };
}
