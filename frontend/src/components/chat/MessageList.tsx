import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/store/agentStore";
import type { Message } from "@/store/agentStore";

// ── ThinkingBubble ────────────────────────────────────────────────────────────

function ThinkingBubble() {
  return (
    <div style={{ padding: '10px 20px', display: 'flex', gap: 10, marginBottom: 16 }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', background: 'var(--grnd)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
      }}>N</div>
      <div style={{ paddingTop: 5 }}>
        <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 6 }}>
          Nidavellir · thinking
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--t1)',
              display: 'inline-block',
              animation: `nidBounce 1.2s ${i * 0.2}s ease-in-out infinite`,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared code-fence renderer ────────────────────────────────────────────────

function renderParts(parts: string[]) {
  return parts.map((part, i) =>
    part.startsWith('```') ? (
      <pre key={i} style={{
        background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 6,
        padding: '10px 14px', margin: '6px 0',
        fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6,
        overflowX: 'auto', color: 'var(--t0)', whiteSpace: 'pre-wrap',
      }}>
        {part.replace(/^```\w*\n?/, '').replace(/```$/, '')}
      </pre>
    ) : (
      <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
    )
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const timestamp = message.timestamp
    ? message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  // Pre-first-chunk: empty streaming agent message → ThinkingBubble
  if (!isUser && message.content === '' && message.streaming) {
    return <ThinkingBubble />;
  }

  const parts = message.content.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{
      padding: '10px 20px',
      display: 'flex',
      gap: 10,
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      marginBottom: 16,
    }}>
      {/* Circular avatar */}
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: isUser ? 'var(--blu)' : 'var(--grnd)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: '#fff',
      }}>
        {isUser ? 'U' : 'N'}
      </div>

      {/* Content column */}
      <div style={{ maxWidth: '68%', fontSize: 13, color: 'var(--t0)', lineHeight: 1.65 }}>
        {/* Sender label + timestamp + LIVE badge */}
        <div style={{
          fontSize: 11, color: 'var(--t1)', marginBottom: 4,
          textAlign: isUser ? 'right' : 'left',
        }}>
          {isUser ? 'You' : 'Nidavellir'}
          {timestamp ? ` · ${timestamp}` : ''}
          {message.streaming && (
            <span style={{
              marginLeft: 6, color: 'var(--grn)', fontSize: 9,
              animation: 'nidBlink 1.2s step-start infinite',
            }}>● LIVE</span>
          )}
        </div>

        {/* Bubble wrapper */}
        {isUser ? (
          <div style={{
            background: '#1f6feb22',
            border: '1px solid #1f6feb33',
            borderRadius: '12px 12px 4px 12px',
            padding: '8px 12px',
          }}>
            {renderParts(parts)}
          </div>
        ) : (
          <div style={{
            background: 'var(--bg2)',
            border: '1px solid var(--bd)',
            borderRadius: '12px 12px 12px 4px',
            padding: '8px 12px',
          }}>
            {renderParts(parts)}
            {message.streaming && (
              <span style={{ color: 'var(--grn)', animation: 'nidBlink 1s step-start infinite' }}>▋</span>
            )}
          </div>
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
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#484f58', fontSize: 14,
      }}>
        Start a conversation with the agent.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ height: '100%', overflowY: 'auto', padding: '16px 0' }}
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {showJump && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute', bottom: 16, right: 16,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999,
            background: 'var(--bg1)', border: '1px solid var(--bd)',
            fontSize: 11, color: 'var(--t1)', cursor: 'pointer',
            boxShadow: '0 4px 12px #00000044',
          }}
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
