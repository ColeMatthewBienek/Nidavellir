import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/store/agentStore";
import type { Message } from "@/store/agentStore";
import { createParser } from "@/lib/parsers";
import type { StreamEvent } from "@/lib/streamTypes";
import { StreamRenderer } from "./StreamRenderer";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingDots } from "./ThinkingDots";

// ── LiveAgentMessage ──────────────────────────────────────────────────────────
// Used only while message.streaming === true.
// Holds a stateful parser per message; feeds only new raw chunks incrementally.

function LiveAgentMessage({ message }: { message: Message }) {
  const selectedProvider   = useAgentStore((s) => s.selectedProvider);
  const appendStreamEvents = useAgentStore((s) => s.appendStreamEvents);

  const parserRef    = useRef(createParser(selectedProvider));
  const processedRef = useRef(0);

  // Feed new raw chunks to parser — watches length (primitive) not array identity
  useEffect(() => {
    const chunks    = message.rawChunks;
    const newChunks = chunks.slice(processedRef.current);
    if (newChunks.length === 0) return;

    const events: StreamEvent[] = [];
    for (const chunk of newChunks) {
      events.push(...parserRef.current.feed(chunk));
    }
    processedRef.current = chunks.length;

    if (events.length > 0) {
      appendStreamEvents(events);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.rawChunks.length, appendStreamEvents]);

  // Flush parser when streaming ends
  useEffect(() => {
    if (!message.streaming) {
      const flushed = parserRef.current.flush();
      if (flushed.length > 0) {
        appendStreamEvents(flushed);
      }
      parserRef.current.reset();
    }
  }, [message.streaming, appendStreamEvents]);

  return (
    <StreamRenderer
      events={message.events}
      streaming={message.streaming}
      providerId={selectedProvider}
    />
  );
}

// ── CompletedAgentMessage ─────────────────────────────────────────────────────
// Used after message.streaming === false.

function CompletedAgentMessage({ message }: { message: Message }) {
  const selectedProvider = useAgentStore((s) => s.selectedProvider);

  if (message.events.length > 0) {
    return (
      <StreamRenderer
        events={message.events}
        streaming={false}
        providerId={selectedProvider}
      />
    );
  }

  // Fallback for messages with content but no events (historical / error-injected)
  return <MarkdownRenderer content={message.content} />;
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end group">
        <div className="relative max-w-[65%]">
          <div className="px-3.5 py-2.5 rounded-[12px_12px_4px_12px] bg-[#1f6feb]/10 border border-[#1f6feb]/20 text-[13px] text-[#e6edf3] leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(message.content)}
            className="absolute -bottom-5 right-0 opacity-0 group-hover:opacity-100 transition-opacity
                       text-[10px] text-[#484f58] hover:text-[#8b949e] font-mono flex items-center gap-1"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            copy
          </button>
        </div>
      </div>
    );
  }

  // Agent message
  const isEmpty = !message.content && message.events.length === 0;

  return (
    <div className="agent-output flex justify-start gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-[#1f6feb]/10 border border-[#1f6feb]/20 flex items-center justify-center text-[12px] text-[#3fb950] flex-shrink-0 mt-0.5">
        ⬡
      </div>
      <div className="flex flex-col gap-2 max-w-[75%] min-w-0">
        {isEmpty ? (
          <ThinkingDots />
        ) : message.streaming ? (
          <LiveAgentMessage message={message} />
        ) : (
          <CompletedAgentMessage message={message} />
        )}
      </div>
    </div>
  );
}

// ── MessageList ───────────────────────────────────────────────────────────────

export function MessageList() {
  const messages = useAgentStore((s) => s.messages);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const pinnedRef    = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isPinned = distFromBottom < 80;
    pinnedRef.current = isPinned;
    setShowJump(!isPinned);
  }, []);

  // Auto-scroll when messages change (new chunks update message refs) and pinned to bottom.
  // "instant" not "smooth" during streaming — smooth causes visible lag on rapid chunk arrival.
  useEffect(() => {
    if (!pinnedRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    setShowJump(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#484f58] text-sm">
        Start a conversation with the agent.
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} className="h-px" />
      </div>

      {showJump && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full
                     bg-[#161b22] border border-[#30363d] text-[11px] text-[#8b949e]
                     hover:text-[#e6edf3] hover:border-[#484f58] transition-all shadow-lg"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12l7 7 7-7"/>
          </svg>
          Jump to bottom
        </button>
      )}
    </div>
  );
}
