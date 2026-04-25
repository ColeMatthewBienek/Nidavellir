export type StreamEvent =
  | { type: "text";     content: string }
  | { type: "tool_use"; tool: string; args: string; raw: string }
  | { type: "think";    content: string }
  | { type: "diff";     content: string }
  | { type: "done" }
  | { type: "error";    message: string };

export interface ProviderStreamParser {
  /** Feed a raw chunk string. Returns zero or more parsed StreamEvents. */
  feed(chunk: string): StreamEvent[];

  /** Signal end of stream — flush any buffered state. */
  flush(): StreamEvent[];

  /** Reset internal state for a new session. */
  reset(): void;
}
