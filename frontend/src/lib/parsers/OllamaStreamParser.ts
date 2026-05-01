// Ollama/Qwen emits raw plain text — no ANSI, no tool markers.
// Qwen3-coder emits <think>...</think> blocks for chain-of-thought reasoning.
// These are captured as "think" events and rendered as collapsible sections.
//
// This parser:
//   1. Detects <think> / </think> tag boundaries across chunk boundaries
//   2. Emits think events for reasoning content
//   3. Emits text events for everything else

import type { ProviderStreamParser, StreamEvent } from "@/lib/streamTypes";

export class OllamaStreamParser implements ProviderStreamParser {
  private _buffer      = "";
  private _inThink     = false;
  private _thinkBuffer = "";

  feed(chunk: string): StreamEvent[] {
    this._buffer += chunk;
    const events: StreamEvent[] = [];

    while (this._buffer.length > 0) {
      if (!this._inThink) {
        const openIdx = this._buffer.indexOf("<think>");
        if (openIdx === -1) {
          const possibleTag = this._buffer.lastIndexOf("<");
          if (possibleTag !== -1 && possibleTag > this._buffer.length - 8) {
            const safe = this._buffer.slice(0, possibleTag);
            if (safe.length > 0) events.push({ type: "answer_delta", content: safe });
            this._buffer = this._buffer.slice(possibleTag);
            break;
          }
          if (this._buffer.length > 0) {
            events.push({ type: "answer_delta", content: this._buffer });
          }
          this._buffer = "";
          break;
        }
        if (openIdx > 0) {
          events.push({ type: "answer_delta", content: this._buffer.slice(0, openIdx) });
        }
        this._buffer = this._buffer.slice(openIdx + 7); // skip "<think>"
        this._inThink = true;
        this._thinkBuffer = "";

      } else {
        const closeIdx = this._buffer.indexOf("</think>");
        if (closeIdx === -1) {
          this._thinkBuffer += this._buffer;
          this._buffer = "";
          break;
        }
        this._thinkBuffer += this._buffer.slice(0, closeIdx);
        this._buffer = this._buffer.slice(closeIdx + 8); // skip "</think>"
        events.push({ type: "reasoning_signal", content: this._thinkBuffer.trim() });
        this._thinkBuffer = "";
        this._inThink = false;
      }
    }

    return events;
  }

  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this._inThink && this._thinkBuffer.length > 0) {
      events.push({ type: "reasoning_signal", content: this._thinkBuffer.trim() });
      this._thinkBuffer = "";
    }
    if (this._buffer.length > 0) {
      events.push({ type: "answer_delta", content: this._buffer });
      this._buffer = "";
    }
    events.push({ type: "done" });
    return events;
  }

  // fallow-ignore-next-line unused-class-member
  reset(): void {
    this._buffer      = "";
    this._inThink     = false;
    this._thinkBuffer = "";
  }
}
