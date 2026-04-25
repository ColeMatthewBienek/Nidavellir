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
  return /^(\+\+\+|---|@@|[+\-] )/.test(line);
}

export class CodexStreamParser implements ProviderStreamParser {
  private _buffer    = "";
  private _diffLines: string[] = [];

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
          events.push({ type: "diff", content: this._diffLines.join("\n") });
          this._diffLines = [];
        }
        if (line.trim().length > 0) {
          events.push({ type: "text", content: line + "\n" });
        }
      }
    }

    return events;
  }

  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this._diffLines.length > 0) {
      events.push({ type: "diff", content: this._diffLines.join("\n") });
      this._diffLines = [];
    }
    if (this._buffer.trim().length > 0) {
      events.push({ type: "text", content: this._buffer });
      this._buffer = "";
    }
    events.push({ type: "done" });
    return events;
  }

  reset(): void {
    this._buffer    = "";
    this._diffLines = [];
  }
}
