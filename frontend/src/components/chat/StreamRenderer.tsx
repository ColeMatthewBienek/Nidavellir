import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { StreamingCursor } from "./StreamingCursor";
import type { StreamEvent } from "@/lib/streamTypes";

interface StreamRendererProps {
  events:     StreamEvent[];
  streaming?: boolean;
  providerId: string;
}

function ToolUseBlock({ tool, args }: { tool: string; args: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 rounded border border-[#21262d] bg-[#161b22] overflow-hidden text-[11px] font-mono">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[#21262d]/60 transition-colors"
      >
        <span className="text-amber-500">◆</span>
        <span className="text-[#c9d1d9]">{tool}</span>
        <span className="text-[#484f58] text-[10px] ml-1 opacity-60">
          {args.length > 40 ? args.slice(0, 40) + "…" : args}
        </span>
        <span className="text-[#484f58] ml-auto">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="px-2.5 py-1.5 border-t border-[#21262d] text-[#8b949e] break-all whitespace-pre-wrap">
          {args || "(no args)"}
        </div>
      )}
    </div>
  );
}

function ThinkBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 rounded border border-[#21262d] bg-[#161b22] overflow-hidden text-[11px]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[#21262d]/60 transition-colors"
      >
        <span className="text-violet-400 font-mono">⟨/⟩</span>
        <span className="text-[#484f58] italic">reasoning</span>
        <span className="text-[#484f58] ml-auto text-[10px]">
          {open ? "hide" : "show"} · {content.length} chars
        </span>
      </button>
      {open && (
        <div className="px-2.5 py-2 border-t border-[#21262d] text-[11px] text-[#484f58] font-mono leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </div>
      )}
    </div>
  );
}

function DiffBlock({ content }: { content: string }) {
  return (
    <pre className="my-1.5 rounded border border-[#21262d] bg-[#161b22] px-2.5 py-2 text-[11px] font-mono overflow-x-auto whitespace-pre">
      {content.split("\n").map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith("+") && !line.startsWith("+++") ? "text-[#3fb950]" :
            line.startsWith("-") && !line.startsWith("---") ? "text-[#f85149]" :
            line.startsWith("@@")                           ? "text-[#1f6feb]" :
            "text-[#8b949e]"
          )}
        >
          {line}
        </div>
      ))}
    </pre>
  );
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
      case "text":
        textBuffer += event.content;
        break;
      case "tool_use":
        flushText();
        rendered.push(<ToolUseBlock key={i} tool={event.tool} args={event.args} />);
        break;
      case "think":
        flushText();
        rendered.push(<ThinkBlock key={i} content={event.content} />);
        break;
      case "diff":
        flushText();
        rendered.push(<DiffBlock key={i} content={event.content} />);
        break;
      case "error":
        flushText();
        rendered.push(
          <p key={i} className="text-[12px] text-[#f85149] font-mono my-1">
            {event.message}
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
