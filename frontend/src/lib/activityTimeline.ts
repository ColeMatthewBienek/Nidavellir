import type { StreamEvent } from "@/lib/streamTypes";
import { parseDiffFiles } from "@/lib/completionReport";

export type ActivityTone = "read" | "search" | "test" | "write" | "run";
export type ActivityStatus = "running" | "success" | "error" | string;

export interface ActivityTimelineItem {
  label: string;
  detail?: string;
  status: ActivityStatus;
  tone: ActivityTone;
  path?: string;
  additions?: number;
  deletions?: number;
}

export type ActivityTimelineBlock =
  | { type: "narration"; text: string }
  | { type: "summary"; label: string; items: ActivityTimelineItem[] }
  | { type: "steering"; text: string }
  | { type: "problem"; text: string; detail?: string };

interface ToolRecord {
  id: string;
  name: string;
  args: string;
  status: ActivityStatus;
  summary?: string;
}

const TEST_RE = /\b(npm\s+(?:test|run\s+(?:test|typecheck|build|lint))|pnpm\s+(?:test|run\s+(?:test|typecheck|build|lint))|yarn\s+(?:test|run\s+(?:test|typecheck|build|lint))|vitest|pytest|playwright|tsc|ruff|mypy)\b/i;
const SEARCH_RE = /(^|\s)(rg|grep|find)\b/i;
const READ_RE = /(^|\s)(sed|cat|nl|head|tail|less)\b/i;
const WRITE_RE = /\b(apply_patch|tee|mv|cp|rm|mkdir|touch)\b/i;
const LIFECYCLE_PROGRESS_RE = [
  /^Starting\s+\w+\s+in\s+/i,
  /^Provider process started$/i,
  /^Prompt sent to provider$/i,
  /^\w+\s+session\s+[\w-]+\s+started$/i,
  /^turn started$/i,
  /^Provider is still working\b/i,
  /^Claude usage updated$/i,
  /^Claude session (?:init|status)$/i,
];

function compactText(value: string, limit = 180): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= limit) return oneLine;
  return `${oneLine.slice(0, limit - 3)}...`;
}

function isLifecycleProgress(value: string): boolean {
  const text = value.trim();
  return LIFECYCLE_PROGRESS_RE.some((pattern) => pattern.test(text));
}

