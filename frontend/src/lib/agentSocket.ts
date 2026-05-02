import { useAgentStore } from "@/store/agentStore";
import { createParser } from "@/lib/parsers";
import type { ProviderStreamParser, StreamEvent } from "@/lib/streamTypes";

const WS_URL      = "ws://localhost:7430/api/ws";
const API_BASE    = "http://localhost:7430";
const ACTIVE_TURN_KEY = "nidavellir.activeTurn";

let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _agentMessageOpen = false;
let _parser: ProviderStreamParser | null = null;
let _clientConnectionId = "";
let _activeTurnId: string | null = null;
const _commandTimelineRunIds = new Set<string>();

interface PersistedTurn {
  turnId: string;
  conversationId: string | null;
}

function _uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function _connectionId(): string {
  if (!_clientConnectionId) _clientConnectionId = _uuid();
  return _clientConnectionId;
}

function _readPersistedTurn(): PersistedTurn | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_TURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTurn>;
    if (!parsed.turnId) return null;
    return {
      turnId: parsed.turnId,
      conversationId: parsed.conversationId ?? null,
    };
  } catch {
    return null;
  }
}

function _persistActiveTurn(turnId: string, conversationId: string | null): void {
  _activeTurnId = turnId;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_TURN_KEY, JSON.stringify({ turnId, conversationId }));
  } catch {
    // best-effort resume metadata
  }
}

function _clearActiveTurn(turnId?: string): void {
  if (turnId && _activeTurnId && turnId !== _activeTurnId) return;
  _activeTurnId = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVE_TURN_KEY);
  } catch {
    // best-effort cleanup
  }
}

function _activeTurn(): PersistedTurn | null {
  if (_activeTurnId) {
    return {
      turnId: _activeTurnId,
      conversationId: useAgentStore.getState().conversationId,
    };
  }
  const persisted = _readPersistedTurn();
  if (persisted) _activeTurnId = persisted.turnId;
  return persisted;
}

function _ensureAgentMessageOpen(): void {
  if (_agentMessageOpen) return;
  const state = useAgentStore.getState();
  const last = state.messages.at(-1);
  if (!last || last.role !== "agent" || !last.streaming) {
    state.addMessage("agent", "");
  }
  useAgentStore.setState({ isStreaming: true });
  _agentMessageOpen = true;
  _parser = createParser(useAgentStore.getState().selectedProvider);
}

function _selectedProviderModel(): { providerId: string; modelId: string } {
  const state = useAgentStore.getState();
  const [providerId, ...modelParts] = state.selectedModel.split(":");
  return {
    providerId: providerId || state.selectedProvider,
    modelId: modelParts.join(":") || state.selectedModel,
  };
}

