import type { ReactNode } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { StreamingCursor } from "./StreamingCursor";
import type { StreamEvent } from "@/lib/streamTypes";

interface StreamRendererProps {
  events:     StreamEvent[];
  streaming?: boolean;
  providerId: string;
}

export function StreamRenderer({ events, streaming = false, providerId: _p }: StreamRendererProps) {
  // Accumulate consecutive text events into one markdown render to avoid
  // paragraph-break artifacts at chunk boundaries.
  const rendered: ReactNode[] = [];
  let textBuffer = "";
  let textKey    = 0;

  const flushText = () => {
    if (!textBuffer) return;
    rendered.push(<MarkdownRenderer key={`text-${textKey++}`} content={textBuffer} />);
    textBuffer = "";
  };

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    switch (event.type) {
      case "answer_delta":
      case "text":
        textBuffer += event.content;
        break;
      case "progress":
      case "tool_use":
      case "tool_result":
      case "tool_start":
      case "tool_delta":
      case "tool_end":
      case "skill_use":
      case "patch":
      case "reasoning_signal":
      case "think":
      case "diff":
        // Activity/telemetry events are revealed through MessageList's
        // AgentActivity disclosure, not in the main answer transcript.
        break;
      case "error":
        flushText();
        rendered.push(
          <p key={i} className="text-[12px] text-[#f85149] font-mono my-1">
            {event.message ?? event.content ?? "Provider error"}
          </p>
        );
        break;
      case "done":
        break;
    }
  }
  flushText();

  return (
    <div className="flex flex-col min-w-0">
      {rendered}
      {streaming && <StreamingCursor />}
    </div>
  );
}