function stripShellWrapper(value: string): string {
  let command = value.trim();
  const inWorkdir = command.match(/^(.+?)\s+in\s+\/.+$/);
  if (inWorkdir) command = inWorkdir[1].trim();

  const bashMatch = command.match(/(?:^|\s)(?:bash|\/bin\/bash)\s+-lc\s+(['"])([\s\S]*)\1$/);
  if (bashMatch) return bashMatch[2].trim();
  return command;
}

function parseToolCommand(name: string, args: string): string {
  const trimmed = args.trim();
  if (!trimmed) return name;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const command = parsed.command;
    const path = parsed.path ?? parsed.file_path;
    if (typeof command === "string") return stripShellWrapper(command);
    if (typeof path === "string") return path;
  } catch {
    // Providers often stream partial JSON for tool args.
  }
  return stripShellWrapper(trimmed);
}

function classifyCommand(command: string): ActivityTone {
  if (TEST_RE.test(command)) return "test";
  if (SEARCH_RE.test(command)) return "search";
  if (READ_RE.test(command)) return "read";
  if (WRITE_RE.test(command)) return "write";
  return "run";
}

function lastPath(command: string): string | null {
  const matches = [...command.matchAll(/(?:^|\s)([./~\w:-][^\s'"]+\.[A-Za-z0-9_+-]+)(?=\s|$|['"])/g)];
  const value = matches.at(-1)?.[1];
  return value ?? null;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
}

function searchLabel(command: string): string {
  const rgMatch = command.match(/\brg\s+(?:-[^\s]+\s+)*(['"])(.*?)\1/);
  if (rgMatch?.[2]) return `Searched for "${rgMatch[2]}"`;
  const bare = command.match(/\b(?:rg|grep)\s+(?:-[^\s]+\s+)*([^\s]+)/);
  if (bare?.[1]) return `Searched for ${bare[1].replace(/^["']|["']$/g, "")}`;
  if (/\bfind\b/.test(command)) return "Listed files";
  return "Searched repo";
}

function itemFromTool(tool: ToolRecord): ActivityTimelineItem {
  const command = parseToolCommand(tool.name, tool.args);
  const tone = classifyCommand(command);
  const genericSummary = /^(success|completed|complete|ok|done|read ok)$/i.test((tool.summary ?? "").trim());
  const detail = tool.summary && !genericSummary ? compactText(tool.summary, 220) : compactText(command, 220);

  if (tone === "read") {
    const path = lastPath(command);
    return {
      label: path ? `Read ${basename(path)}` : `Read with ${tool.name}`,
      detail: path ?? detail,
      status: tool.status,
      tone,
      path: path ?? undefined,
    };
  }

  if (tone === "search") {
    return {
      label: searchLabel(command),
      detail,
      status: tool.status,
      tone,
    };
  }

  if (tone === "test") {
    return {
      label: "Ran tests",
      detail,
      status: tool.status,
      tone,
    };
  }

  if (tone === "write") {
    return {
      label: "Changed files",
      detail,
      status: tool.status,
      tone,
    };
  }

  return {
    label: `Ran ${tool.name}`,
    detail,
    status: tool.status,
    tone,
  };
}

function itemsFromPatch(content: string): ActivityTimelineItem[] {
  return parseDiffFiles(content).map((file) => ({
    label: `Edited ${basename(file.path)}`,
    detail: file.path,
    status: "success",
    tone: "write",
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function groupLabel(items: ActivityTimelineItem[]): string {
  const reads = items.filter((item) => item.tone === "read").length;
  const searches = items.filter((item) => item.tone === "search").length;
  const tests = items.filter((item) => item.tone === "test").length;
  const writes = items.filter((item) => item.tone === "write").length;
  const runs = items.filter((item) => item.tone === "run").length;

  if (tests > 0 && reads + searches + writes + runs === 0) return `Verified ${plural(tests, "check", "checks")}`;
  if (reads > 0 || searches > 0) {
    const parts = [];
    if (reads > 0) parts.push(plural(reads, "file"));
    if (searches > 0) parts.push(plural(searches, "search", "searches"));
    return `Explored ${parts.join(", ")}`;
  }
  if (writes > 0 && runs + tests === 0) return `Changed ${plural(writes, "file action")}`;
  return `Ran ${plural(items.length, "command")}`;
}

function flushTools(blocks: ActivityTimelineBlock[], tools: ToolRecord[]): void {
  const okTools = tools.filter((tool) => tool.status !== "error");
  const failedTools = tools.filter((tool) => tool.status === "error");

  const okItems = okTools.map(itemFromTool);
  const exploration = okItems.filter((item) => item.tone === "read" || item.tone === "search");
  const tests = okItems.filter((item) => item.tone === "test");
  const writes = okItems.filter((item) => item.tone === "write");
  const runs = okItems.filter((item) => item.tone === "run");

  if (exploration.length > 0) blocks.push({ type: "summary", label: groupLabel(exploration), items: exploration });
  if (writes.length > 0) blocks.push({ type: "summary", label: groupLabel(writes), items: writes });
  if (tests.length > 0) blocks.push({ type: "summary", label: groupLabel(tests), items: tests });
  if (runs.length > 0) blocks.push({ type: "summary", label: groupLabel(runs), items: runs });

  for (const tool of failedTools) {
    const command = parseToolCommand(tool.name, tool.args);
    blocks.push({
      type: "problem",
      text: `Hit a problem while running ${compactText(command, 100)}.`,
      detail: tool.summary ? compactText(tool.summary, 260) : undefined,
    });
  }
}

function flushPatchItems(blocks: ActivityTimelineBlock[], items: ActivityTimelineItem[]): void {
  if (items.length === 0) return;
  const unique = new Map<string, ActivityTimelineItem>();
  for (const item of items) {
    const key = item.path ?? item.label;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, { ...item });
      continue;
    }
    existing.additions = (existing.additions ?? 0) + (item.additions ?? 0);
    existing.deletions = (existing.deletions ?? 0) + (item.deletions ?? 0);
  }
  const merged = [...unique.values()];
  blocks.push({
    type: "summary",
    label: `Edited ${plural(merged.length, "file")}`,
    items: merged,
  });
}

export function buildActivityTimeline(events: StreamEvent[]): ActivityTimelineBlock[] {
  const blocks: ActivityTimelineBlock[] = [];
  const activeTools = new Map<string, ToolRecord>();
  const finishedTools: ToolRecord[] = [];
  const patchItems: ActivityTimelineItem[] = [];

  const flushFinished = () => {
    flushTools(blocks, finishedTools.splice(0));
    flushPatchItems(blocks, patchItems.splice(0));
  };

  for (const event of events) {
    switch (event.type) {
      case "progress": {
        flushFinished();
        const text = compactText(event.content);
        if (text && !isLifecycleProgress(text)) blocks.push({ type: "narration", text });
        break;
      }
      case "tool_start":
      case "tool_use": {
        const id = event.type === "tool_start" ? event.id : `tool-${activeTools.size + finishedTools.length + 1}`;
        activeTools.set(id, {
          id,
          name: event.type === "tool_start" ? event.name : event.tool,
          args: event.args,
          status: "running",
        });
        break;
      }
      case "tool_delta": {
        const tool = activeTools.get(event.id);
        if (tool) tool.args += event.content;
        break;
      }
      case "tool_end": {
        const tool = activeTools.get(event.id) ?? {
          id: event.id,
          name: "tool",
          args: "",
          status: "running",
        };
        activeTools.delete(event.id);
        finishedTools.push({
          ...tool,
          status: event.status,
          summary: event.summary,
        });
        break;
      }
      case "patch":
      case "diff": {
        flushFinished();
        patchItems.push(...itemsFromPatch(event.content));
        if (patchItems.length === 0) blocks.push({ type: "narration", text: "Prepared code changes." });
        break;
      }
      case "skill_use": {
        flushFinished();
        blocks.push({
          type: "narration",
          text: event.detail ? `Used ${event.name}: ${compactText(event.detail)}` : `Used ${event.name}.`,
        });
        break;
      }
      case "steering_signal": {
        flushFinished();
        blocks.push({ type: "steering", text: compactText(event.content, 260) });
        break;
      }
      case "error": {
        flushFinished();
        blocks.push({
          type: "problem",
          text: event.message ?? event.content ?? "Provider reported an error.",
        });
        break;
      }
      case "answer_delta":
      case "text":
      case "tool_result":
      case "reasoning_signal":
      case "think":
      case "done":
        break;
    }
  }

  for (const tool of activeTools.values()) finishedTools.push(tool);
  flushFinished();

  return blocks;
}
