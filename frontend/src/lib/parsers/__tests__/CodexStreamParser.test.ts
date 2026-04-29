import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CodexStreamParser } from "../CodexStreamParser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

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

  it("keeps tool telemetry and diffs in activity/artifact lanes from fixture corpus", () => {
    const parser = new CodexStreamParser();

    const events = parser.feed(fixture("codex-tool-and-diff.txt"));

    expect(events).toContainEqual({
      type: "progress",
      content: "I’m checking the websocket path and renderer.\n",
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_start",
      name: "exec",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_end",
      status: "success",
    }));
    expect(events).toContainEqual({
      type: "patch",
      content: [
        "diff --git a/frontend/src/lib/agentSocket.ts b/frontend/src/lib/agentSocket.ts",
        "--- a/frontend/src/lib/agentSocket.ts",
        "+++ b/frontend/src/lib/agentSocket.ts",
        "@@ -1,2 +1,2 @@",
        "-old line",
        "+new line",
      ].join("\n"),
    });
    expect(events).toContainEqual({
      type: "answer_delta",
      content: "I found the socket path.\n",
    });
  });
});
