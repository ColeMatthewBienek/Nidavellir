import { describe, expect, it } from "vitest";
import { CodexStreamParser } from "../CodexStreamParser";

describe("CodexStreamParser", () => {
  it("classifies CLI exec telemetry as activity instead of answer text", () => {
    const parser = new CodexStreamParser();

    const events = parser.feed([
      "I’m locating the frontend files now.\n",
      "exec /bin/bash -lc 'rg --files .' in /mnt/c/Users/colebienek/projects/nidavellir\n",
      "succeeded in 351ms: ./package.json ./frontend/src/screens/ChatScreen.tsx\n",
      "I found the chat screen.\n",
    ].join(""));

    expect(events).toContainEqual({ type: "progress", content: "I’m locating the frontend files now.\n" });
    expect(events).toContainEqual({
      type: "tool_start",
      id: "codex-tool-1",
      name: "exec",
      args: "/bin/bash -lc 'rg --files .' in /mnt/c/Users/colebienek/projects/nidavellir",
      raw: "exec /bin/bash -lc 'rg --files .' in /mnt/c/Users/colebienek/projects/nidavellir",
    });
    expect(events).toContainEqual({
      type: "tool_end",
      id: "codex-tool-1",
      status: "success",
      summary: "succeeded in 351ms: ./package.json ./frontend/src/screens/ChatScreen.tsx",
    });
    expect(events).toContainEqual({ type: "answer_delta", content: "I found the chat screen.\n" });
  });

  it("emits tool_start immediately before the tool result is available", () => {
    const parser = new CodexStreamParser();

    const events = parser.feed("exec /bin/bash -lc pwd in /mnt/c/Users/colebienek/projects/nidavellir\n");

    expect(events).toEqual([{
      type: "tool_start",
      id: "codex-tool-1",
      name: "exec",
      args: "/bin/bash -lc pwd in /mnt/c/Users/colebienek/projects/nidavellir",
      raw: "exec /bin/bash -lc pwd in /mnt/c/Users/colebienek/projects/nidavellir",
    }]);
  });
});
