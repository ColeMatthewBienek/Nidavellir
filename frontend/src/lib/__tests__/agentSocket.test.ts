/**
 * Tests for agentSocket WebSocket handling.
 * Written FIRST. Run vitest to confirm failure. Then implement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAgentStore } from "@/store/agentStore";
import { initSocket, _testResetSocket } from "@/lib/agentSocket";

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

  send(_data: string) {}

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
  it("calls finalizeWithError when socket closes during streaming", () => {
    const ws = setupOpenSocket();
    useAgentStore.setState({ isStreaming: true });
    useAgentStore.getState().addMessage("agent", "partial");
    ws.simulateClose();
    const msgs = useAgentStore.getState().messages;
    const last = msgs[msgs.length - 1];
    expect(last.streaming).toBe(false);
    expect(useAgentStore.getState().isStreaming).toBe(false);
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
