import { useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ModelRow {
  model: string;
  total_input: number;
  total_output: number;
  request_count: number;
  last_used?: string;
}

interface ProviderRow {
  provider: string;
  total_input: number;
  total_output: number;
  request_count: number;
  models: ModelRow[];
}

interface RollingWindow {
  total_input: number;
  total_output: number;
  request_count: number;
  hours: number;
}

interface DailyTotals {
  total_input: number;
  total_output: number;
  request_count: number;
}

interface Anomaly {
  type: string;
  severity: string;
  description: string;
  record_id: string;
  created_at: string;
}

interface RecentIssue {
  type: string;
  description: string;
  time: string;
}

export interface DashboardData {
  providers: ProviderRow[];
  rollingWindow: RollingWindow;
  dailyTotals: DailyTotals;
  anomalies: Anomaly[];
  recentIssues: RecentIssue[];
  generatedAt: string;
}

interface TokenUsageDashboardProps {
  data?: DashboardData;
  onExport?: (format: 'jsonl', range: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const EXPORT_RANGES = [
  { value: '1h',        label: 'Last 1 Hour' },
  { value: '6h',        label: 'Last 6 Hours' },
  { value: '24h',       label: 'Last 24 Hours' },
  { value: '7d',        label: 'Last 7 Days' },
  { value: 'all',       label: 'All Time' },
];

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  input_spike:       'Large Input Spike',
  output_spike:      'Large Output Spike',
  high_discrepancy:  'High Discrepancy',
};

const SEVERITY_COLORS: Record<string, string> = {
  high:   'var(--red)',
  medium: 'var(--yel)',
  low:    'var(--grn)',
};

function fmt(n: number): string {
  return n.toLocaleString();
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      color: 'var(--t1)',
      textTransform: 'uppercase',
      letterSpacing: '0.8px',
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

// ── Provider breakdown ─────────────────────────────────────────────────────────

function ProviderBreakdown({ providers }: { providers: ProviderRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(providers.map((p) => p.provider))
  );

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader>Provider Breakdown</SectionHeader>
      <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden' }}>
        {providers.map((p, idx) => {
          const total = p.total_input + p.total_output;
          const open  = expanded.has(p.provider);
          return (
            <div key={p.provider}>
              {idx > 0 && <div style={{ height: 1, background: 'var(--bd)' }} />}
              {/* Provider row */}
              <div
                data-testid="provider-row"
                onClick={() => toggle(p.provider)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 14px',
                  cursor: 'pointer',
                  background: 'var(--bg1)',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--t1)', marginRight: 6 }}>
                  {open ? '▾' : '▸'}
                </span>
                <span style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--t0)',
                  textTransform: 'capitalize',
                }}>
                  {p.provider}
                </span>
                <span style={{ fontSize: 11, color: 'var(--t1)', marginRight: 16 }}>
                  {p.request_count} req
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t0)', fontFamily: 'monospace' }}>
                  {fmt(total)}
                </span>
              </div>
              {/* Model sub-rows */}
              {open && p.models.map((m) => (
                <div
                  key={m.model}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '7px 14px 7px 32px',
                    background: 'var(--bg0)',
                    borderTop: '1px solid var(--bd)',
                  }}
                >
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--t1)', fontFamily: 'monospace' }}>
                    {m.model}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--t1)', marginRight: 14 }}>
                    {m.request_count} req
                  </span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--t0)', fontFamily: 'monospace' }}>
                      ↑ {fmt(m.total_input)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t1)', fontFamily: 'monospace' }}>
                      ↓ {fmt(m.total_output)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Time aggregates ────────────────────────────────────────────────────────────

function AggCard({
  title,
  input,
  output,
  requests,
}: {
  title: string;
  input: number;
  output: number;
  requests: number;
}) {
  return (
    <div style={{
      flex: 1,
      border: '1px solid var(--bd)',
      borderRadius: 6,
      padding: '12px 14px',
      background: 'var(--bg1)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t1)', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--t1)', marginBottom: 2 }}>Input</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t0)', fontFamily: 'monospace' }}>
            {fmt(input)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--t1)', marginBottom: 2 }}>Output</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t0)', fontFamily: 'monospace' }}>
            {fmt(output)}
          </div>
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <div style={{ fontSize: 10, color: 'var(--t1)', marginBottom: 2 }}>Requests</div>
          <div style={{ fontSize: 12, color: 'var(--t0)' }}>{requests}</div>
        </div>
      </div>
    </div>
  );
}

