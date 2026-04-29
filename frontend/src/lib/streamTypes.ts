type ProviderTagged = { provider?: string };

export type StreamEvent =
  | ({ type: "answer_delta"; content: string } & ProviderTagged)
  | ({ type: "progress"; content: string } & ProviderTagged)
  | ({ type: "tool_start"; id: string; name: string; args: string; raw?: unknown } & ProviderTagged)
  | ({ type: "tool_delta"; id: string; content: string } & ProviderTagged)
  | ({ type: "tool_end"; id: string; status: "success" | "error" | string; summary?: string } & ProviderTagged)
  | ({ type: "skill_use"; name: string; detail?: string; raw?: unknown } & ProviderTagged)
  | ({ type: "steering_signal"; content: string } & ProviderTagged)
  | ({ type: "patch"; content: string } & ProviderTagged)
  | ({ type: "reasoning_signal"; content: string } & ProviderTagged)
  | ({ type: "text";     content: string } & ProviderTagged)
  | ({ type: "tool_use"; tool: string; args: string; raw?: unknown } & ProviderTagged)
  | ({ type: "tool_result"; content: string } & ProviderTagged)
  | ({ type: "think";    content: string } & ProviderTagged)
  | ({ type: "diff";     content: string } & ProviderTagged)
  | ({ type: "done" } & ProviderTagged)
  | ({ type: "error";    message?: string; content?: string } & ProviderTagged);

export interface ProviderStreamParser {
  /** Feed a raw chunk string. Returns zero or more parsed StreamEvents. */
  feed(chunk: string): StreamEvent[];

  /** Signal end of stream — flush any buffered state. */
  flush(): StreamEvent[];

  /** Reset internal state for a new session. */
  reset(): void;
}
