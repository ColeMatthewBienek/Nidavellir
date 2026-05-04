import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "@/store/agentStore";
import type { Message } from "@/store/agentStore";
import type { StreamEvent } from "@/lib/streamTypes";
import { sendCancel } from "@/lib/agentSocket";
import { buildCompletionReport, formatDuration, type CompletionReport } from "@/lib/completionReport";
import { formatAssistantAnswer } from "@/lib/answerFormatting";
import { parseSkillBuilderDraft, skillDraftImportPayload, type SkillBuilderDraft } from "@/lib/skillBuilderDraft";
import { MarkdownRenderer } from './MarkdownRenderer';
import { StreamRenderer } from './StreamRenderer';
import { AgentActivityTimeline } from './AgentActivityTimeline';

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

function answerTextFromMessage(message: Message): string {
  if (message.events.length === 0) return message.content;
  return message.events
    .filter((event): event is Extract<StreamEvent, { type: 'answer_delta' | 'text' }> =>
      event.type === 'answer_delta' || event.type === 'text'
    )
    .map((event) => event.content)
    .join('');
}

function SkillBuilderDraftCard({ draft }: { draft: SkillBuilderDraft }) {
  const [status, setStatus] = useState<'idle' | 'validating' | 'ready' | 'importing' | 'imported' | 'error'>('validating');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus('validating');
    fetch('http://localhost:7430/api/skills/validate/markdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skillDraftImportPayload(draft)),
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`http_${response.status}`)))
      .then((body) => {
        if (cancelled) return;
        setWarnings(Array.isArray(body.warnings) ? body.warnings : []);
        setErrors(Array.isArray(body.errors) ? body.errors : []);
        setStatus(body.ok ? 'ready' : 'error');
      })
      .catch((err) => {
        if (cancelled) return;
        setErrors([err instanceof Error ? err.message : 'validation_failed']);
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [draft]);

  const addSkill = async () => {
    setStatus('importing');
    setErrors([]);
    try {
      const response = await fetch('http://localhost:7430/api/skills/import/markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skillDraftImportPayload(draft)),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.errors?.[0] || `skill_import_${response.status}`);
      setStatus('imported');
      window.dispatchEvent(new CustomEvent('nid:skills-changed'));
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'skill_import_failed']);
      setStatus('error');
    }
  };

  return (
    <div
      aria-label="Skill builder confirmation"
      style={{
        marginTop: 12,
        border: '1px solid #1f6feb55',
        borderRadius: 7,
        background: '#1f6feb10',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ color: 'var(--t0)', fontSize: 13, fontWeight: 700 }}>Create skill</div>
          <div style={{ color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)' }}>/{draft.slug}</div>
        </div>
        <span style={{ color: status === 'error' ? 'var(--red)' : status === 'imported' ? 'var(--grn)' : 'var(--t1)', fontSize: 10, fontFamily: 'var(--mono)' }}>
          {status}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10 }}>
        <span style={{ color: 'var(--t0)' }}>{draft.name}</span>
        <span style={{ color: 'var(--t1)' }}>Scope: {draft.scope}</span>
        <span style={{ color: 'var(--t1)' }}>Activation: {draft.activationMode}</span>
        <span style={{ color: draft.enabled ? 'var(--grn)' : 'var(--t1)' }}>{draft.enabled ? 'Enabled' : 'Disabled'}</span>
        <span style={{ color: draft.showInSlash ? 'var(--blu)' : 'var(--t1)' }}>{draft.showInSlash ? 'Shown in / menu' : 'Hidden from / menu'}</span>
      </div>
      {draft.triggers.length > 0 && (
        <div style={{ color: 'var(--t1)', fontSize: 10 }}>
          Triggers: {draft.triggers.map((trigger) => `${trigger.type}:${trigger.value}`).join(', ')}
        </div>
      )}
      {warnings.map((warning) => <div key={warning} style={{ color: 'var(--yel)', fontSize: 11 }}>{warning}</div>)}
      {errors.map((error) => <div key={error} style={{ color: 'var(--red)', fontSize: 11 }}>{error}</div>)}
      <button
        type="button"
        onClick={addSkill}
        disabled={status !== 'ready'}
        style={{
          alignSelf: 'flex-start',
          padding: '7px 12px',
          borderRadius: 5,
          border: '1px solid var(--bd)',
          background: status === 'ready' ? '#3fb95016' : 'var(--bg2)',
          color: status === 'ready' ? 'var(--grn)' : 'var(--t1)',
          cursor: status === 'ready' ? 'pointer' : 'not-allowed',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {status === 'imported' ? 'Skill Added' : status === 'importing' ? 'Adding...' : 'Add Skill'}
      </button>
    </div>
  );
}

function RunningAgentTurn({ events = [], startedAt }: { events?: StreamEvent[]; startedAt?: Date }) {
  return (
    <div style={{
      width: 'min(920px, 100%)',
      margin: '0 auto 22px',
      padding: '14px 20px',
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 'min(760px, 100%)',
        maxWidth: 'min(760px, 100%)',
        fontSize: 13,
        color: 'var(--t0)',
        lineHeight: 1.6,
      }}>
        <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Nidavellir</span>
          <span style={{ color: 'var(--grn)', fontSize: 9 }}>working</span>
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
        <AgentActivityTimeline events={events} streaming={true} startedAt={startedAt} />
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
  const answerText = useMemo(() => answerTextFromMessage(message), [message.content, message.events]);
  const skillDraft = useMemo(
    () => (!isUser && !message.streaming ? parseSkillBuilderDraft(answerText) : null),
    [answerText, isUser, message.streaming],
  );
  const timestamp = message.timestamp
    ? message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  // While the turn is running, the transcript shows Codex-style live activity.
  // The final answer replaces this live work log when the provider completes.
  if (!isUser && message.streaming) {
    return <RunningAgentTurn events={message.events} startedAt={message.timestamp} />;
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
                <MarkdownRenderer content={formatAssistantAnswer(message.content)} />
                {message.streaming && (
                  <span style={{ color: 'var(--grn)', animation: 'nidBlink 1s step-start infinite' }}>▋</span>
                )}
              </>
            )}
            {skillDraft && <SkillBuilderDraftCard draft={skillDraft} />}
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
