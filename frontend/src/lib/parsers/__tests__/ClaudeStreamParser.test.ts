import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ClaudeStreamParser } from "../ClaudeStreamParser";
import { useAgentStore } from "@/store/agentStore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("ClaudeStreamParser", () => {
  it("routes text splitter warnings to activity instead of answer text", () => {
    const parser = new ClaudeStreamParser();

    const events = parser.feed(`${fixture("claude-splitter-warning.txt")}\n`);

    expect(events).toEqual([
      {
        type: "progress",
        provider: "claude",
        content: "Provider text-splitting warning: ⚠ Separator is found, but chunk is longer than limit",
      },
    ]);
  });

  it("routes non-symbol splitter warnings to activity on flush", () => {
    const parser = new ClaudeStreamParser();

    parser.feed("Separator is not found, but chunk exceed the limit");

    expect(parser.flush()).toEqual([
      {
        type: "progress",
        provider: "claude",
        content: "Provider text-splitting warning: Separator is not found, but chunk exceed the limit",
      },
      { type: "done" },
    ]);
  });

  it("keeps duplicated Claude answer snapshots out of rendered store events", () => {
    useAgentStore.setState({ messages: [], isStreaming: false });
    useAgentStore.getState().addMessage("agent", "");
    const events = JSON.parse(fixture("claude-duplicated-answer.json"));

    useAgentStore.getState().appendStreamEvents(events);

    expect(useAgentStore.getState().messages[0].events).toEqual([
      {
        type: "answer_delta",
        content: "That string isn't in the Nidavellir codebase — it's coming from an external library.",
      },
      {
        type: "answer_delta",
        content: "This warning comes from LangChain's RecursiveCharacterTextSplitter.",
      },
    ]);
  });
});
