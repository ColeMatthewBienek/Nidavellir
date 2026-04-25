import { useEffect } from "react";
import { useAgentStore } from "@/store/agentStore";
import type { AgentModelDef } from "@/lib/types";

const API_BASE = "http://localhost:7430";

export function useAgentModels() {
  const agentModels       = useAgentStore((s) => s.agentModels);
  const agentModelsLoaded = useAgentStore((s) => s.agentModelsLoaded);
  const setAgentModels    = useAgentStore((s) => s.setAgentModels);

  useEffect(() => {
    if (agentModelsLoaded) return;
    fetch(`${API_BASE}/api/agents/models`)
      .then((r) => r.json())
      .then((d) => setAgentModels((d as { models: AgentModelDef[] }).models))
      .catch((err) => console.warn("useAgentModels: fetch failed", err));
  }, [agentModelsLoaded, setAgentModels]);

  const available   = agentModels.filter((m) => m.available);
  const byProvider  = agentModels.reduce<Record<string, AgentModelDef[]>>((acc, m) => {
    (acc[m.provider_id] ??= []).push(m);
    return acc;
  }, {});

  return {
    agentModels,
    available,
    loading: !agentModelsLoaded,
    byProvider,
  };
}
