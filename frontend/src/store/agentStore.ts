import { create } from "zustand";
import type { ProviderInfo, AgentModelDef } from "@/lib/types";
import type { StreamEvent } from "@/lib/streamTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnectionStatus = "connected" | "connecting" | "error" | "disconnected";
export type MessageRole = "user" | "agent" | "system";

export interface Message {
  id:        string;
  role:      MessageRole;
  content:   string;       // accumulated raw string — backward compat + fallback render
  timestamp: Date;
  streaming: boolean;
  rawChunks: string[];     // raw PTY chunks, unstripped — drives parser
  events:    StreamEvent[]; // parser output — drives StreamRenderer
}

export interface MemoryRecord {
  id:          string;
  content:     string;
  category:    string;
  memory_type: string;
  confidence:  number;
  importance:  number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Store interface ────────────────────────────────────────────────────────────

interface AgentStore {
  // Provider / connection (Spec 01)
  selectedAgent:     string;
  selectedProvider:  string;
  connectionStatus:  ConnectionStatus;
  providers:         ProviderInfo[];
  providersLoaded:   boolean;

  // Agent model selection
  agentModels:       AgentModelDef[];
  agentModelsLoaded: boolean;
  selectedModel:     string;   // "{provider_id}:{model_id}"

  // Chat state (Spec 02)
  messages:       Message[];
  isStreaming:    boolean;
  conversationId: string | null;
  memories:       MemoryRecord[];

  // Provider / connection actions (Spec 01)
  setSelectedProvider: (id: string) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setProviders:        (providers: ProviderInfo[]) => void;

  // Agent model actions
  setAgentModels:   (models: AgentModelDef[]) => void;
  setSelectedModel: (modelId: string) => void;

  // Chat actions (Spec 02)
  addMessage:               (role: MessageRole, content: string) => string;
  appendRawChunk:           (chunk: string) => void;
  appendStreamEvents:       (events: StreamEvent[]) => void;
  appendToLastAgentMessage: (chunk: string) => void;   // backward compat
  finalizeLastAgentMessage: () => void;
  finalizeWithError:        (reason: string) => void;
  clearMessages:            () => void;
  setConversationId:        (id: string | null) => void;
  setMemories:              (memories: MemoryRecord[]) => void;
}

// ── Store implementation ───────────────────────────────────────────────────────

export const useAgentStore = create<AgentStore>((set, get) => ({
  // ── Provider / connection ─────────────────────────────────────────────────
  selectedAgent:    "nid-agent-0",
  selectedProvider: "claude",
  connectionStatus: "disconnected",
  providers:        [],
  providersLoaded:  false,

  setSelectedProvider: (id) => set({ selectedProvider: id }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setProviders: (providers) => set({ providers, providersLoaded: true }),

  // ── Agent model selection ─────────────────────────────────────────────────
  agentModels:       [],
  agentModelsLoaded: false,
  selectedModel:     "claude:claude-sonnet-4-6",

  setAgentModels: (models) => set({ agentModels: models, agentModelsLoaded: true }),

  setSelectedModel: (modelId) => {
    const providerId = modelId.split(":")[0];
    set({ selectedModel: modelId, selectedProvider: providerId });
  },

  // ── Chat state ────────────────────────────────────────────────────────────
  messages:       [],
  isStreaming:    false,
  conversationId: null,
  memories:       [],

  // ── Chat actions ──────────────────────────────────────────────────────────

  addMessage: (role, content) => {
    const id = generateId();
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role,
          content,
          timestamp:  new Date(),
          streaming:  role === "agent",
          rawChunks:  [],
          events:     [],
        },
      ],
    }));
    return id;
  },

  appendRawChunk: (chunk) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "agent") return {};
      msgs[msgs.length - 1] = {
        ...last,
        rawChunks: [...last.rawChunks, chunk],
        content:   last.content + chunk,
      };
      return { messages: msgs };
    }),

  appendStreamEvents: (events) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "agent") return {};
      msgs[msgs.length - 1] = {
        ...last,
        events: [...last.events, ...events],
      };
      return { messages: msgs };
    }),

  appendToLastAgentMessage: (chunk) => {
    get().appendRawChunk(chunk);
  },

  finalizeLastAgentMessage: () =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "agent") {
        msgs[msgs.length - 1] = { ...last, streaming: false };
      }
      return { messages: msgs, isStreaming: false };
    }),

  finalizeWithError: (reason) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "agent") return { isStreaming: false };
      const errorEvent: StreamEvent = { type: "error", message: `⚠ ${reason}` };
      msgs[msgs.length - 1] = {
        ...last,
        content:   last.content
          ? last.content + `\n\n⚠ ${reason}`
          : `⚠ ${reason}`,
        events:    [...last.events, errorEvent],
        streaming: false,
      };
      return { messages: msgs, isStreaming: false };
    }),

  clearMessages:     () => set({ messages: [], isStreaming: false }),
  setConversationId: (id) => set({ conversationId: id }),
  setMemories:       (memories) => set({ memories }),
}));
