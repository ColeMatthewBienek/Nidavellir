import { useState, useEffect, useCallback } from 'react';

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG0  = '#0d1117';
const BG1  = '#161b22';
const BG2  = '#21262d';
const BD   = '#30363d';
const T0   = '#e6edf3';
const T1   = '#8b949e';
const GRN  = '#3fb950';
const YEL  = '#d29922';
const RED  = '#f85149';
const MONO = "'JetBrains Mono','Fira Code',monospace";

const API = 'http://localhost:7430/api/memory';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary {
  status:                  'healthy' | 'warning' | 'critical';
  active_memories:         number;
  total_memories:          number;
  injected_24h:            number;
  extraction_failures_24h: number;
  dedup_rejections_24h:    number;
  low_confidence_stored:   number;
  never_used:              number;
  superseded:              number;
  fallback_events_24h:     number;
  last_updated:            string;
}

interface MemItem {
  id: string;
  content: string;
  category?: string;
  memory_type?: string;
  confidence?: number;
  importance?: number;
  use_count?: number;
  created_at?: string;
  last_used?: string | null;
  age_days?: number;
  days_since_last_used?: number | null;
  scope_type?: string;
  scope_id?: string | null;
  repo_id?: string | null;
  source_excerpt?: string | null;
}

interface DupGroup {
  winner_id:      string;
  winner_content: string;
  loser_ids:      string[];
  loser_contents: string[];
  match_type:     string;
  similarity:     number;
  scope:          Record<string, unknown>;
  reason:         string;
}

interface MemEvent {
  id:            string;
  memory_id?:    string | null;
  event_subject: string;
  event_type:    string;
  session_id?:   string | null;
  payload?:      Record<string, unknown> | null;
  created_at:    string;
}

interface ScoredItem extends MemItem {
  score:           number;
  relevance_score: number | null;
  reason:          string;
}

type DetailType =
  | { type: 'duplicate';   data: DupGroup }
  | { type: 'stale';       data: MemItem }
  | { type: 'lowconf';     data: MemItem }
  | { type: 'neverused';   data: MemItem }
  | { type: 'frequent';    data: MemItem }
  | { type: 'topscored';   data: ScoredItem }
  | { type: 'event';       data: MemEvent };

type ConsolidateState = 'idle' | 'previewing' | 'applying';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '--:--';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return '--:--'; }
}

function fmtPct(v?: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value, color, sub }: {
  label: string; value: number | string; color: 'red' | 'yellow' | 'green' | 'neutral'; sub?: string;
}) {
  const col = { red: RED, yellow: YEL, green: GRN, neutral: T1 }[color];
  return (
    <div style={{
      flex: '0 0 calc(25% - 10px)', minWidth: 140,
      background: BG1, border: `1px solid ${BD}`, borderRadius: 8,
      padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: col, fontFamily: MONO }}>{value}</div>
      <div style={{ fontSize: 11, color: T1, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: `${col}99` }}>{sub}</div>}
    </div>
  );
}

function SimilarityBadge({ score }: { score: number }) {
  const col = score > 0.9 ? RED : score > 0.85 ? YEL : GRN;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: col, fontFamily: MONO,
      background: `${col}12`, border: `1px solid ${col}33`,
      padding: '2px 8px', borderRadius: 3,
    }}>{(score * 100).toFixed(0)}%</span>
  );
}

function HoverRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      style={{ padding: '10px 14px', borderBottom: `1px solid ${BD}22`, cursor: 'pointer', background: 'transparent' }}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.background = BG2)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >{children}</div>
  );
}

function SectionHeader({ dot, title }: { dot: string; title: string }) {
  return (
    <div style={{
      padding: '12px 14px', background: BG1, borderBottom: `1px solid ${BD}`,
      fontSize: 12, fontWeight: 600, color: T0, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: dot, flexShrink: 0, display: 'inline-block' }} />
      {title}
    </div>
  );
}

function InlineError({ msg }: { msg: string }) {
  return <div style={{ padding: '10px 14px', fontSize: 11, color: RED }}>⚠ {msg}</div>;
}

