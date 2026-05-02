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
  completedAt?: Date;
  streaming: boolean;
  rawChunks: string[];     // raw PTY chunks, unstripped — drives parser
  events:    StreamEvent[]; // parser output — drives StreamRenderer
}

interface MemoryRecord {
  id:          string;
  content:     string;
  category:    string;
  memory_type: string;
  confidence:  number;
  importance:  number;
}

interface ContextUsage {
  model:         string;
  provider:      string;
  currentTokens: number;
  usableTokens:  number;
  totalLimit:    number;
  percentUsed:   number;
  state:         "ok" | "warn" | "prepare" | "force" | "blocked";
  accurate:      boolean;
  lastUpdatedAt: string;
}

interface ConversationListItem {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  activeProvider?: string;
  activeModel?: string;
  workingDirectory?: string;
  workingDirectoryDisplay?: string;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
}

interface ConversationFile {
  id: string;
  conversationId: string;
  fileName: string;
  originalPath: string;
  fileKind: "text" | "image" | "unsupported";
  mimeType?: string;
  sizeBytes: number;
  estimatedTokens?: number;
  lineCount?: number;
  imageWidth?: number;
  imageHeight?: number;
  imageFormat?: string;
  source?: string;
  active: boolean;
  addedAt: string;
}

interface ConversationDetail {
  id: string;
  title: string;
  activeSessionId: string;
  activeProvider?: string;
  activeModel?: string;
  workingDirectory?: string;
  workingDirectoryDisplay?: string;
  messages: Array<{
    id: string;
    role: MessageRole;
    content: string;
    createdAt?: string;
  }>;
  selectedFiles: unknown[];
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function parseBackendTimestamp(value?: string): Date {
  if (!value) return new Date();
  const trimmed = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
  return new Date(hasZone ? normalized : `${normalized}Z`);
}

function answerText(events: StreamEvent[]): string {
  return events
    .filter((event): event is Extract<StreamEvent, { type: "answer_delta" }> => event.type === "answer_delta")
    .map((event) => event.content)
    .join("");
}

function collapseAdjacentDuplicateText(content: string): string {
  let next = content;
  let changed = true;

  const collapseRepeatedLineRuns = (value: string): string => {
    const lines = value.split("\n");
    for (let start = 0; start < lines.length; start += 1) {
      const remaining = lines.length - start;
      for (let size = Math.floor(remaining / 2); size >= 2; size -= 1) {
        const left = lines.slice(start, start + size).join("\n").trim();
        const right = lines.slice(start + size, start + size * 2).join("\n").trim();
        if (!left || left !== right) continue;
        return [
          ...lines.slice(0, start + size),
          ...lines.slice(start + size * 2),
        ].join("\n");
      }
    }
    return value;
  };

  while (changed) {
    changed = false;
    const trimmed = next.trim();
    if (trimmed.length > 0 && trimmed.length % 2 === 0) {
      const mid = trimmed.length / 2;
      const left = trimmed.slice(0, mid);
      const right = trimmed.slice(mid);
      if (left === right) {
        next = left;
        changed = true;
        continue;
      }
    }

    next = next.replace(/(.{24,}?[\.\?!])\1/g, (_match, repeated: string) => {
      changed = true;
      return repeated;
    });

    const withoutRepeatedLines = collapseRepeatedLineRuns(next);
    if (withoutRepeatedLines !== next) {
      next = withoutRepeatedLines;
      changed = true;
    }
  }

  return next;
}

function normalizeIncomingEvents(existing: StreamEvent[], incoming: StreamEvent[]): StreamEvent[] {
  const normalized: StreamEvent[] = [];
  let currentAnswer = answerText(existing);

  for (const event of incoming) {
    if (event.type === "steering_signal") {
      const previous = existing.at(-1);
      if (previous?.type === "steering_signal" && previous.content === event.content) continue;
      normalized.push(event);
      continue;
    }

    if (event.type !== "answer_delta") {
      normalized.push(event);
      continue;
    }

    let content = collapseAdjacentDuplicateText(event.content);
    if (!content) continue;
    if (currentAnswer.endsWith(content)) continue;
    if (content.startsWith(currentAnswer)) {
      content = content.slice(currentAnswer.length);
    }
    if (!content) continue;

    normalized.push({ ...event, content });
    currentAnswer += content;
  }

  return normalized;
}

const ACTIVE_STATE_KEY = "nidavellir.activeConversationState";
const DEFAULT_PROVIDER = "claude";
const DEFAULT_MODEL_KEY = "claude:claude-sonnet-4-6";

interface PersistedActiveState {
  conversationId: string | null;
  selectedProvider: string;
  selectedModel: string;
}

function readPersistedActiveState(): PersistedActiveState {
  if (typeof window === "undefined") {
    return {
      conversationId: null,
      selectedProvider: DEFAULT_PROVIDER,
      selectedModel: DEFAULT_MODEL_KEY,
    };
  }
  try {
    const raw = window.localStorage.getItem(ACTIVE_STATE_KEY);
    if (!raw) {
      return {
        conversationId: null,
        selectedProvider: DEFAULT_PROVIDER,
        selectedModel: DEFAULT_MODEL_KEY,
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedActiveState>;
    return {
      conversationId: parsed.conversationId ?? null,
      selectedProvider: parsed.selectedProvider || DEFAULT_PROVIDER,
      selectedModel: parsed.selectedModel || DEFAULT_MODEL_KEY,
    };
  } catch {
    return {
      conversationId: null,
      selectedProvider: DEFAULT_PROVIDER,
      selectedModel: DEFAULT_MODEL_KEY,
    };
  }
}

function persistActiveState(patch: Partial<PersistedActiveState>): void {
  if (typeof window === "undefined") return;
  try {
    const current = readPersistedActiveState();
    window.localStorage.setItem(ACTIVE_STATE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // localStorage is best-effort only.
  }
}

const persistedActiveState = readPersistedActiveState();

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
  activeConversationId: string | null;
  conversations: ConversationListItem[];
  workingSetFiles: ConversationFile[];
  workingDirectory: string | null;
  workingDirectoryDisplay: string | null;
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
  setActiveConversationId:  (id: string | null) => void;
  setConversations:         (items: ConversationListItem[]) => void;
  refreshConversations:     () => Promise<void>;
  createConversation:       () => Promise<void>;
  loadConversation:         (id: string) => Promise<void>;
  renameConversation:       (id: string, title: string) => Promise<void>;
  pinConversation:          (id: string, pinned: boolean) => Promise<void>;
  archiveConversation:      (id: string) => Promise<void>;
  setWorkingDirectory:      (path: string) => Promise<{ ok: boolean; message: string; warning?: string | null }>;
  refreshWorkingSetFiles:   () => Promise<void>;
  addWorkingSetFiles:       (paths: string[]) => Promise<boolean>;
  removeWorkingSetFile:     (fileId: string) => Promise<void>;
  setMemories:              (memories: MemoryRecord[]) => void;
  contextUsage:             ContextUsage | null;
  setContextUsage:          (usage: ContextUsage | null) => void;
  refreshContextUsage:      () => Promise<void>;
  resourceRevision:         number;
  markResourcesChanged:     (reason?: string) => void;

  // Session continuity
  handoffPending:   boolean;
  handoffProvider:  string;
  handoffSummary:   string | null;
  toastMessage:     string;
  setHandoffPending:  (pending: boolean, provider?: string) => void;
  setHandoffSummary:  (summary: string | null) => void;
  setToastMessage:    (msg: string) => void;
}

// ── Store implementation ───────────────────────────────────────────────────────

export const useAgentStore = create<AgentStore>((set, get) => ({
  // ── Provider / connection ─────────────────────────────────────────────────
  selectedAgent:    "nid-agent-0",
  selectedProvider: persistedActiveState.selectedProvider,
  connectionStatus: "disconnected",
  providers:        [],
  providersLoaded:  false,

  setSelectedProvider: (id) => {
    persistActiveState({ selectedProvider: id });
    set({ selectedProvider: id });
  },
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setProviders: (providers) => set({ providers, providersLoaded: true }),

  // ── Agent model selection ─────────────────────────────────────────────────
  agentModels:       [],
  agentModelsLoaded: false,
  selectedModel:     persistedActiveState.selectedModel,

  setAgentModels: (models) => set({ agentModels: models, agentModelsLoaded: true }),

  setSelectedModel: (modelId) => {
    const providerId = modelId.split(":")[0];
    persistActiveState({ selectedModel: modelId, selectedProvider: providerId });
    set({ selectedModel: modelId, selectedProvider: providerId });
  },

  // ── Chat state ────────────────────────────────────────────────────────────
  messages:       [],
  isStreaming:    false,
  conversationId: persistedActiveState.conversationId,
  activeConversationId: persistedActiveState.conversationId,
  conversations:  [],
  workingSetFiles: [],
  workingDirectory: null,
  workingDirectoryDisplay: null,
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
      const nextEvents = normalizeIncomingEvents(last.events, events);
      if (nextEvents.length === 0) return {};
      msgs[msgs.length - 1] = {
        ...last,
        events: [...last.events, ...nextEvents],
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
        msgs[msgs.length - 1] = { ...last, streaming: false, completedAt: new Date() };
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
        completedAt: new Date(),
      };
      return { messages: msgs, isStreaming: false };
    }),

  clearMessages:     () => set({ messages: [], isStreaming: false }),
  setConversationId: (id) => {
    persistActiveState({ conversationId: id });
    set({ conversationId: id, activeConversationId: id });
  },
  setActiveConversationId: (id) => {
    persistActiveState({ conversationId: id });
    set({ conversationId: id, activeConversationId: id });
  },
  setConversations: (items) => set({ conversations: items }),
  refreshConversations: async () => {
    try {
      const resp = await fetch("http://localhost:7430/api/conversations");
      if (!resp.ok) return;
      const items = await resp.json() as ConversationListItem[];
      set({ conversations: items });
    } catch {
      // non-fatal; sidebar can retry on next mount/action
    }
  },
  createConversation: async () => {
    const state = get();
    const [providerId, ...modelParts] = state.selectedModel.split(":");
    const modelId = modelParts.join(":");
    const resp = await fetch("http://localhost:7430/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: providerId, model: modelId }),
    });
    if (!resp.ok) return;
    const data = await resp.json() as {
      conversationId: string;
      title: string;
      workingDirectory?: string;
      workingDirectoryDisplay?: string;
    };
    set({
      conversationId: data.conversationId,
      activeConversationId: data.conversationId,
      messages: [],
      workingSetFiles: [],
      workingDirectory: data.workingDirectory ?? null,
      workingDirectoryDisplay: data.workingDirectoryDisplay ?? data.workingDirectory ?? null,
      isStreaming: false,
      contextUsage: null,
    });
    persistActiveState({ conversationId: data.conversationId });
    await get().refreshConversations();
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]')?.focus();
    }, 0);
  },
  loadConversation: async (id) => {
    const resp = await fetch(`http://localhost:7430/api/conversations/${id}`);
    if (!resp.ok) return;
    const detail = await resp.json() as ConversationDetail;
    const messages = detail.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: parseBackendTimestamp(m.createdAt),
      streaming: false,
      rawChunks: [],
      events: [],
    }));
    const provider = detail.activeProvider ?? get().selectedProvider;
    const model = detail.activeModel ?? get().selectedModel.split(":").slice(1).join(":");
    persistActiveState({
      conversationId: detail.id,
      selectedProvider: provider,
      selectedModel: modelKey(provider, model),
    });
    set({
      conversationId: detail.id,
      activeConversationId: detail.id,
      messages,
      selectedProvider: provider,
      selectedModel: modelKey(provider, model),
      workingDirectory: detail.workingDirectory ?? null,
      workingDirectoryDisplay: detail.workingDirectoryDisplay ?? detail.workingDirectory ?? null,
      isStreaming: false,
    });
    await get().refreshWorkingSetFiles();

    try {
      const params = new URLSearchParams({ conversation_id: detail.id, provider, model });
      const usageResp = await fetch(`http://localhost:7430/api/context/usage?${params}`);
      if (usageResp.ok) {
        const data = await usageResp.json();
        set({
          contextUsage: {
            model: data.model,
            provider: data.provider ?? provider,
            currentTokens: data.currentTokens,
            usableTokens: data.usableTokens,
            totalLimit: data.contextLimit,
            percentUsed: data.percentUsed ?? 0,
            state: data.state ?? "ok",
            accurate: data.accuracy === "accurate",
            lastUpdatedAt: data.lastUpdatedAt ?? new Date().toISOString(),
          },
        });
      }
    } catch {
      // keep existing context usage on refresh failure
    }
  },
  renameConversation: async (id, title) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const resp = await fetch(`http://localhost:7430/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle }),
    });
    if (!resp.ok) return;
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === id ? { ...item, title: nextTitle } : item
      ),
    }));
    await get().refreshConversations();
  },
  pinConversation: async (id, pinned) => {
    const resp = await fetch(`http://localhost:7430/api/conversations/${id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    if (!resp.ok) return;
    await get().refreshConversations();
  },
  archiveConversation: async (id) => {
    const resp = await fetch(`http://localhost:7430/api/conversations/${id}/archive`, {
      method: "POST",
    });
    if (!resp.ok) return;
    await get().refreshConversations();

    const state = get();
    if (state.activeConversationId !== id) return;

    const fallback = state.conversations.find((item) => item.pinned)
      ?? state.conversations.find((item) => !item.pinned);

    if (fallback) {
      await get().loadConversation(fallback.id);
    } else {
      await get().createConversation();
    }
  },
  setWorkingDirectory: async (path) => {
    if (!get().activeConversationId) {
      await get().createConversation();
    }
    const id = get().activeConversationId;
    if (!id) return { ok: false, message: "conversation_not_selected" };
    const resp = await fetch(`http://localhost:7430/api/conversations/${id}/workspace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) {
      let detail = `http_${resp.status}`;
      try {
        const body = await resp.json() as { detail?: string };
        detail = body.detail ?? detail;
      } catch {
        // keep status fallback
      }
      return { ok: false, message: detail };
    }
    const data = await resp.json() as {
      workingDirectory: string;
      workingDirectoryDisplay?: string;
      warning?: string | null;
    };
    set({
      workingDirectory: data.workingDirectory,
      workingDirectoryDisplay: data.workingDirectoryDisplay ?? data.workingDirectory,
    });
    await get().refreshConversations();
    return {
      ok: true,
      message: data.workingDirectoryDisplay ?? data.workingDirectory,
      warning: data.warning ?? null,
    };
  },
  refreshWorkingSetFiles: async () => {
    const id = get().activeConversationId;
    if (!id) {
      set({ workingSetFiles: [] });
      return;
    }
    try {
      const resp = await fetch(`http://localhost:7430/api/conversations/${id}/files`);
      if (!resp.ok) return;
      const files = await resp.json() as ConversationFile[];
      set({ workingSetFiles: files });
    } catch {
      // non-fatal
    }
  },
  addWorkingSetFiles: async (paths) => {
    const state = get();
    const id = state.activeConversationId;
    if (!id || paths.length === 0) return false;
    const [providerId, ...modelParts] = state.selectedModel.split(":");
    const modelId = modelParts.join(":");
    const resp = await fetch(`http://localhost:7430/api/conversations/${id}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, provider: providerId, model: modelId }),
    });
    if (!resp.ok) return false;
    const data = await resp.json() as { added: ConversationFile[]; contextAfter?: Record<string, unknown> };
    if (data.added.length === 0) return false;
    await get().refreshWorkingSetFiles();
    await get().loadConversation(id);
    return true;
  },
  removeWorkingSetFile: async (fileId) => {
    const id = get().activeConversationId;
    if (!id) return;
    const resp = await fetch(`http://localhost:7430/api/conversations/${id}/files/${fileId}`, {
      method: "DELETE",
    });
    if (!resp.ok) return;
    await get().refreshWorkingSetFiles();
    await get().loadConversation(id);
  },
  setMemories:       (memories) => set({ memories }),
  contextUsage:      null,
  setContextUsage:   (usage) => set({ contextUsage: usage }),
  refreshContextUsage: async () => {
    const state = get();
    const conversationId = state.activeConversationId;
    if (!conversationId) return;
    const [providerId, ...modelParts] = state.selectedModel.split(":");
    const provider = providerId || state.selectedProvider;
    const model = modelParts.join(":") || state.selectedModel;
    try {
      const params = new URLSearchParams({ conversation_id: conversationId, provider, model });
      const resp = await fetch(`http://localhost:7430/api/context/usage?${params}`);
      if (!resp.ok) return;
      const data = await resp.json();
      set({
        contextUsage: {
          model: data.model,
          provider: data.provider ?? provider,
          currentTokens: data.currentTokens,
          usableTokens: data.usableTokens,
          totalLimit: data.contextLimit,
          percentUsed: data.percentUsed ?? 0,
          state: data.state ?? "ok",
          accurate: data.accuracy === "accurate",
          lastUpdatedAt: data.lastUpdatedAt ?? new Date().toISOString(),
        },
      });
    } catch {
      // resource reload should not interrupt the active workflow
    }
  },
  resourceRevision: 0,
  markResourcesChanged: (reason = "resources changed") => {
    set((state) => ({ resourceRevision: state.resourceRevision + 1, toastMessage: reason }));
    get().refreshContextUsage().catch(() => {});
  },

  // ── Session continuity ────────────────────────────────────────────────────
  handoffPending:  false,
  handoffProvider: "",
  handoffSummary:  null,
  toastMessage:    "",

  setHandoffPending: (pending, provider = "") =>
    set({ handoffPending: pending, handoffProvider: provider }),
  setHandoffSummary: (summary) => set({ handoffSummary: summary }),
  setToastMessage:   (msg) => set({ toastMessage: msg }),
}));
