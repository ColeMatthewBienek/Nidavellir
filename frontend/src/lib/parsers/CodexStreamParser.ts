// Codex CLI emits ANSI-colored diff-style output.
// Lines beginning with +++ / --- are diff headers.
// Lines beginning with + / - (not ++) are diff content.
// Everything else is plain text.
//
// This parser:
//   1. Strips ANSI escape sequences
//   2. Collects consecutive diff lines into a single diff event
//   3. Emits remaining content as text events

import type { ProviderStreamParser, StreamEvent } from "@/lib/streamTypes";

const ANSI_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x20-\x7e])|[\x80-\x9f]|\r(?!\n)/g;

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_RE, "");
}

function isDiffLine(line: string): boolean {
  return /^(diff --git|\+\+\+|---|@@|[+\-](?![+\-]))/.test(line);
}

const EXEC_RE = /^exec\s+(.+?)\s+in\s+(.+)$/;
const RESULT_RE = /^(succeeded|failed)\s+in\s+\d+(?:\.\d+)?(?:ms|s):?\s*(.*)$/;
const PROGRESS_RE = /^(?:I(?:'|’)m|I am)\s+.*\b(?:locating|checking|reading|running|looking|searching|opening|inspecting|reviewing|testing)\b/i;

function textEvent(line: string): StreamEvent {
  return PROGRESS_RE.test(line.trim())
    ? { type: "progress", content: line + "\n" }
    : { type: "answer_delta", content: line + "\n" };
}

export class CodexStreamParser implements ProviderStreamParser {
  private _buffer    = "";
  private _diffLines: string[] = [];
  private _toolSeq   = 0;
  private _activeToolId: string | null = null;

  feed(chunk: string): StreamEvent[] {
    const clean = stripAnsi(chunk);
    this._buffer += clean;

    const events: StreamEvent[] = [];
    const lines = this._buffer.split("\n");
    this._buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (isDiffLine(line)) {
        this._diffLines.push(line);
      } else {
        if (this._diffLines.length > 0) {
          events.push({ type: "patch", content: this._diffLines.join("\n") });
          this._diffLines = [];
        }
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          const execMatch = trimmed.match(EXEC_RE);
          if (execMatch) {
            this._toolSeq += 1;
            this._activeToolId = `codex-tool-${this._toolSeq}`;
            events.push({
              type: "tool_start",
              id: this._activeToolId,
              name: "exec",
              args: `${execMatch[1]} in ${execMatch[2]}`,
              raw: trimmed,
            });
            continue;
          }
          const resultMatch = trimmed.match(RESULT_RE);
          if (resultMatch) {
            const id = this._activeToolId ?? `codex-tool-${this._toolSeq || 1}`;
            events.push({
              type: "tool_end",
              id,
              status: resultMatch[1] === "succeeded" ? "success" : "error",
              summary: trimmed,
            });
            this._activeToolId = null;
            continue;
          }
          events.push(textEvent(line));
        }
      }
    }

    return events;
  }

  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this._diffLines.length > 0) {
      events.push({ type: "patch", content: this._diffLines.join("\n") });
      this._diffLines = [];
    }
    if (this._buffer.trim().length > 0) {
      const trimmed = this._buffer.trim();
      const execMatch = trimmed.match(EXEC_RE);
      if (execMatch) {
        this._toolSeq += 1;
        this._activeToolId = `codex-tool-${this._toolSeq}`;
        events.push({
          type: "tool_start",
          id: this._activeToolId,
          name: "exec",
          args: `${execMatch[1]} in ${execMatch[2]}`,
          raw: trimmed,
        });
      } else {
        const resultMatch = trimmed.match(RESULT_RE);
        if (resultMatch) {
          const id = this._activeToolId ?? `codex-tool-${this._toolSeq || 1}`;
          events.push({
            type: "tool_end",
            id,
            status: resultMatch[1] === "succeeded" ? "success" : "error",
            summary: trimmed,
          });
          this._activeToolId = null;
        } else {
          events.push(PROGRESS_RE.test(trimmed)
            ? { type: "progress", content: this._buffer }
            : { type: "answer_delta", content: this._buffer });
        }
      }
      this._buffer = "";
    }
    events.push({ type: "done" });
    return events;
  }

  reset(): void {
    this._buffer    = "";
    this._diffLines = [];
    this._toolSeq   = 0;
    this._activeToolId = null;
  }
}