function EmptyRow({ msg }: { msg: string }) {
  return <div style={{ padding: '10px 14px', fontSize: 11, color: T1, fontStyle: 'italic' }}>{msg}</div>;
}

function LabeledValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: T1, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      {children}
    </div>
  );
}

function QuotedBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, color: T0, background: BG2, padding: 10, borderRadius: 4,
      lineHeight: 1.5, border: `1px solid ${BD}`,
    }}>{children}</div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function MemoryScreen() {
  const [summary,      setSummary]      = useState<Summary | null>(null);
  const [summaryErr,   setSummaryErr]   = useState<string | null>(null);
  const [duplicates,   setDuplicates]   = useState<DupGroup[]>([]);
  const [dupErr,       setDupErr]       = useState<string | null>(null);
  const [stale,        setStale]        = useState<MemItem[]>([]);
  const [staleErr,     setStaleErr]     = useState<string | null>(null);
  const [lowConf,      setLowConf]      = useState<MemItem[]>([]);
  const [lowConfErr,   setLowConfErr]   = useState<string | null>(null);
  const [neverUsed,    setNeverUsed]    = useState<MemItem[]>([]);
  const [neverUsedErr, setNeverUsedErr] = useState<string | null>(null);
  const [frequent,     setFrequent]     = useState<MemItem[]>([]);
  const [frequentErr,  setFrequentErr]  = useState<string | null>(null);
  const [events,       setEvents]       = useState<MemEvent[]>([]);
  const [eventsErr,    setEventsErr]    = useState<string | null>(null);
  const [topScored,    setTopScored]    = useState<ScoredItem[]>([]);
  const [topScoredErr, setTopScoredErr] = useState<string | null>(null);

  const [selectedDetail,    setSelectedDetail]    = useState<DetailType | null>(null);
  const [consolidateState,  setConsolidateState]  = useState<ConsolidateState>('idle');
  const [consolidateResult, setConsolidateResult] = useState<{ groups_found: number; memories_affected: number } | null>(null);
  const [loading,           setLoading]           = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const settle = async <T,>(promise: Promise<T>, onOk: (v: T) => void, onErr: (e: string) => void) => {
      try { onOk(await promise); } catch (e) { onErr((e as Error).message); }
    };

    await Promise.all([
      settle(apiFetch<Summary>('/quality/summary?workflow=chat'), setSummary, setSummaryErr),
      settle(apiFetch<{ groups: DupGroup[] }>('/quality/duplicates?workflow=chat').then(r => r.groups), setDuplicates, setDupErr),
      settle(apiFetch<{ items: MemItem[] }>('/quality/stale?workflow=chat').then(r => r.items), setStale, setStaleErr),
      settle(apiFetch<{ items: MemItem[] }>('/quality/low-confidence?workflow=chat').then(r => r.items), setLowConf, setLowConfErr),
      settle(apiFetch<{ items: MemItem[] }>('/quality/never-used?workflow=chat').then(r => r.items), setNeverUsed, setNeverUsedErr),
      settle(apiFetch<{ items: MemItem[] }>('/quality/frequent?workflow=chat').then(r => r.items), setFrequent, setFrequentErr),
      settle(apiFetch<{ items: MemEvent[] }>('/quality/events?workflow=chat').then(r => r.items), setEvents, setEventsErr),
      settle(apiFetch<{ items: ScoredItem[] }>('/quality/top-scored?workflow=chat').then(r => r.items), setTopScored, setTopScoredErr),
    ]);

    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const runConsolidate = async (dryRun: boolean) => {
    try {
      const result = await fetch(`${API}/consolidate?workflow=chat&dry_run=${dryRun}`, { method: 'POST' });
      const json = await result.json();
      setConsolidateResult({ groups_found: json.groups_found, memories_affected: json.memories_affected });
      if (!dryRun) {
        setConsolidateState('idle');
        fetchAll();
      } else {
        setConsolidateState('previewing');
      }
    } catch (e) {
      setConsolidateState('idle');
    }
  };

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', background: BG0 }}>

      {/* Header */}
      <div style={{
        height: 48, padding: '0 20px', flexShrink: 0,
        borderBottom: `1px solid ${BD}`, background: BG1,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: T0 }}>Memory Quality</span>
          <span style={{ fontSize: 12, color: T1, marginLeft: 10 }}>Agent memory diagnostics and health</span>
        </div>

        {/* Consolidation controls */}
        {consolidateState === 'idle' && (
          <button
            onClick={() => runConsolidate(true)}
            style={{ padding: '6px 14px', background: BG2, border: `1px solid ${BD}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, color: T1 }}
          >Run Consolidation</button>
        )}
        {consolidateState === 'previewing' && consolidateResult && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: YEL }}>{consolidateResult.groups_found} groups · {consolidateResult.memories_affected} affected</span>
            <button
              onClick={() => runConsolidate(false)}
              style={{ padding: '6px 14px', background: `${YEL}22`, border: `1px solid ${YEL}44`, borderRadius: 6, cursor: 'pointer', fontSize: 12, color: YEL, fontWeight: 600 }}
            >Apply</button>
            <button
              onClick={() => { setConsolidateState('idle'); setConsolidateResult(null); }}
              style={{ padding: '6px 10px', background: BG2, border: `1px solid ${BD}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, color: T1 }}
            >Cancel</button>
          </div>
        )}

        <button
          onClick={fetchAll}
          disabled={loading}
          style={{ padding: '6px 14px', background: BG2, border: `1px solid ${BD}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500, color: loading ? T1 : T0 }}
        >{loading ? '…' : '↻ Refresh'}</button>
      </div>

      {/* Summary metrics */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BD}`, background: BG1, overflowX: 'auto', flexShrink: 0 }}>
        {summaryErr ? (
          <InlineError msg={`Summary unavailable: ${summaryErr}`} />
        ) : summary ? (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <MetricCard label="Total Active"         value={summary.active_memories}         color="neutral" />
            <MetricCard label="Injected (24h)"       value={summary.injected_24h}            color="neutral" />
            <MetricCard label="Extract Fails (24h)"  value={summary.extraction_failures_24h} color={summary.extraction_failures_24h > 0 ? 'red' : 'neutral'} />
            <MetricCard label="Dedup Rejections"     value={summary.dedup_rejections_24h}    color={summary.dedup_rejections_24h > 0 ? 'yellow' : 'neutral'} />
            <MetricCard label="Low Confidence"       value={summary.low_confidence_stored}   color={summary.low_confidence_stored > 0 ? 'yellow' : 'neutral'} />
            <MetricCard label="Never Used"           value={summary.never_used}              color={summary.never_used > 0 ? 'yellow' : 'neutral'} />
            <MetricCard label="Superseded"           value={summary.superseded}              color="neutral" />
          </div>
        ) : (
          <div style={{ fontSize: 11, color: T1 }}>Loading…</div>
        )}
      </div>

      {/* Main 2-column grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>

        {/* LEFT: Issues */}
        <div style={{ overflow: 'auto', borderRight: `1px solid ${BD}` }}>

          {/* Duplicate candidates */}
          <div style={{ borderBottom: `1px solid ${BD}` }}>
            <SectionHeader dot={YEL} title={`Duplicate Candidates (${duplicates.length})`} />
            {dupErr ? <InlineError msg={dupErr} /> : duplicates.length === 0 ? (
              <EmptyRow msg="No duplicate candidates found" />
            ) : duplicates.map((dup, i) => (
              <HoverRow key={i} onClick={() => setSelectedDetail({ type: 'duplicate', data: dup })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <SimilarityBadge score={dup.similarity} />
                  <span style={{ fontSize: 10, color: T1 }}>×{dup.loser_ids.length + 1}</span>
                </div>
                <div style={{ fontSize: 11, color: T0, lineHeight: 1.4, marginBottom: 4 }}>"{dup.winner_content}"</div>
                <div style={{ fontSize: 10, color: T1 }}>↔ "{dup.loser_contents[0]}"</div>
              </HoverRow>
            ))}
          </div>

          {/* Stale memories */}
          <div style={{ borderBottom: `1px solid ${BD}` }}>
            <SectionHeader dot={YEL} title={`Stale Memories (${stale.length})`} />
            {staleErr ? <InlineError msg={staleErr} /> : stale.length === 0 ? (
              <EmptyRow msg="No stale memories" />
            ) : stale.map(mem => (
              <HoverRow key={mem.id} onClick={() => setSelectedDetail({ type: 'stale', data: mem })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: T1, flexShrink: 0 }}>{mem.id.slice(0, 8)}</span>
                  <span style={{ fontSize: 11, color: T0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mem.content}</span>
                </div>
                <div style={{ fontSize: 10, color: T1, display: 'flex', gap: 12 }}>
                  <span>Age: {mem.age_days ?? '?'}d</span>
                  <span>Conf: {fmtPct(mem.confidence)}</span>
                  {mem.use_count === 0 && <span style={{ color: YEL }}>never used</span>}
                </div>
              </HoverRow>
            ))}
          </div>

          {/* Low confidence */}
          <div style={{ borderBottom: `1px solid ${BD}` }}>
            <SectionHeader dot={YEL} title={`Low Confidence (${lowConf.length})`} />
            {lowConfErr ? <InlineError msg={lowConfErr} /> : lowConf.length === 0 ? (
              <EmptyRow msg="No low-confidence memories" />
            ) : lowConf.map(mem => (
              <HoverRow key={mem.id} onClick={() => setSelectedDetail({ type: 'lowconf', data: mem })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: RED }}>{mem.id.slice(0, 8)}</span>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: T1, padding: '1px 5px', background: BG2, borderRadius: 2 }}>{mem.category ?? '—'}</span>
                  <span style={{ fontSize: 11, color: RED, fontWeight: 600, marginLeft: 'auto' }}>{fmtPct(mem.confidence)}</span>
                </div>
                <div style={{ fontSize: 10, color: T1 }}>{mem.content}</div>
              </HoverRow>
            ))}
          </div>

          {/* Never used */}
          <div>
            <SectionHeader dot={YEL} title={`Never Used (${neverUsed.length})`} />
            {neverUsedErr ? <InlineError msg={neverUsedErr} /> : neverUsed.length === 0 ? (
              <EmptyRow msg="All memories have been used" />
            ) : neverUsed.map(mem => (
              <HoverRow key={mem.id} onClick={() => setSelectedDetail({ type: 'neverused', data: mem })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: T1, flexShrink: 0 }}>{mem.id.slice(0, 8)}</span>
                  <span style={{ fontSize: 10, color: T1 }}>Created {fmtDate(mem.created_at)}</span>
                </div>
                <div style={{ fontSize: 11, color: T0 }}>{mem.content}</div>
              </HoverRow>
            ))}
          </div>
        </div>

        {/* RIGHT: Behavior */}
        <div style={{ overflow: 'auto' }}>

          {/* Top injected */}
          <div style={{ borderBottom: `1px solid ${BD}` }}>
            <SectionHeader dot={GRN} title={`Top Injected (${frequent.length})`} />
            {frequentErr ? <InlineError msg={frequentErr} /> : frequent.length === 0 ? (
              <EmptyRow msg="No memories have been injected yet" />
            ) : frequent.map(mem => (
              <HoverRow key={mem.id} onClick={() => setSelectedDetail({ type: 'frequent', data: mem })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: GRN, fontFamily: MONO }}>#{mem.use_count}</span>
                  <span style={{ fontSize: 10, color: T1 }}>Last: {fmtTime(mem.last_used)}</span>
                </div>
                <div style={{ fontSize: 11, color: T0, marginBottom: 4 }}>{mem.content}</div>
                <div style={{ display: 'flex', gap: 10, fontSize: 9, color: T1 }}>
                  <span>conf:{fmtPct(mem.confidence)}</span>
                  <span>imp:{mem.importance}</span>
                  <span>{mem.category}</span>
                </div>
              </HoverRow>
            ))}
          </div>

          {/* Top scored */}
          <div style={{ borderBottom: `1px solid ${BD}` }}>
            <SectionHeader dot={GRN} title={`Top Scored (${topScored.length})`} />
            {topScoredErr ? <InlineError msg={topScoredErr} /> : topScored.length === 0 ? (
              <EmptyRow msg="No scored memories" />
            ) : topScored.slice(0, 8).map(mem => (
              <HoverRow key={mem.id} onClick={() => setSelectedDetail({ type: 'topscored', data: mem })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: GRN, fontFamily: MONO }}>{mem.score.toFixed(2)}</span>
                  <span style={{ fontSize: 10, color: T1, fontFamily: MONO }}>{mem.reason}</span>
                </div>
                <div style={{ fontSize: 11, color: T0 }}>{mem.content}</div>
              </HoverRow>
            ))}
          </div>

          {/* Extraction failures / events */}
          <div>
            <SectionHeader dot={RED} title={`Events (${events.length})`} />
            {eventsErr ? <InlineError msg={eventsErr} /> : events.length === 0 ? (
              <EmptyRow msg="No significant events" />
            ) : events.map(evt => (
              <HoverRow key={evt.id} onClick={() => setSelectedDetail({ type: 'event', data: evt })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: T1, fontFamily: MONO }}>{fmtTime(evt.created_at)}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', background: `${RED}18`, color: RED, fontFamily: MONO, borderRadius: 2 }}>{evt.event_type}</span>
                </div>
                <div style={{ fontSize: 10, color: T1 }}>
                  {evt.payload ? JSON.stringify(evt.payload).slice(0, 80) : evt.event_subject}
                </div>
              </HoverRow>
            ))}
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selectedDetail && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 320,
          background: BG1, borderLeft: `1px solid ${BD}`, zIndex: 10,
          display: 'flex', flexDirection: 'column', boxShadow: '-2px 0 16px #00000044',
        }}>
          <div style={{
            padding: '12px 14px', borderBottom: `1px solid ${BD}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Details</span>
            <span onClick={() => setSelectedDetail(null)} style={{ cursor: 'pointer', color: T1, fontSize: 16, lineHeight: 1 }}>✕</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>

            {selectedDetail.type === 'duplicate' && (() => {
              const d = selectedDetail.data;
              return (
                <>
                  <LabeledValue label="Similarity">
                    <div style={{ fontSize: 14, fontWeight: 700, color: YEL, fontFamily: MONO }}>{(d.similarity * 100).toFixed(1)}%</div>
                  </LabeledValue>
                  <LabeledValue label="Winner"><QuotedBox>{d.winner_content}</QuotedBox></LabeledValue>
                  {d.loser_contents.map((c, i) => (
                    <LabeledValue key={i} label={`Duplicate ${i + 1}`}><QuotedBox>{c}</QuotedBox></LabeledValue>
                  ))}
                  <LabeledValue label="Match type">
                    <div style={{ fontSize: 11, color: T0, fontFamily: MONO }}>{d.match_type}</div>
                  </LabeledValue>
                </>
              );
            })()}

            {(selectedDetail.type === 'stale' || selectedDetail.type === 'lowconf' ||
              selectedDetail.type === 'neverused' || selectedDetail.type === 'frequent' ||
              selectedDetail.type === 'topscored') && (() => {
              const d = selectedDetail.data as MemItem & { score?: number; reason?: string };
              return (
                <>
                  <LabeledValue label="ID"><div style={{ fontSize: 11, color: T0, fontFamily: MONO }}>{d.id}</div></LabeledValue>
                  <LabeledValue label="Content"><QuotedBox>{d.content}</QuotedBox></LabeledValue>
                  {d.score != null && (
                    <LabeledValue label="Score">
                      <div style={{ fontSize: 14, fontWeight: 700, color: GRN, fontFamily: MONO }}>{d.score.toFixed(4)}</div>
                    </LabeledValue>
                  )}
                  {d.confidence != null && (
                    <LabeledValue label="Confidence">
                      <div style={{ fontSize: 12, color: d.confidence < 0.70 ? RED : T0, fontFamily: MONO, fontWeight: 600 }}>{fmtPct(d.confidence)}</div>
                    </LabeledValue>
                  )}
                  {d.importance != null && (
                    <LabeledValue label="Importance">
                      <div style={{ fontSize: 12, color: T0, fontFamily: MONO }}>{d.importance} / 10</div>
                    </LabeledValue>
                  )}
                  {d.category && (
                    <LabeledValue label="Category">
                      <div style={{ fontSize: 11, fontFamily: MONO, padding: '3px 7px', background: BG2, borderRadius: 3, display: 'inline-block', color: T0 }}>{d.category}</div>
                    </LabeledValue>
                  )}
                  {d.memory_type && d.memory_type !== d.category && (
                    <LabeledValue label="Type">
                      <div style={{ fontSize: 11, color: T1, fontFamily: MONO }}>{d.memory_type}</div>
                    </LabeledValue>
                  )}
                  <LabeledValue label="Scope">
                    <div style={{ fontSize: 11, color: T1, fontFamily: MONO }}>{d.scope_type ?? '—'} / {d.scope_id ?? '—'}</div>
                  </LabeledValue>
                  {d.repo_id && (
                    <LabeledValue label="Repo">
                      <div style={{ fontSize: 11, color: T1, fontFamily: MONO }}>{d.repo_id}</div>
                    </LabeledValue>
                  )}
                  <LabeledValue label="Created"><div style={{ fontSize: 11, color: T1 }}>{fmtDate(d.created_at)}</div></LabeledValue>
                  <LabeledValue label="Last used"><div style={{ fontSize: 11, color: T1 }}>{d.last_used ? fmtDate(d.last_used) : '—'}</div></LabeledValue>
                  <LabeledValue label="Use count"><div style={{ fontSize: 12, color: T0, fontFamily: MONO }}>{d.use_count ?? 0}</div></LabeledValue>
                  {selectedDetail.type === 'neverused' && (
                    <div style={{ padding: 10, background: `${YEL}12`, borderRadius: 4, border: `1px solid ${YEL}33` }}>
                      <div style={{ fontSize: 10, color: YEL, fontWeight: 600 }}>⚠ Never injected</div>
                      <div style={{ fontSize: 10, color: T1, marginTop: 4 }}>This memory has never been used by any agent. Consider reviewing or removing.</div>
                    </div>
                  )}
                  {d.source_excerpt && (
                    <LabeledValue label="Source excerpt">
                      <div style={{ fontSize: 10, color: T1, fontStyle: 'italic', lineHeight: 1.5 }}>{d.source_excerpt}</div>
                    </LabeledValue>
                  )}
                </>
              );
            })()}

            {selectedDetail.type === 'event' && (() => {
              const d = selectedDetail.data;
              return (
                <>
                  <LabeledValue label="Timestamp"><div style={{ fontSize: 11, color: T0, fontFamily: MONO }}>{fmtTime(d.created_at)}</div></LabeledValue>
                  <LabeledValue label="Event type">
                    <div style={{ fontSize: 11, color: RED, fontFamily: MONO, padding: '4px 8px', background: `${RED}12`, borderRadius: 3, display: 'inline-block', border: `1px solid ${RED}33` }}>{d.event_type}</div>
                  </LabeledValue>
                  <LabeledValue label="Subject"><div style={{ fontSize: 11, color: T1, fontFamily: MONO }}>{d.event_subject}</div></LabeledValue>
                  {d.memory_id && <LabeledValue label="Memory ID"><div style={{ fontSize: 11, color: T0, fontFamily: MONO }}>{d.memory_id}</div></LabeledValue>}
                  {d.session_id && <LabeledValue label="Session"><div style={{ fontSize: 10, color: T1, fontFamily: MONO }}>{d.session_id}</div></LabeledValue>}
                  {d.payload && (
                    <LabeledValue label="Payload"><QuotedBox><pre style={{ margin: 0, fontSize: 10, color: T1, whiteSpace: 'pre-wrap' }}>{JSON.stringify(d.payload, null, 2)}</pre></QuotedBox></LabeledValue>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
