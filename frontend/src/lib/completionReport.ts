import type { Message } from "@/store/agentStore";
import type { StreamEvent } from "@/lib/streamTypes";

export interface CompletionReportFile {
  path: string;
  additions: number;
  deletions: number;
  diffLines: string[];
}

export interface CompletionReportVerification {
  command: string;
  status: string;
  summary: string;
}

export interface CompletionReport {
  durationMs: number | null;
  outcome: string;
  changedFiles: CompletionReportFile[];
  totalAdditions: number;
  totalDeletions: number;
  verifications: CompletionReportVerification[];
}

const VERIFY_RE = /\b(npm\s+(?:test|run\s+(?:test|typecheck|build|lint))|pnpm\s+(?:test|run\s+(?:test|typecheck|build|lint))|yarn\s+(?:test|run\s+(?:test|typecheck|build|lint))|vitest|pytest|playwright|tsc|ruff|mypy)\b/i;
const BUILD_WORD_RE = /\b(implemented|fixed|changed|updated|created|added|removed|refactored|verified|tested|patched)\b/i;

function cleanCommand(args: string): string {
  const trimmed = args.trim();
  const bashMatch = trimmed.match(/(?:^|\s)(?:bash|\/bin\/bash)\s+-lc\s+(['"])(.*?)\1/);
  if (bashMatch) return bashMatch[2];
  return trimmed.replace(/\s+in\s+\/.+$/, "").trim();
}

function addFile(files: Map<string, CompletionReportFile>, path: string): CompletionReportFile {
  const normalized = path.replace(/^["']|["']$/g, "");
  const existing = files.get(normalized);
  if (existing) return existing;
  const next = { path: normalized, additions: 0, deletions: 0, diffLines: [] };
  files.set(normalized, next);
  return next;
}

export function parseDiffFiles(content: string): CompletionReportFile[] {
  const files = new Map<string, CompletionReportFile>();
  let current: CompletionReportFile | null = null;
  for (const line of content.split("\n")) {
    const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/) ?? line.match(/^---\s+a\/(.+)$/);
    if (fileMatch && fileMatch[1] !== "/dev/null") {
      current = addFile(files, fileMatch[1]);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
    current.diffLines.push(line);
  }
  return [...files.values()];
}

function collectPatchStats(events: StreamEvent[]): CompletionReportFile[] {
  const files = new Map<string, CompletionReportFile>();
  for (const event of events) {
    if (event.type !== "patch" && event.type !== "diff") continue;
    for (const file of parseDiffFiles(event.content)) {
      const current = addFile(files, file.path);
      current.additions += file.additions;
      current.deletions += file.deletions;
      current.diffLines.push(...file.diffLines);
    }
  }
  return [...files.values()];
}

function collectVerifications(events: StreamEvent[]): CompletionReportVerification[] {
  const activeTools = new Map<string, string>();
  const verifications: CompletionReportVerification[] = [];

  for (const event of events) {
    if (event.type === "tool_start") {
      activeTools.set(event.id, cleanCommand(event.args));
      continue;
    }
    if (event.type !== "tool_end") continue;
    const command = activeTools.get(event.id);
    if (!command || !VERIFY_RE.test(command)) continue;
    verifications.push({
      command,
      status: event.status,
      summary: event.summary ?? event.status,
    });
  }

  return verifications;
}

function structuredOutcome(message: Message, changedFiles: CompletionReportFile[], verifications: CompletionReportVerification[]): string {
  const error = message.events.find((event) => event.type === "error");
  if (error && "message" in error && error.message) return `Blocked: ${error.message}`;

  if (changedFiles.length > 0 && verifications.length > 0) {
    return `Changed ${changedFiles.length} ${changedFiles.length === 1 ? "file" : "files"} and verified with ${verifications.length} ${verifications.length === 1 ? "command" : "commands"}.`;
  }
  if (changedFiles.length > 0) {
    return `Changed ${changedFiles.length} ${changedFiles.length === 1 ? "file" : "files"}.`;
  }
  if (verifications.length > 0) {
    return `Verified with ${verifications.length} ${verifications.length === 1 ? "command" : "commands"}.`;
  }
  return "Completed the build task.";
}

export function isBuildCompletion(message: Message): boolean {
  if (message.role !== "agent" || message.streaming) return false;
  const files = collectPatchStats(message.events);
  if (files.length > 0) return true;
  if (collectVerifications(message.events).length > 0 && BUILD_WORD_RE.test(message.content)) return true;
  return message.events.some((event) => {
    if (event.type === "tool_start") return VERIFY_RE.test(cleanCommand(event.args));
    if (event.type === "patch" || event.type === "diff") return true;
    return false;
  }) && BUILD_WORD_RE.test(message.content);
}

export function buildCompletionReport(message: Message): CompletionReport | null {
  if (!isBuildCompletion(message)) return null;
  const changedFiles = collectPatchStats(message.events);
  const verifications = collectVerifications(message.events);
  const totalAdditions = changedFiles.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0);
  const completedAt = message.completedAt?.getTime();
  const startedAt = message.timestamp?.getTime();

  return {
    durationMs: completedAt && startedAt ? Math.max(0, completedAt - startedAt) : null,
    outcome: structuredOutcome(message, changedFiles, verifications),
    changedFiles,
    totalAdditions,
    totalDeletions,
    verifications,
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "Worked";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `Worked for ${seconds}s`;
  return `Worked for ${minutes}m ${seconds}s`;
}
