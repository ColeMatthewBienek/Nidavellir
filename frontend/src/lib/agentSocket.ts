import { useAgentStore } from "@/store/agentStore";

const WS_URL = "ws://localhost:7430/api/ws";

let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _agentMessageOpen = false;

function connect(): void {
  const ws = new WebSocket(WS_URL);
  _ws = ws;

  ws.onopen = () => {
    useAgentStore.getState().setConnectionStatus("connected");
  };

  ws.onmessage = (event: MessageEvent) => {
    let data: { type: string; content?: string; message?: string };
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }
    const s = useAgentStore.getState();
    switch (data.type) {
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

export function sendNewSession(providerId: string, modelId: string): void {
  if (_ws?.readyState !== WebSocket.OPEN) return;
  _ws.send(JSON.stringify({ type: "new_session", provider_id: providerId, model_id: modelId }));
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
