import { useEffect, useState } from "react";
import { buildActivityTimeline, type ActivityTimelineBlock, type ActivityTimelineItem } from "@/lib/activityTimeline";
import { formatDuration } from "@/lib/completionReport";
import type { StreamEvent } from "@/lib/streamTypes";

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

function openActivityPath(item: ActivityTimelineItem) {
  if (!item.path) return;
  window.dispatchEvent(new CustomEvent('nid:open-review', {
    detail: { kind: 'code', path: item.path, label: item.path, reviewScope: 'last-turn' },
  }));
}

function TimelineItem({ item }: { item: ActivityTimelineItem }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const actionable = Boolean(item.path && item.tone === 'write');
  const statusText = item.status === 'running' ? 'Running' : '';
  const hasHiddenDetail = Boolean(item.detail && !actionable);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'baseline' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--t1)', fontSize: 12, fontWeight: 400, lineHeight: 1.5 }}>
          {actionable ? (
            <button
              type="button"
              onClick={() => openActivityPath(item)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                font: 'inherit',
                textAlign: 'left',
              }}
            >
              <span>{item.label.replace(/\s+\S+$/, ' ')}</span>
              <span style={{ color: 'var(--blu)' }}>{item.detail ?? item.path}</span>
            </button>
          ) : (
            item.label
          )}
          {item.additions !== undefined && (
            <span style={{ marginLeft: 6, fontFamily: 'var(--mono)' }}>
              <span style={{ color: 'var(--grn)' }}>+{item.additions}</span>{' '}
              <span style={{ color: 'var(--red)' }}>-{item.deletions ?? 0}</span>
            </span>
          )}
          {hasHiddenDetail && (
            <button
              type="button"
              aria-label={`${detailOpen ? 'Hide' : 'Show'} details for ${item.label}`}
              onClick={() => setDetailOpen((value) => !value)}
              style={{
                marginLeft: 7,
                border: 'none',
                background: 'transparent',
                color: 'var(--t1)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11,
                fontFamily: 'var(--sans)',
              }}
            >
              {detailOpen ? 'Hide details' : 'Details'}
            </button>
          )}
        </div>
        {hasHiddenDetail && detailOpen && (
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
      {statusText && <span style={{ color: statusColor(item.status), fontSize: 10, fontFamily: 'var(--mono)' }}>{statusText}</span>}
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

export function AgentActivityTimeline({ events, streaming, startedAt }: { events: StreamEvent[]; streaming: boolean; startedAt?: Date }) {
  const blocks = buildActivityTimeline(events);
  const elapsedLabel = useElapsedLabel(startedAt, streaming);

  return (
    <div style={{ marginTop: 8, paddingTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--t1)', fontSize: 12, marginBottom: 8 }}>
        {streaming && <WorkingIndicator />}
        <span>{elapsedLabel}</span>
      </div>
      <div
        role="log"
        aria-label="Agent activity"
        style={{
          marginTop: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          paddingRight: 4,
        }}
      >
        {blocks.length === 0 ? (
          <div style={{ color: 'var(--t1)', fontSize: 12 }}>
            Thinking
          </div>
        ) : blocks.map((block, index) => (
          <TimelineBlock key={`${block.type}-${index}`} block={block} />
        ))}
      </div>
    </div>
  );
}
