import { describe, expect, it } from "vitest";
import type { Message } from "@/store/agentStore";
import { buildCompletionReport, formatDuration, isBuildCompletion } from "@/lib/completionReport";

function message(overrides: Partial<Message>): Message {
  return {
    id: "m1",
    role: "agent",
    content: "Implemented the process change.",
    timestamp: new Date("2026-04-27T20:00:00.000Z"),
    completedAt: new Date("2026-04-27T20:01:34.000Z"),
    streaming: false,
    rawChunks: [],
    events: [],
    ...overrides,
  };
}

describe("completionReport", () => {
  it("builds a report for completed build work with changed files and verification commands", () => {
    const report = buildCompletionReport(message({
      events: [
        { type: "answer_delta", content: "Implemented the process change.\n" },
        { type: "patch", content: [
          "diff --git a/frontend/src/lib/agentSocket.ts b/frontend/src/lib/agentSocket.ts",
          "--- a/frontend/src/lib/agentSocket.ts",
          "+++ b/frontend/src/lib/agentSocket.ts",
          "@@",
          "-        s.clearMessages();",
          "+        if (useAgentStore.getState().isStreaming) {",
          "+          s.finalizeLastAgentMessage();",
          "+        }",
        ].join("\n") },
        { type: "tool_start", id: "t1", name: "exec", args: "cd frontend && npm test -- --run src/lib/__tests__/agentSocket.test.ts" },
        { type: "tool_end", id: "t1", status: "success", summary: "17 tests passed" },
      ],
    }));

    expect(report).not.toBeNull();
    expect(report?.outcome).toBe("Changed 1 file and verified with 1 command.");
    expect(report?.durationMs).toBe(94_000);
    expect(report?.changedFiles[0]).toMatchObject({
      path: "frontend/src/lib/agentSocket.ts",
      additions: 3,
      deletions: 1,
    });
    expect(report?.totalAdditions).toBe(3);
    expect(report?.totalDeletions).toBe(1);
    expect(report?.verifications).toEqual([
      {
        command: "cd frontend && npm test -- --run src/lib/__tests__/agentSocket.test.ts",
        status: "success",
        summary: "17 tests passed",
      },
    ]);
  });

  it("does not produce a report for ordinary completed chat replies", () => {
    expect(isBuildCompletion(message({
      content: "The capital of France is Paris.",
      events: [{ type: "answer_delta", content: "The capital of France is Paris." }],
    }))).toBe(false);
  });

  it("formats short and minute-level durations", () => {
    expect(formatDuration(12_000)).toBe("Worked for 12s");
    expect(formatDuration(94_000)).toBe("Worked for 1m 34s");
  });
});
