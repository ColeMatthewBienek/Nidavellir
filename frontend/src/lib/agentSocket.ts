import { useAgentStore } from "@/store/agentStore";

const WS_URL      = "ws://localhost:7430/api/ws";
const API_BASE    = "http://localhost:7430";

let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _agentMessageOpen = false;

async function _fetchContextUsage(conversationId: string, model: string, provider: string): Promise<void> {
  // Guard: a valid conversation_id is required — never fetch with an empty id
  if (!conversationId || conversationId.trim() === "") {
    console.warn(JSON.stringify({ event: "context_usage_refresh_skipped", reason: "missing_conversation_id" }));
    return;
  }
  try {
    const params = new URLSearchParams({ conversation_id: conversationId, model, provider });
    const resp = await fetch(`${API_BASE}/api/context/usage?${params}`);
    // On any non-2xx response, keep the existing contextUsage — do not overwrite with zero
    if (!resp.ok) {
      console.warn(JSON.stringify({ event: "context_usage_refresh_skipped", reason: `http_${resp.status}` }));
      return;
    }
    const data = await resp.json();
    useAgentStore.getState().setContextUsage({
      model:         data.model,
      provider:      data.provider ?? provider,
      currentTokens: data.currentTokens,
      usableTokens:  data.usableTokens,
      totalLimit:    data.contextLimit,
      percentUsed:   data.percentUsed ?? 0,
      state:         data.state ?? "ok",
      accurate:      data.accuracy === "accurate",
      lastUpdatedAt: data.lastUpdatedAt ?? new Date().toISOString(),
    });
  } catch {
    // non-fatal — keep existing contextUsage
  }
}

async function _fetchMemories(): Promise<void> {
  try {
    const resp = await fetch(`${API_BASE}/api/memory/?workflow=chat&limit=12`);
    if (!resp.ok) return;
    const memories = await resp.json();
    useAgentStore.getState().setMemories(memories);
  } catch {
    // non-fatal — memory panel just shows stale data
  }
}

function connect(): void {
  const ws = new WebSocket(WS_URL);
  _ws = ws;

  ws.onopen = () => {
    useAgentStore.getState().setConnectionStatus("connected");
  };

  ws.onmessage = (event: MessageEvent) => {
    let data: {
      type: string;
      content?: string;
      message?: string;
      conversation_id?: string;
      current_tokens?: number;
      model?: string;
      provider?: string;
      session_id?: string;
    };
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }
    const s = useAgentStore.getState();
    switch (data.type) {
      case "session_ready":
        if (data.conversation_id) {
          s.setConversationId(data.conversation_id as string);
          _fetchMemories().catch(() => {});
        }
        break;

      case "context_update":
        if (!data.conversation_id) {
          console.warn("Ignoring context_update without conversation_id");
          break;
        }
        _fetchContextUsage(
          data.conversation_id as string,
          data.model ?? "claude-sonnet-4-6",
          data.provider ?? "claude",
        ).catch(() => {});
        break;

      case "session_switch_ready": {
        const sid = data.conversation_id as string | undefined;
        if (sid) s.setConversationId(sid);
        s.clearMessages();
        s.setHandoffPending(false);
        const provider = (data.provider as string | undefined) ?? useAgentStore.getState().selectedProvider;
        s.setToastMessage(`Model changed to ${provider}`);
        _fetchMemories().catch(() => {});
        break;
      }

      case "chunk":
        if (!_agentMessageOpen) {
          // First chunk of a new response — create the agent bubble
          s.addMessage("agent", "");
          useAgentStore.setState({ isStreaming: true });
          _agentMessageOpen = true;
        }
        s.appendRawChunk(data.content ?? "");
        break;

      case "done":
        s.finalizeLastAgentMessage();
        _agentMessageOpen = false;
        break;

      case "error":
        if (!_agentMessageOpen) {
          // Error before any chunks — still need a bubble to show the error in
          s.addMessage("agent", "");
          _agentMessageOpen = true;
        }
        s.finalizeWithError(data.message ?? "unknown error");
        _agentMessageOpen = false;
        break;
    }
  };

  ws.onerror = () => {
    useAgentStore.getState().setConnectionStatus("error");
  };

  ws.onclose = () => {
    if (_ws !== ws) return;
    const store = useAgentStore.getState();
    if (store.isStreaming) {
      store.finalizeWithError("connection lost — response may be incomplete");
    }
    _agentMessageOpen = false;
    store.setConnectionStatus("disconnected");
    _ws = null;
    _reconnectTimer = setTimeout(connect, 3000);
  };
}

export function initSocket(): void {
  if (
    _ws?.readyState === WebSocket.OPEN ||
    _ws?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }
  connect();
}

export function sendSessionSwitch(
  providerId: string,
  modelId: string,
  mode: "continue" | "clean" | "review",
  oldConversationId?: string | null,
): void {
  if (_ws?.readyState !== WebSocket.OPEN) return;
  _ws.send(JSON.stringify({
    type:                "session_switch",
    provider_id:         providerId,
    model_id:            modelId,
    mode,
    old_conversation_id: oldConversationId ?? undefined,
  }));
}

export function sendNewSession(providerId: string, modelId: string, conversationId?: string | null): void {
  if (_ws?.readyState !== WebSocket.OPEN) return;
  const payload: Record<string, string> = { type: "new_session", provider_id: providerId, model_id: modelId };
  if (conversationId) payload.conversation_id = conversationId;
  _ws.send(JSON.stringify(payload));
}

export function sendMessage(content: string): void {
  if (_ws?.readyState !== WebSocket.OPEN) return;
  _ws.send(JSON.stringify({ type: "message", content }));
}

/** Test-only: resets internal socket state without triggering reconnect. */
export function _testResetSocket(): void {
  if (_ws) {
    _ws.onopen    = null;
    _ws.onmessage = null;
    _ws.onerror   = null;
    _ws.onclose   = null;
    _ws = null;
  }
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _agentMessageOpen = false;
}