function TimeAggregates({ rolling, daily }: { rolling: RollingWindow; daily: DailyTotals }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader>Time Aggregates</SectionHeader>
      <div style={{ display: 'flex', gap: 12 }}>
        <AggCard
          title={`Last ${rolling.hours} Hours`}
          input={rolling.total_input}
          output={rolling.total_output}
          requests={rolling.request_count}
        />
        <AggCard
          title="Today (Local)"
          input={daily.total_input}
          output={daily.total_output}
          requests={daily.request_count}
        />
      </div>
    </div>
  );
}

// ── Anomalies ──────────────────────────────────────────────────────────────────

function AnomaliesSection({ anomalies }: { anomalies: Anomaly[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader>Anomalies</SectionHeader>
      {anomalies.length === 0 ? (
        <div style={{
          padding: '12px 14px',
          border: '1px solid var(--bd)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--t1)',
          background: 'var(--bg1)',
        }}>
          No anomalies detected.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {anomalies.map((a) => {
            const color = SEVERITY_COLORS[a.severity] ?? 'var(--t1)';
            const typeLabel = ANOMALY_TYPE_LABELS[a.type] ?? a.type;
            return (
              <div
                key={a.record_id}
                style={{
                  border: '1px solid var(--bd)',
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 6,
                  padding: '10px 14px',
                  background: 'var(--bg1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color }}>{typeLabel}</span>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color,
                    textTransform: 'uppercase',
                    padding: '1px 6px',
                    border: `1px solid ${color}44`,
                    borderRadius: 10,
                    background: `${color}14`,
                  }}>
                    {a.severity}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--t0)' }}>{a.description}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Recent issues ──────────────────────────────────────────────────────────────

function RecentIssuesSection({ issues }: { issues: RecentIssue[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeader>Recent Issues</SectionHeader>
      {issues.length === 0 ? (
        <div style={{
          padding: '12px 14px',
          border: '1px solid var(--bd)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--t1)',
          background: 'var(--bg1)',
        }}>
          No recent issues.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden' }}>
          {issues.map((issue, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '9px 14px',
                background: 'var(--bg1)',
                borderTop: idx > 0 ? '1px solid var(--bd)' : 'none',
              }}
            >
              <span style={{ flex: 1, fontSize: 12, color: 'var(--t0)' }}>{issue.description}</span>
              <span style={{ fontSize: 11, color: 'var(--t1)', fontFamily: 'monospace' }}>
                {issue.time}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Export section ─────────────────────────────────────────────────────────────

function ExportSection({ onExport }: { onExport?: (format: 'jsonl', range: string) => void }) {
  const [range, setRange] = useState('24h');

  return (
    <div>
      <SectionHeader>Export Usage Data</SectionHeader>
      <div style={{
        border: '1px solid var(--bd)',
        borderRadius: 6,
        padding: '14px',
        background: 'var(--bg1)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <span style={{ fontSize: 12, color: 'var(--t1)', flexShrink: 0 }}>Range:</span>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          style={{
            flex: 1,
            padding: '5px 8px',
            background: 'var(--bg0)',
            border: '1px solid var(--bd)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--t0)',
            cursor: 'pointer',
          }}
        >
          {EXPORT_RANGES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <button
          onClick={() => onExport?.('jsonl', range)}
          style={{
            padding: '6px 14px',
            background: 'var(--grn)',
            border: '1px solid var(--grn)',
            borderRadius: 5,
            fontSize: 12,
            fontWeight: 600,
            color: '#000',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          ⬇ Download JSONL
        </button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

const EMPTY_DATA: DashboardData = {
  providers:    [],
  rollingWindow: { total_input: 0, total_output: 0, request_count: 0, hours: 24 },
  dailyTotals:  { total_input: 0, total_output: 0, request_count: 0 },
  anomalies:    [],
  recentIssues: [],
  generatedAt:  new Date().toISOString(),
};

// ── Root component ─────────────────────────────────────────────────────────────

export function TokenUsageDashboard({
  data,
  onExport,
}: TokenUsageDashboardProps) {
  const d = data ?? EMPTY_DATA;

  return (
    <div style={{ maxWidth: 760, fontFamily: 'inherit' }}>
      <ProviderBreakdown providers={d.providers} />
      <TimeAggregates rolling={d.rollingWindow} daily={d.dailyTotals} />
      <AnomaliesSection anomalies={d.anomalies} />
      <RecentIssuesSection issues={d.recentIssues} />
      <ExportSection onExport={onExport} />
    </div>
  );
}
