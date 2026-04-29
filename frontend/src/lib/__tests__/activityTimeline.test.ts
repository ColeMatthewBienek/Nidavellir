import { describe, expect, it } from "vitest";
import { buildActivityTimeline } from "@/lib/activityTimeline";
import type { StreamEvent } from "@/lib/streamTypes";

describe("activityTimeline", () => {
  it("turns progress events into narrative work-log lines", () => {
    const timeline = buildActivityTimeline([
      { type: "progress", content: "I’m checking the websocket path and renderer." },
    ]);

    expect(timeline).toContainEqual({
      type: "narration",
      text: "I’m checking the websocket path and renderer.",
    });
  });

  it("groups reads and searches into an explored summary with readable items", () => {
    const events: StreamEvent[] = [
      { type: "tool_start", id: "s1", name: "exec", args: "/bin/bash -lc 'rg -n \"AgentActivity\" frontend/src'" },
      { type: "tool_end", id: "s1", status: "success", summary: "4 matches" },
      { type: "tool_start", id: "r1", name: "exec", args: "sed -n '1,260p' frontend/src/components/chat/MessageList.tsx" },
      { type: "tool_end", id: "r1", status: "success", summary: "read ok" },
      { type: "tool_start", id: "r2", name: "exec", args: "sed -n '1,220p' frontend/src/lib/agentSocket.ts" },
      { type: "tool_end", id: "r2", status: "success", summary: "read ok" },
    ];

    const timeline = buildActivityTimeline(events);

    expect(timeline).toEqual([
      {
        type: "summary",
        label: "Explored 2 files, 1 search",
        items: [
          { label: "Searched for \"AgentActivity\"", detail: "4 matches", status: "success", tone: "search" },
          { label: "Read MessageList.tsx", detail: "frontend/src/components/chat/MessageList.tsx", status: "success", tone: "read" },
          { label: "Read agentSocket.ts", detail: "frontend/src/lib/agentSocket.ts", status: "success", tone: "read" },
        ],
      },
    ]);
  });

  it("surfaces failed tools as problems with the attempted command", () => {
    const timeline = buildActivityTimeline([
      { type: "tool_start", id: "bad", name: "exec", args: "/bin/bash -lc 'npm run typecheck'" },
      { type: "tool_end", id: "bad", status: "error", summary: "TypeScript failed" },
    ]);

    expect(timeline).toContainEqual({
      type: "problem",
      text: "Hit a problem while running npm run typecheck.",
      detail: "TypeScript failed",
    });
  });

  it("keeps noisy streaming deltas out of the readable timeline", () => {
    const timeline = buildActivityTimeline([
      { type: "tool_start", id: "stream", name: "Bash", args: "{\"command\":" },
      { type: "tool_delta", id: "stream", content: "\"rg -n TokenUsage frontend\"" },
      { type: "tool_end", id: "stream", status: "success", summary: "12 matches" },
    ]);

    expect(JSON.stringify(timeline)).not.toContain("tool_delta");
    expect(JSON.stringify(timeline)).not.toContain("TokenUsage frontend");
    expect(timeline).toContainEqual({
      type: "summary",
      label: "Ran 1 command",
      items: [
        { label: "Ran Bash", detail: "12 matches", status: "success", tone: "run" },
      ],
    });
  });

  it("summarizes tests and patches as verification and change activity", () => {
    const timeline = buildActivityTimeline([
      { type: "patch", content: "diff --git a/frontend/src/lib/activityTimeline.ts b/frontend/src/lib/activityTimeline.ts" },
      { type: "tool_start", id: "test", name: "exec", args: "cd frontend && npm test -- --run src/lib/__tests__/activityTimeline.test.ts" },
      { type: "tool_end", id: "test", status: "success", summary: "5 tests passed" },
    ]);

    expect(timeline).toEqual([
      { type: "narration", text: "Prepared code changes." },
      {
        type: "summary",
        label: "Verified 1 check",
        items: [
          {
            label: "Ran tests",
            detail: "5 tests passed",
            status: "success",
            tone: "test",
          },
        ],
      },
    ]);
  });

  it("filters provider lifecycle noise from the user-facing timeline", () => {
    const timeline = buildActivityTimeline([
      { type: "progress", content: "Starting codex in /mnt/c/Users/colebienek/projects/nidavellir" },
      { type: "progress", content: "Provider process started" },
      { type: "progress", content: "Prompt sent to provider" },
      { type: "progress", content: "Codex session 019dd48f-dc0e-7d03-b5f7-8f15a741e003 started" },
      { type: "progress", content: "turn started" },
      { type: "progress", content: "Provider is still working (10s elapsed)" },
    ]);

    expect(timeline).toEqual([]);
  });
});
