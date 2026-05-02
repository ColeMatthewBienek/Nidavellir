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

  it("dedupes repeated assistant answer deltas from provider snapshots", () => {
    useAgentStore.getState().addMessage("agent", "");

    useAgentStore.getState().appendStreamEvents([
      { type: "answer_delta", content: "Running the full test harness." },
      { type: "answer_delta", content: "Running the full test harness." },
    ]);

    const msg = useAgentStore.getState().messages[0];
    expect(msg.events).toEqual([
      { type: "answer_delta", content: "Running the full test harness." },
    ]);
  });

  it("converts cumulative assistant snapshots into only the new suffix", () => {
    useAgentStore.getState().addMessage("agent", "");

    useAgentStore.getState().appendStreamEvents([
      { type: "answer_delta", content: "Running the full test harness." },
      { type: "answer_delta", content: "Running the full test harness. 476 passed, 1 failed." },
    ]);

    const msg = useAgentStore.getState().messages[0];
    expect(msg.events).toEqual([
      { type: "answer_delta", content: "Running the full test harness." },
      { type: "answer_delta", content: " 476 passed, 1 failed." },
    ]);
  });

  it("drops newline-prefixed repeated assistant snapshots across parser calls", () => {
    useAgentStore.getState().addMessage("agent", "");

    const answer = [
      "Good. I know the codebase well enough to grill you properly now.",
      "",
      "Question 1: What problem are you actually trying to solve with multilevel orchestration?",
      "",
      "My guess: you want to break a large task into subtasks.",
    ].join("\n");

    useAgentStore.getState().appendStreamEvents([
      { type: "answer_delta", content: answer },
    ]);
    useAgentStore.getState().appendStreamEvents([
      { type: "answer_delta", content: `\n${answer}` },
    ]);

    const msg = useAgentStore.getState().messages[0];
    const content = msg.events
      .filter((event) => event.type === "answer_delta")
      .map((event) => event.content)
      .join("");
    expect(content.match(/Question 1:/g)).toHaveLength(1);
    expect(msg.events).toEqual([{ type: "answer_delta", content: answer }]);
  });

  it("collapses duplicated text inside a single provider answer delta", () => {
    useAgentStore.getState().addMessage("agent", "");

    useAgentStore.getState().appendStreamEvents([
      {
        type: "answer_delta",
        content: "That string is coming from an external library.That string is coming from an external library.",
      },
    ]);

    const msg = useAgentStore.getState().messages[0];
    expect(msg.events).toEqual([
      { type: "answer_delta", content: "That string is coming from an external library." },
    ]);
  });

  it("collapses duplicated answer sections inside a single provider snapshot", () => {
    useAgentStore.getState().addMessage("agent", "");

    const section = [
      "Here's my honest assessment:",
      "Memory Implementation Review",
      "Overall: Solid foundation, a few gaps worth addressing.",
      "",
      "Priority fixes",
      "| Priority | Action |",
      "|---|---|",
      "| High | Update project_overview.md |",
    ].join("\n");

    useAgentStore.getState().appendStreamEvents([
      {
        type: "answer_delta",
        content: `Let me read the memory index.\n${section}\n${section}`,
      },
    ]);

    const msg = useAgentStore.getState().messages[0];
    const content = msg.events
      .filter((event) => event.type === "answer_delta")
      .map((event) => event.content)
      .join("");
    expect(content.match(/Memory Implementation Review/g)).toHaveLength(1);
    expect(content.match(/\| Priority \| Action \|/g)).toHaveLength(1);
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

  it("records completion time for finished agent messages", () => {
    useAgentStore.getState().addMessage("agent", "");
    useAgentStore.getState().finalizeLastAgentMessage();
    expect(useAgentStore.getState().messages[0].completedAt).toBeInstanceOf(Date);
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

describe("conversation resume timestamps", () => {
  it("parses backend naive UTC timestamps as UTC instead of local wall time", async () => {
    const fetchMock = async (url: RequestInfo | URL) => {
      const text = String(url);
      if (text.endsWith("/api/conversations/conv-time")) {
        return Response.json({
          id: "conv-time",
          title: "Time",
          activeSessionId: "session-time",
          activeProvider: "codex",
          activeModel: "gpt-5.5",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "Bugfix",
              createdAt: "2026-04-28 14:48:04",
            },
          ],
          selectedFiles: [],
        });
      }
      if (text.endsWith("/api/conversations/conv-time/files")) return Response.json([]);
      if (text.includes("/api/context/usage")) return new Response("{}", { status: 500 });
      if (text.endsWith("/api/conversations")) return Response.json([]);
      return new Response("{}", { status: 404 });
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      await useAgentStore.getState().loadConversation("conv-time");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(useAgentStore.getState().messages[0].timestamp.toISOString()).toBe("2026-04-28T14:48:04.000Z");
    expect(useAgentStore.getState().selectedModel).toBe("codex:gpt-5.5");
  });
});
