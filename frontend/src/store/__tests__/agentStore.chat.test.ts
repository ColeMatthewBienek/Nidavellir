/**
 * Tests for Message type refactor and new chat actions.
 * Written FIRST. Run vitest to confirm failure. Then implement.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "@/store/agentStore";

beforeEach(() => {
  useAgentStore.setState({
    messages: [],
    isStreaming: false,
  });
});

describe("Message shape", () => {
  it("addMessage creates message with rawChunks and events arrays", () => {
    useAgentStore.getState().addMessage("agent", "");
    const msg = useAgentStore.getState().messages[0];
    expect(Array.isArray(msg.rawChunks)).toBe(true);
    expect(Array.isArray(msg.events)).toBe(true);
    expect(msg.rawChunks).toHaveLength(0);
    expect(msg.events).toHaveLength(0);
  });

  it("addMessage with initial content sets content but not rawChunks", () => {
    useAgentStore.getState().addMessage("user", "hello");
    const msg = useAgentStore.getState().messages[0];
    expect(msg.content).toBe("hello");
    expect(msg.rawChunks).toHaveLength(0);
  });
});

describe("appendRawChunk", () => {
  it("appends raw chunk to last agent message rawChunks", () => {
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().appendRawChunk("hello world");
    const msg = useAgentStore.getState().messages[0];
    expect(msg.rawChunks).toEqual(["hello world"]);
  });

  it("appends multiple chunks in order", () => {
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().appendRawChunk("chunk1");
    useAgentStore.getState().appendRawChunk("chunk2");
    useAgentStore.getState().appendRawChunk("chunk3");
    const msg = useAgentStore.getState().messages[0];
    expect(msg.rawChunks).toEqual(["chunk1", "chunk2", "chunk3"]);
  });

  it("also updates content string for backward compat", () => {
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().appendRawChunk("hello");
    useAgentStore.getState().appendRawChunk(" world");
    const msg = useAgentStore.getState().messages[0];
    expect(msg.content).toContain("hello");
    expect(msg.content).toContain(" world");
  });

  it("does nothing if last message is not an agent message", () => {
    useAgentStore.getState().addMessage("user", "hi");
    useAgentStore.getState().appendRawChunk("chunk");
    const msg = useAgentStore.getState().messages[0];
    expect(msg.rawChunks).toHaveLength(0);
    expect(msg.content).toBe("hi");
  });

  it("does nothing if messages array is empty", () => {
    expect(() => {
      useAgentStore.getState().appendRawChunk("chunk");
    }).not.toThrow();
  });
});

describe("appendStreamEvents", () => {
  it("appends events to last agent message", () => {
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().appendStreamEvents([
      { type: "text", content: "hello" },
      { type: "text", content: " world" },
    ]);
    const msg = useAgentStore.getState().messages[0];
    expect(msg.events).toHaveLength(2);
    expect(msg.events[0]).toEqual({ type: "text", content: "hello" });
  });

  it("accumulates events across multiple calls", () => {
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().appendStreamEvents([{ type: "text", content: "a" }]);
    useAgentStore.getState().appendStreamEvents([{ type: "tool_use", tool: "Bash", args: "ls", raw: "◆ Bash(ls)" }]);
    const msg = useAgentStore.getState().messages[0];
    expect(msg.events).toHaveLength(2);
    expect(msg.events[1].type).toBe("tool_use");
  });

  it("does nothing if last message is not agent", () => {
    useAgentStore.getState().addMessage("user", "hi");
    useAgentStore.getState().appendStreamEvents([{ type: "text", content: "x" }]);
    const msg = useAgentStore.getState().messages[0];
    expect(msg.events).toHaveLength(0);
  });
});

describe("finalizeLastAgentMessage", () => {
  it("sets streaming to false on last agent message", () => {
    useAgentStore.getState().addMessage("agent", "");
    expect(useAgentStore.getState().messages[0].streaming).toBe(true);
    useAgentStore.getState().finalizeLastAgentMessage();
    expect(useAgentStore.getState().messages[0].streaming).toBe(false);
  });

  it("sets isStreaming to false on the store", () => {
    useAgentStore.setState({ isStreaming: true });
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().finalizeLastAgentMessage();
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });
});

describe("finalizeWithError", () => {
  it("appends error suffix to content and clears streaming state", () => {
    useAgentStore.getState().addMessage("agent", "partial response");
    useAgentStore.setState({ isStreaming: true });
    useAgentStore.getState().finalizeWithError("connection lost");
    const msg = useAgentStore.getState().messages[0];
    expect(msg.content).toContain("partial response");
    expect(msg.content).toContain("connection lost");
    expect(msg.streaming).toBe(false);
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });

  it("also appends an error event to the message events", () => {
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().finalizeWithError("connection lost");
    const msg = useAgentStore.getState().messages[0];
    const errEvent = msg.events.find((e) => e.type === "error");
    expect(errEvent).toBeTruthy();
    expect((errEvent as { type: "error"; message: string }).message).toContain("connection lost");
  });

  it("is a no-op if no messages exist", () => {
    expect(() => {
      useAgentStore.getState().finalizeWithError("oops");
    }).not.toThrow();
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });
});

describe("backward compatibility", () => {
  it("appendToLastAgentMessage still works (delegates to appendRawChunk)", () => {
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().appendToLastAgentMessage("compat chunk");
    const msg = useAgentStore.getState().messages[0];
    expect(msg.content).toContain("compat chunk");
  });
});
