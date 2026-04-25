// Claude Code emits rich ANSI terminal output including:
//   - Tool use markers:  "◆ ToolName(args...)" or "◇ ToolName(args...)"
//   - ANSI escape sequences throughout
//
// This parser:
//   1. Strips ANSI escape sequences
//   2. Detects tool-use lines and emits tool_use events
//   3. Emits remaining content as text events

import type { ProviderStreamParser, StreamEvent } from "@/lib/streamTypes";

const ANSI_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x20-\x7e])|[\x80-\x9f]|\r(?!\n)/g;

// Starts with ◆ ◇ or ✦ followed by a word and opening paren
const TOOL_USE_RE = /^[◆◇✦]\s+(\w+)\((.*)$/;

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_RE, "");
}

export class ClaudeStreamParser implements ProviderStreamParser {
  private _buffer = "";

  feed(chunk: string): StreamEvent[] {
    const clean = stripAnsi(chunk);
    this._buffer += clean;

    const events: StreamEvent[] = [];
    const lines = this._buffer.split("\n");
    this._buffer = lines.pop() ?? "";

    for (const line of lines) {
      const toolMatch = line.trim().match(TOOL_USE_RE);
      if (toolMatch) {
        events.push({
          type: "tool_use",
          tool: toolMatch[1],
          args: toolMatch[2].replace(/\)$/, ""),
          raw:  line,
        });
      } else if (line.trim().length > 0) {
        events.push({ type: "text", content: line + "\n" });
      }
    }

    return events;
  }

  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this._buffer.trim().length > 0) {
      const clean = stripAnsi(this._buffer);
      const toolMatch = clean.trim().match(TOOL_USE_RE);
      if (toolMatch) {
        events.push({
          type: "tool_use",
          tool: toolMatch[1],
          args: toolMatch[2].replace(/\)$/, ""),
          raw:  clean,
        });
      } else {
        events.push({ type: "text", content: clean });
      }
      this._buffer = "";
    }
    events.push({ type: "done" });
    return events;
  }

  reset(): void {
    this._buffer = "";
  }
}
