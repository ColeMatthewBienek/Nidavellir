import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/store/agentStore";
import type { Message } from "@/store/agentStore";
import type { StreamEvent } from "@/lib/streamTypes";
import { sendCancel } from "@/lib/agentSocket";
import { buildCompletionReport, formatDuration, type CompletionReport } from "@/lib/completionReport";
import { buildActivityTimeline, type ActivityTimelineBlock, type ActivityTimelineItem } from "@/lib/activityTimeline";
import { MarkdownRenderer } from './MarkdownRenderer';
import { StreamRenderer } from './StreamRenderer';

// ── ThinkingBubble ────────────────────────────────────────────────────────────

function WorkingIndicator({ labelled = true }: { labelled?: boolean }) {
  return (
    <span
      aria-label={labelled ? "Agent is working" : undefined}
      aria-hidden={labelled ? undefined : true}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--grn)',
            display: 'inline-block',
            animation: `nidBounce 1.2s ${i * 0.16}s ease-in-out infinite`,
          }}
        />
      ))}
    </span>
  );
}

function useElapsedLabel(startedAt: Date | undefined, streaming: boolean): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const start = startedAt?.getTime() ?? Date.now();
  const elapsed = Math.max(0, Date.now() - start);
  const label = formatDuration(elapsed);
  return streaming ? label.replace(/^Worked/, 'Working') : label;
}

function statusColor(status: string): string {
  if (status === 'error') return 'var(--red)';
  if (status === 'running') return 'var(--yel)';
  return 'var(--grn)';
}

function toneColor(tone: ActivityTimelineItem['tone']): string {
  if (tone === 'search') return 'var(--blu)';
  if (tone === 'test') return 'var(--grn)';
  if (tone === 'write') return 'var(--yel)';
  if (tone === 'read') return '#8b949e';
  return 'var(--t1)';
}

function TimelineItem({ item }: { item: ActivityTimelineItem }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr) auto', gap: 8, alignItems: 'baseline' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: toneColor(item.tone), marginTop: 8, display: 'none' }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--t1)', fontSize: 12, fontWeight: 400 }}>{item.label}</div>
        {item.detail && (
          <div style={{
            color: 'var(--t1)',
            fontSize: 11,
            fontFamily: 'var(--mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{item.detail}</div>
        )}
      </div>
      <span style={{ color: statusColor(item.status), fontSize: 10, fontFamily: 'var(--mono)' }}>{item.status}</span>
    </div>
  );
}

