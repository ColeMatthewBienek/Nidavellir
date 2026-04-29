/**
 * Tests for agentSocket WebSocket handling.
 * Written FIRST. Run vitest to confirm failure. Then implement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAgentStore } from "@/store/agentStore";
import { initSocket, sendCancel, sendMessage, sendRedirectSteer, sendSteer, _testResetSocket } from "@/lib/agentSocket";

// ── MockWebSocket ────────────────────────────────────────────────────────────

export const wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  static OPEN       = 1;
  static CONNECTING = 0;
  static CLOSING    = 2;
  static CLOSED     = 3;

  readyState = 0;
  url: string;

  onopen:    ((e: Event) => void) | null        = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose:   ((e: CloseEvent) => void) | null   = null;
  onerror:   ((e: Event) => void) | null        = null;

  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
  }

  sent: string[] = [];

  send(data: string) { this.sent.push(data); }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  simulateMessage(data: object) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) })
    );
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  simulateError() {
    this.onerror?.(new Event("error"));
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function setupOpenSocket(): MockWebSocket {
  _testResetSocket();
  initSocket();
  wsInstances[wsInstances.length - 1].simulateOpen();
  return wsInstances[wsInstances.length - 1];
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  wsInstances.length = 0;
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.useFakeTimers();
  _testResetSocket();
  useAgentStore.setState({ messages: [], isStreaming: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── Connection ───────────────────────────────────────────────────────────────

describe("connection", () => {
  it("initSocket creates a WebSocket instance", () => {
    initSocket();
    expect(wsInstances).toHaveLength(1);
  });

  it("sets connectionStatus to connected on open", () => {
    const ws = setupOpenSocket();
    expect(useAgentStore.getState().connectionStatus).toBe("connected");
    ws.simulateClose();
  });

  it("does not create a second socket if already open", () => {
    setupOpenSocket();
    initSocket();
    expect(wsInstances).toHaveLength(1);
  });
});

// ── Chunk handling — raw storage ─────────────────────────────────────────────

describe("chunk handling — raw storage", () => {
  it("opens an empty streaming agent message immediately when sending", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ conversationId: "conv-now" });

    expect(sendMessage("hello")).toBe(true);

    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.role).toBe("agent");
    expect(msg.content).toBe("");
    expect(msg.streaming).toBe(true);
    expect(useAgentStore.getState().isStreaming).toBe(true);
    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({
      type: "message",
      content: "hello",
      conversation_id: "conv-now",
      turn_id: expect.any(String),
      client_connection_id: expect.any(String),
    });
  });

  it("sends cancel and finalizes the active agent message locally", () => {
    const ws = setupOpenSocket();
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.setState({ isStreaming: true });

    expect(sendCancel()).toBe(true);

    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({ type: "cancel" });
    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.streaming).toBe(false);
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });

  it("sends steering comments against the active turn without finalizing the stream", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ conversationId: "conv-now" });
    expect(sendMessage("start long task")).toBe(true);
    const messageFrame = JSON.parse(ws.sent.at(-1)!);

    expect(sendSteer("Check the Git tab tree while you are there.")).toBe(true);

    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({
      type: "steer",
      content: "Check the Git tab tree while you are there.",
      conversation_id: "conv-now",
      turn_id: messageFrame.turn_id,
      client_connection_id: expect.any(String),
    });
    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.streaming).toBe(true);
    expect(msg.events).toContainEqual({
      type: "steering_signal",
      content: "Check the Git tab tree while you are there.",
    });
  });

  it("sends redirect steering and finalizes the local active stream", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ conversationId: "conv-now" });
    expect(sendMessage("start long task")).toBe(true);
    const messageFrame = JSON.parse(ws.sent.at(-1)!);

    expect(sendRedirectSteer("Stop and use the tree-view approach.")).toBe(true);

    expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({
      type: "redirect",
      content: "Stop and use the tree-view approach.",
      conversation_id: "conv-now",
      turn_id: messageFrame.turn_id,
      client_connection_id: expect.any(String),
    });
    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.streaming).toBe(false);
    expect(useAgentStore.getState().isStreaming).toBe(false);
    expect(msg.events).toContainEqual({
      type: "steering_signal",
      content: "Redirected: Stop and use the tree-view approach.",
    });
  });

  it("finalizes streaming state when backend confirms cancellation", () => {
    const ws = setupOpenSocket();
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.setState({ isStreaming: true });

    ws.simulateMessage({ type: "cancelled" });

    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.streaming).toBe(false);
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });

  it("keeps visible chat history when a session switch completes in the same conversation", () => {
    const ws = setupOpenSocket();
    useAgentStore.getState().addMessage("user", "old question");
    useAgentStore.getState().addMessage("agent", "old answer");
    useAgentStore.getState().finalizeLastAgentMessage();

    ws.simulateMessage({
      type: "session_switch_ready",
      conversation_id: "conv-now",
      provider: "codex",
      mode: "continue_with_prior_context",
    });

    const messages = useAgentStore.getState().messages;
    expect(messages.map((msg) => msg.content)).toEqual(["old question", "old answer"]);
    expect(useAgentStore.getState().conversationId).toBe("conv-now");
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });

  it("stores server-authoritative workspace from session_ready", () => {
    const ws = setupOpenSocket();

    ws.simulateMessage({
      type: "session_ready",
      conversation_id: "conv-now",
      provider_id: "codex",
      model_id: "gpt-5.5",
      working_directory: "/mnt/c/Users/colebienek/projects/nidavellir",
      working_directory_display: "C:\\Users\\colebienek\\projects\\nidavellir",
    });

    expect(useAgentStore.getState().workingDirectory).toBe("/mnt/c/Users/colebienek/projects/nidavellir");
    expect(useAgentStore.getState().workingDirectoryDisplay).toBe("C:\\Users\\colebienek\\projects\\nidavellir");
  });

  it("stores raw chunk including ANSI codes — stripping is parser responsibility", () => {
    const ws = setupOpenSocket();
    // First chunk creates the agent bubble automatically
    ws.simulateMessage({ type: "chunk", content: "\x1b[32mhello\x1b[0m" });
    const msgs = useAgentStore.getState().messages;
    const msg = msgs[msgs.length - 1];
    expect(msg.rawChunks[0]).toBe("\x1b[32mhello\x1b[0m");
    expect(msg.content).toContain("\x1b[32mhello\x1b[0m");
  });

  it("calls appendRawChunk for chunk messages", () => {
    const ws = setupOpenSocket();
    // First chunk creates the agent bubble automatically
    ws.simulateMessage({ type: "chunk", content: "plain text" });
    const msgs = useAgentStore.getState().messages;
    const msg = msgs[msgs.length - 1];
    expect(msg.rawChunks).toContain("plain text");
  });

  it("parses provider chunks into stream events for the live activity feed", () => {
    useAgentStore.setState({ selectedProvider: "claude", selectedModel: "claude:claude-sonnet-4-6" });
    const ws = setupOpenSocket();

    ws.simulateMessage({ type: "chunk", content: "◆ Bash(ls -la)\n" });

    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.events).toContainEqual({
      type: "tool_start",
      id: "claude-tool-1",
      name: "Bash",
      args: "ls -la",
      raw: "◆ Bash(ls -la)",
    });
  });

  it("appends backend activity frames before answer chunks arrive", () => {
    const ws = setupOpenSocket();

    ws.simulateMessage({
      type: "activity",
      event: { type: "progress", content: "Prompt sent to provider" },
    });

    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.role).toBe("agent");
    expect(msg.streaming).toBe(true);
    expect(msg.events).toContainEqual({ type: "progress", content: "Prompt sent to provider" });
  });

  it("preserves typed provider activity metadata from the backend", () => {
    const ws = setupOpenSocket();

    ws.simulateMessage({
      type: "activity",
      event: {
        type: "tool_start",
        provider: "codex",
        id: "call-1",
        name: "exec",
        args: "/bin/bash -lc pwd",
        raw: { type: "item.started" },
      },
    });

    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.events).toContainEqual({
      type: "tool_start",
      provider: "codex",
      id: "call-1",
      name: "exec",
      args: "/bin/bash -lc pwd",
      raw: { type: "item.started" },
    });
  });

  it("flushes parser events when the response finishes", () => {
    useAgentStore.setState({ selectedProvider: "claude", selectedModel: "claude:claude-sonnet-4-6" });
    const ws = setupOpenSocket();

    ws.simulateMessage({ type: "chunk", content: "final partial" });
    ws.simulateMessage({ type: "done" });

    const msg = useAgentStore.getState().messages.at(-1)!;
    expect(msg.events).toContainEqual({ type: "answer_delta", content: "final partial" });
    expect(msg.events).toContainEqual({ type: "done" });
  });

  it("calls finalizeLastAgentMessage on done message", () => {
    const ws = setupOpenSocket();
    // Simulate chunk first to open the agent message, then done
    ws.simulateMessage({ type: "chunk", content: "partial" });
    ws.simulateMessage({ type: "done" });
    expect(useAgentStore.getState().isStreaming).toBe(false);
    const msgs = useAgentStore.getState().messages;
    expect(msgs[msgs.length - 1].streaming).toBe(false);
  });
});

// ── Disconnect recovery ───────────────────────────────────────────────────────

describe("disconnect recovery", () => {
  it("calls finalizeWithError when socket closes during streaming without an owned turn", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ isStreaming: true });
    useAgentStore.getState().addMessage("agent", "partial");
    ws.simulateClose();
    const msgs = useAgentStore.getState().messages;
    const last = msgs[msgs.length - 1];
    expect(last.streaming).toBe(false);
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });

  it("does not finalize an owned running turn on close and resumes it on reconnect", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ conversationId: "conv-now" });

    expect(sendMessage("hello")).toBe(true);
    const sent = JSON.parse(ws.sent.at(-1)!);
    ws.simulateClose();

    expect(useAgentStore.getState().isStreaming).toBe(true);
    vi.advanceTimersByTime(3000);
    const next = wsInstances[1];
    next.simulateOpen();

    expect(JSON.parse(next.sent.at(-1)!)).toMatchObject({
      type: "resume_connection",
      conversation_id: "conv-now",
      turn_id: sent.turn_id,
      client_connection_id: expect.any(String),
    });
  });

  it("shows a subtle reconnect state when backend reports the turn is still running", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ conversationId: "conv-now" });
    sendMessage("hello");
    const sent = JSON.parse(ws.sent.at(-1)!);
    ws.simulateClose();
    vi.advanceTimersByTime(3000);
    const next = wsInstances[1];
    next.simulateOpen();

    next.simulateMessage({
      type: "resume_connection_ready",
      turn_id: sent.turn_id,
      status: "running",
    });

    expect(useAgentStore.getState().toastMessage).toBe("Reconnected to running agent");
    expect(useAgentStore.getState().isStreaming).toBe(true);
    expect(useAgentStore.getState().messages.at(-1)?.content).not.toContain("connection lost");
  });

  it("marks the response incomplete when backend cannot resume the owned turn", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ conversationId: "conv-now" });
    sendMessage("hello");
    const sent = JSON.parse(ws.sent.at(-1)!);
    ws.simulateClose();
    vi.advanceTimersByTime(3000);
    const next = wsInstances[1];
    next.simulateOpen();

    next.simulateMessage({
      type: "resume_connection_ready",
      turn_id: sent.turn_id,
      status: "gone",
    });

    expect(useAgentStore.getState().isStreaming).toBe(false);
    expect(useAgentStore.getState().messages.at(-1)?.content).toContain("connection lost");
  });

  it("does not call finalizeWithError when socket closes with no streaming", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ isStreaming: false });
    expect(() => ws.simulateClose()).not.toThrow();
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });

  it("reconnects after 3 seconds regardless of streaming state", () => {
    _testResetSocket();
    initSocket();
    wsInstances[0].simulateOpen();
    useAgentStore.setState({ isStreaming: true });
    wsInstances[0].simulateClose();
    vi.advanceTimersByTime(3000);
    expect(wsInstances).toHaveLength(2);
  });
});