function _syncSelectedModel(providerId?: string, modelId?: string): void {
  if (!providerId || !modelId) return;
  useAgentStore.getState().setSelectedModel(`${providerId}:${modelId}`);
}

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
    const store = useAgentStore.getState();
    store.setConnectionStatus("connected");
    const activeTurn = _activeTurn();
    if (activeTurn?.turnId) {
      ws.send(JSON.stringify({
        type: "resume_connection",
        client_connection_id: _connectionId(),
        conversation_id: activeTurn.conversationId ?? store.conversationId,
        turn_id: activeTurn.turnId,
      }));
    } else if (store.conversationId) {
      const { providerId, modelId } = _selectedProviderModel();
      sendNewSession(providerId, modelId, store.conversationId);
    }
  };

  ws.onmessage = (event: MessageEvent) => {
    let data: {
      type: string;
      content?: string;
      message?: string;
      status?: string;
      conversation_id?: string;
      turn_id?: string;
      current_tokens?: number;
      model?: string;
      provider?: string;
      provider_id?: string;
      model_id?: string;
      session_id?: string;
      working_directory?: string;
      working_directory_display?: string;
      event?: StreamEvent;
      command_event?: unknown;
    };
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }
    const s = useAgentStore.getState();
    switch (data.type) {
      case "session_ready":
        _syncSelectedModel(
          (data.provider_id ?? data.provider) as string | undefined,
          (data.model_id ?? data.model) as string | undefined,
        );
        if (data.conversation_id) {
          s.setConversationId(data.conversation_id as string);
          useAgentStore.setState({
            workingDirectory: data.working_directory ?? useAgentStore.getState().workingDirectory,
            workingDirectoryDisplay: data.working_directory_display ?? data.working_directory ?? useAgentStore.getState().workingDirectoryDisplay,
          });
          _fetchMemories().catch(() => {});
        }
        break;

      case "conversation_created":
        if (data.conversation_id) {
          s.setConversationId(data.conversation_id as string);
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
        useAgentStore.setState({
          workingDirectory: data.working_directory ?? useAgentStore.getState().workingDirectory,
          workingDirectoryDisplay: data.working_directory_display ?? data.working_directory ?? useAgentStore.getState().workingDirectoryDisplay,
        });
        _syncSelectedModel(
          (data.provider_id ?? data.provider) as string | undefined,
          (data.model_id ?? data.model) as string | undefined,
        );
        if (useAgentStore.getState().isStreaming) {
          s.finalizeLastAgentMessage();
        }
        s.setHandoffPending(false);
        const provider = (data.provider as string | undefined) ?? useAgentStore.getState().selectedProvider;
        s.setToastMessage(`Model changed to ${provider}`);
        _fetchMemories().catch(() => {});
        break;
      }

      case "chunk":
        _ensureAgentMessageOpen();
        {
          const chunk = data.content ?? "";
          s.appendRawChunk(chunk);
          const events = _parser?.feed(chunk) ?? [];
          if (events.length > 0) s.appendStreamEvents(events);
        }
        break;

      case "activity":
        if (data.event) {
          _ensureAgentMessageOpen();
          s.appendStreamEvents([data.event]);
        }
        break;

      case "command_event": {
        const commandEvent = data.event as {
          type?: string;
          run_id?: string;
          command?: string;
          cwd?: string;
          exit_code?: number | null;
          timed_out?: boolean;
          duration_ms?: number;
          conversation_id?: string | null;
        } | undefined;
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("nid:command-event", { detail: commandEvent }));
        }
        if (!commandEvent?.run_id || !commandEvent.command) break;
        const activeConversation = useAgentStore.getState().conversationId;
        if (commandEvent.conversation_id && activeConversation && commandEvent.conversation_id !== activeConversation) {
          break;
        }
        if (commandEvent.type === "started") {
          if (!useAgentStore.getState().isStreaming) {
            useAgentStore.getState().addMessage("agent", "");
            useAgentStore.setState({ isStreaming: true });
            _commandTimelineRunIds.add(commandEvent.run_id);
            useAgentStore.getState().appendStreamEvents([{
              type: "tool_start",
              provider: "nidavellir",
              id: `command:${commandEvent.run_id}`,
              name: "shell",
              args: JSON.stringify({ command: commandEvent.command, cwd: commandEvent.cwd }),
            }]);
          }
        } else if (commandEvent.type === "finished") {
          if (_commandTimelineRunIds.has(commandEvent.run_id)) {
            useAgentStore.getState().appendStreamEvents([{
              type: "tool_end",
              provider: "nidavellir",
              id: `command:${commandEvent.run_id}`,
              status: commandEvent.exit_code === 0 && !commandEvent.timed_out ? "success" : "error",
              summary: commandEvent.timed_out
                ? "Timed out"
                : `Exit ${commandEvent.exit_code ?? "-"} in ${commandEvent.duration_ms ?? 0}ms`,
            }]);
            s.finalizeLastAgentMessage();
            useAgentStore.setState({ isStreaming: false });
            _commandTimelineRunIds.delete(commandEvent.run_id);
          }
          s.markResourcesChanged("Command run captured");
        }
        break;
      }

      case "done":
        {
          const events = _parser?.flush() ?? [];
          if (events.length > 0) s.appendStreamEvents(events);
          _parser = null;
        }
        s.finalizeLastAgentMessage();
        _clearActiveTurn(data.turn_id as string | undefined);
        _agentMessageOpen = false;
        break;

      case "error":
        if (!_agentMessageOpen) {
          // Error before any chunks — still need a bubble to show the error in
          s.addMessage("agent", "");
          _agentMessageOpen = true;
        }
        s.finalizeWithError(data.message ?? "unknown error");
        _clearActiveTurn(data.turn_id as string | undefined);
        _parser = null;
        _agentMessageOpen = false;
        break;

      case "cancelled":
        if (_agentMessageOpen || useAgentStore.getState().isStreaming) {
          s.finalizeLastAgentMessage();
        }
        _clearActiveTurn(data.turn_id as string | undefined);
        _parser = null;
        _agentMessageOpen = false;
        break;

      case "resume_connection_ready":
        if (data.status === "running") {
          useAgentStore.getState().setToastMessage("Reconnected to running agent");
          _ensureAgentMessageOpen();
        } else if (data.status === "completed" || data.status === "cancelled") {
          useAgentStore.getState().setToastMessage("Reconnected");
          _clearActiveTurn(data.turn_id as string | undefined);
          _agentMessageOpen = false;
          _parser = null;
        } else {
          if (useAgentStore.getState().isStreaming) {
            s.finalizeWithError("connection lost — response may be incomplete");
          }
          _clearActiveTurn(data.turn_id as string | undefined);
          _agentMessageOpen = false;
          _parser = null;
        }
        break;
    }
  };

  ws.onerror = () => {
    useAgentStore.getState().setConnectionStatus("error");
  };

  ws.onclose = () => {
    if (_ws !== ws) return;
    const store = useAgentStore.getState();
    if (store.isStreaming && !_activeTurn()?.turnId) {
      store.finalizeWithError("connection lost — response may be incomplete");
    }
    _agentMessageOpen = false;
    _parser = null;
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
  mode: "continue_with_prior_context" | "start_clean" | "continue" | "clean" | "review",
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

export function sendMessage(content: string): boolean {
  if (_ws?.readyState !== WebSocket.OPEN) return false;
  const conversationId = useAgentStore.getState().conversationId;
  const turnId = _uuid();
  _persistActiveTurn(turnId, conversationId);
  if (!_agentMessageOpen) {
    _ensureAgentMessageOpen();
  }
  _ws.send(JSON.stringify({
    type: "message",
    content,
    conversation_id: conversationId,
    turn_id: turnId,
    client_connection_id: _connectionId(),
  }));
  return true;
}

export function sendCancel(): boolean {
  if (_ws?.readyState !== WebSocket.OPEN) return false;
  _ws.send(JSON.stringify({
    type: "cancel",
    turn_id: _activeTurn()?.turnId,
    client_connection_id: _connectionId(),
  }));
  useAgentStore.getState().finalizeWithError("stopped by user");
  _clearActiveTurn();
  _agentMessageOpen = false;
  _parser = null;
  return true;
}

export function sendSteer(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || _ws?.readyState !== WebSocket.OPEN) return false;
  _ws.send(JSON.stringify({
    type: "steer",
    content: trimmed,
    turn_id: _activeTurn()?.turnId,
    conversation_id: useAgentStore.getState().conversationId,
    client_connection_id: _connectionId(),
  }));
  useAgentStore.getState().appendStreamEvents([{ type: "steering_signal", content: trimmed }]);
  return true;
}

export function sendRedirectSteer(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || _ws?.readyState !== WebSocket.OPEN) return false;
  _ws.send(JSON.stringify({
    type: "redirect",
    content: trimmed,
    turn_id: _activeTurn()?.turnId,
    conversation_id: useAgentStore.getState().conversationId,
    client_connection_id: _connectionId(),
  }));
  useAgentStore.getState().appendStreamEvents([{ type: "steering_signal", content: `Redirected: ${trimmed}` }]);
  useAgentStore.getState().finalizeWithError("redirected by user");
  _clearActiveTurn();
  _agentMessageOpen = false;
  _parser = null;
  return true;
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
  _parser = null;
  _activeTurnId = null;
  _commandTimelineRunIds.clear();
  _clientConnectionId = "";
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(ACTIVE_TURN_KEY);
    } catch {
      // test cleanup only
    }
  }
}

/** Test-only: injects a socket-like object for payload serialization tests. */
export function _testSetSocket(ws: WebSocket): void {
  _ws = ws;
}