function TimelineBlock({ block }: { block: ActivityTimelineBlock }) {
  if (block.type === 'steering') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-end' }}>
        <div style={{ color: 'var(--t1)', fontSize: 11 }}>↳ Steered conversation</div>
        <div style={{
          maxWidth: '70%',
          borderRadius: 12,
          background: '#30363d88',
          color: 'var(--t0)',
          padding: '8px 11px',
          fontSize: 12,
          lineHeight: 1.45,
        }}>
          {block.text}
        </div>
      </div>
    );
  }

  if (block.type === 'narration') {
    return (
      <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.55 }}>
        {block.text}
      </div>
    );
  }

  if (block.type === 'problem') {
    return (
      <div style={{
        borderLeft: '2px solid var(--red)',
        paddingLeft: 10,
        color: 'var(--t0)',
        fontSize: 12,
        lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 600 }}>{block.text}</div>
        {block.detail && <div style={{ color: 'var(--t1)', fontFamily: 'var(--mono)', marginTop: 3 }}>{block.detail}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ color: 'var(--t1)', fontSize: 12 }}>{block.label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 0 }}>
        {block.items.map((item, index) => (
          <TimelineItem key={`${block.label}-${item.label}-${index}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function AgentActivity({ events, streaming, startedAt }: { events: StreamEvent[]; streaming: boolean; startedAt?: Date }) {
  const [open, setOpen] = useState(false);
  const blocks = buildActivityTimeline(events);
  const elapsedLabel = useElapsedLabel(startedAt, streaming);
  const showLog = open || blocks.length > 0;

  return (
    <div style={{ marginTop: 12, borderTop: blocks.length > 0 ? 'none' : '1px solid var(--bd)', paddingTop: blocks.length > 0 ? 2 : 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--t1)', fontSize: 12, marginBottom: 8 }}>
        {streaming && <WorkingIndicator />}
        <span>{elapsedLabel}</span>
      </div>
      <button
        type="button"
        aria-label={open ? 'Collapse agent activity' : 'Expand agent activity'}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          border: 'none', background: 'transparent', color: 'var(--t1)',
          fontSize: 11, cursor: 'pointer', padding: 0,
        }}
      >
        <span style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>›</span>
        <span>{open ? 'Collapse' : 'Expand'}</span>
        {blocks.length > 0 && <span style={{ color: '#484f58' }}>{blocks.length}</span>}
      </button>

      {showLog && (
        <div
          role="log"
          aria-label="Agent activity"
          style={{
            marginTop: blocks.length > 0 ? 12 : 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            maxHeight: open ? 520 : 'none',
            overflowY: open ? 'auto' : 'visible',
            paddingRight: 4,
          }}
        >
          {blocks.length === 0 ? (
            <div style={{ color: 'var(--t1)', fontSize: 12, fontFamily: 'var(--mono)' }}>
              Waiting for provider activity
            </div>
          ) : blocks.map((block, index) => (
            <TimelineBlock key={`${block.type}-${index}`} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompletionReportCard({ report }: { report: CompletionReport }) {
  const fileCount = report.changedFiles.length;
  const [openDiffs, setOpenDiffs] = useState<Set<string>>(() => new Set());
  const toggleDiff = (path: string) => {
    setOpenDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  return (
    <div
      aria-label="Task completion report"
      style={{
        marginTop: 12,
        borderTop: '1px solid var(--bd)',
        paddingTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--t1)', fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}>{formatDuration(report.durationMs)}</span>
        <span style={{ color: '#484f58' }}>›</span>
      </div>

      <div style={{ color: 'var(--t0)', fontSize: 13, lineHeight: 1.55 }}>
        {report.outcome}
      </div>

      {fileCount > 0 && (
        <div style={{
          border: '1px solid var(--bd)',
          borderRadius: 7,
          background: 'var(--bg1)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 10px',
            borderBottom: '1px solid var(--bd)',
            fontSize: 12,
          }}>
            <span style={{ color: 'var(--t0)', fontWeight: 600 }}>Changed</span>
            <span style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>
              {fileCount} {fileCount === 1 ? 'file' : 'files'} changed{' '}
              <span style={{ color: 'var(--grn)' }}>+{report.totalAdditions}</span>{' '}
              <span style={{ color: 'var(--red)' }}>-{report.totalDeletions}</span>
            </span>
          </div>
          {report.changedFiles.map((file) => {
            const open = openDiffs.has(file.path);
            return (
              <div key={file.path} style={{ borderTop: '1px solid #30363d55' }}>
                <button
                  type="button"
                  aria-label={`${open ? 'Collapse' : 'Expand'} diff for ${file.path}`}
                  onClick={() => toggleDiff(file.path)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    border: 'none',
                    background: open ? '#30363d33' : 'transparent',
                    fontSize: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    color: 'var(--t0)',
                    fontFamily: 'var(--mono)',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>{file.path}</span>
                  <span style={{ fontFamily: 'var(--mono)', flexShrink: 0 }}>
                    <span style={{ color: 'var(--grn)' }}>+{file.additions}</span>{' '}
                    <span style={{ color: 'var(--red)' }}>-{file.deletions}</span>
                  </span>
                  <span style={{ color: 'var(--t1)', fontSize: 13 }}>{open ? '⌃' : '⌄'}</span>
                </button>
                {open && (
                  <pre style={{
                    margin: 0,
                    maxHeight: 280,
                    overflow: 'auto',
                    background: '#0d1117',
                    borderTop: '1px solid #30363d55',
                    padding: '8px 0',
                  }}>
                    {file.diffLines.map((line, index) => (
                      <div
                        key={`${file.path}-${index}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '44px minmax(0, 1fr)',
                          background: line.startsWith('+') ? '#23863622' : line.startsWith('-') ? '#da363322' : 'transparent',
                          borderLeft: `3px solid ${line.startsWith('+') ? 'var(--grn)' : line.startsWith('-') ? 'var(--red)' : 'transparent'}`,
                          fontFamily: 'var(--mono)',
                          fontSize: 11,
                          lineHeight: 1.6,
                          color: line.startsWith('+') ? '#aff5b4' : line.startsWith('-') ? '#ffdcd7' : 'var(--t1)',
                        }}
                      >
                        <span style={{ color: '#484f58', textAlign: 'right', paddingRight: 10, userSelect: 'none' }}>{index + 1}</span>
                        <code style={{ whiteSpace: 'pre', overflowX: 'auto', paddingRight: 10 }}>{line || ' '}</code>
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {report.verifications.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ color: 'var(--t0)', fontSize: 12, fontWeight: 600 }}>Verified</div>
          {report.verifications.map((verification, index) => (
            <div
              key={`${verification.command}-${index}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 8,
                alignItems: 'center',
                padding: '7px 9px',
                borderRadius: 6,
                background: 'var(--bg0)',
                border: '1px solid #30363d88',
                fontSize: 11,
              }}
            >
              <code style={{
                color: 'var(--t0)',
                fontFamily: 'var(--mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{verification.command}</code>
              <span style={{
                color: verification.status === 'error' ? 'var(--red)' : 'var(--grn)',
                fontFamily: 'var(--mono)',
                fontSize: 10,
              }}>{verification.status}</span>
              <span style={{
                gridColumn: '1 / -1',
                color: 'var(--t1)',
                fontFamily: 'var(--mono)',
                overflowWrap: 'anywhere',
              }}>{verification.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingBubble({ events = [], startedAt }: { events?: StreamEvent[]; startedAt?: Date }) {
  return (
    <div style={{ padding: '10px 20px', display: 'flex', gap: 10, marginBottom: 16 }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', background: 'var(--grnd)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0,
      }}>N</div>
      <div style={{ paddingTop: 5 }}>
        <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Nidavellir · working</span>
          <button
            type="button"
            aria-label="Stop agent"
            onClick={() => sendCancel()}
            style={{
              border: '1px solid #f8514955',
              borderRadius: 4,
              background: '#f8514914',
              color: '#ff7b72',
              fontSize: 10,
              padding: '1px 6px',
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
        <AgentActivity events={events} streaming={true} startedAt={startedAt} />
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
  const completionReport = !isUser ? buildCompletionReport(message) : null;
  const timestamp = message.timestamp
    ? message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  // Pre-first-chunk: empty streaming agent message → ThinkingBubble
  if (!isUser && message.content === '' && message.streaming && message.events.length === 0) {
    return <ThinkingBubble events={message.events} startedAt={message.timestamp} />;
  }

  // parts only needed for user bubble (plain text, no markdown parsing)
  const parts = isUser ? message.content.split(/(```[\s\S]*?```)/g) : [];

  return (
    <div style={{
      width: 'min(920px, 100%)',
      margin: isUser ? '0 auto 16px' : '0 auto 22px',
      padding: isUser ? '10px 20px' : '14px 20px',
      display: 'flex',
      gap: 10,
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
    }}>
      {/* Circular avatar */}
      {isUser && (
        <div style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          background: 'var(--blu)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: '#fff',
        }}>
          U
        </div>
      )}

      {/* Content column */}
      <div style={{
        width: isUser ? 'auto' : 'min(760px, 100%)',
        maxWidth: isUser ? '68%' : 'min(760px, 100%)',
        fontSize: 13,
        color: 'var(--t0)',
        lineHeight: 1.6,
      }}>
        {/* Sender label + timestamp + LIVE badge */}
        <div style={{
          fontSize: 11, color: 'var(--t1)', marginBottom: 4,
          textAlign: isUser ? 'right' : 'left',
        }}>
        {isUser ? 'You' : 'Nidavellir'}
        {isUser && timestamp ? ` · ${timestamp}` : ''}
        {message.streaming && (
          <>
            <span style={{
                marginLeft: 6, color: 'var(--grn)', fontSize: 9,
              }}>working</span>
            <button
              type="button"
              aria-label="Stop agent"
              onClick={() => sendCancel()}
              style={{
                marginLeft: 8,
                border: '1px solid #f8514955',
                borderRadius: 4,
                background: '#f8514914',
                color: '#ff7b72',
                fontSize: 10,
                padding: '1px 6px',
                cursor: 'pointer',
              }}
            >
              Stop
            </button>
          </>
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
          <div
            data-testid="agent-message-content"
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              padding: 0,
            }}
          >
            {message.events.length > 0 ? (
              <StreamRenderer events={message.events} streaming={message.streaming} providerId={useAgentStore.getState().selectedProvider} />
            ) : (
              <>
                <MarkdownRenderer content={message.content} />
                {message.streaming && (
                  <span style={{ color: 'var(--grn)', animation: 'nidBlink 1s step-start infinite' }}>▋</span>
                )}
              </>
            )}
            {!isUser && (message.streaming || message.events.length > 0) && (
              <AgentActivity events={message.events} streaming={message.streaming} startedAt={message.timestamp} />
            )}
            {completionReport && <CompletionReportCard report={completionReport} />}
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
