/**
 * Tests for agentStore model-selection additions.
 * Written FIRST. Run vitest to confirm failure. Then implement.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "@/store/agentStore";
import type { AgentModelDef } from "@/lib/types";

const MOCK_MODELS: AgentModelDef[] = [
  {
    id:           "claude:claude-sonnet-4-6",
    provider_id:  "claude",
    model_id:     "claude-sonnet-4-6",
    display_name: "Claude Sonnet 4.6",
    description:  "Balanced model.",
    cost_tier:    "subscription",
    available:    true,
  },
  {
    id:           "codex:o4-mini",
    provider_id:  "codex",
    model_id:     "o4-mini",
    display_name: "o4-mini",
    description:  "Fast codex model.",
    cost_tier:    "subscription",
    available:    true,
  },
  {
    id:           "ollama:qwen3.6:27b",
    provider_id:  "ollama",
    model_id:     "qwen3.6:27b",
    display_name: "qwen3.6:27b",
    description:  "Local model.",
    cost_tier:    "local",
    available:    true,
  },
];

beforeEach(() => {
  useAgentStore.setState({
    agentModels:       [],
    agentModelsLoaded: false,
    selectedModel:     "claude:claude-sonnet-4-6",
  });
});

describe("agentModels state", () => {
  it("defaults to empty array", () => {
    expect(useAgentStore.getState().agentModels).toEqual([]);
  });

  it("defaults agentModelsLoaded to false", () => {
    expect(useAgentStore.getState().agentModelsLoaded).toBe(false);
  });

  it("defaults selectedModel to a claude model", () => {
    const sel = useAgentStore.getState().selectedModel;
    expect(sel).toBeTruthy();
    expect(sel.startsWith("claude:")).toBe(true);
  });
});

describe("setAgentModels", () => {
  it("stores models and sets agentModelsLoaded to true", () => {
    useAgentStore.getState().setAgentModels(MOCK_MODELS);
    const state = useAgentStore.getState();
    expect(state.agentModels).toHaveLength(3);
    expect(state.agentModelsLoaded).toBe(true);
  });

  it("replaces previous models", () => {
    useAgentStore.getState().setAgentModels(MOCK_MODELS);
    useAgentStore.getState().setAgentModels([MOCK_MODELS[0]]);
    expect(useAgentStore.getState().agentModels).toHaveLength(1);
  });
});

describe("setSelectedModel", () => {
  it("updates selectedModel", () => {
    useAgentStore.getState().setSelectedModel("codex:o4-mini");
    expect(useAgentStore.getState().selectedModel).toBe("codex:o4-mini");
  });

  it("also updates selectedProvider to the provider prefix", () => {
    useAgentStore.getState().setSelectedModel("codex:o4-mini");
    expect(useAgentStore.getState().selectedProvider).toBe("codex");
  });

  it("handles ollama provider prefix correctly", () => {
    useAgentStore.getState().setSelectedModel("ollama:qwen3.6:27b");
    expect(useAgentStore.getState().selectedProvider).toBe("ollama");
    expect(useAgentStore.getState().selectedModel).toBe("ollama:qwen3.6:27b");
  });

  it("handles model ids that contain colons (ollama model names)", () => {
    useAgentStore.getState().setSelectedModel("ollama:qwen3.6:27b");
    // provider_id is only the FIRST segment before ':'
    expect(useAgentStore.getState().selectedProvider).toBe("ollama");
  });
});
