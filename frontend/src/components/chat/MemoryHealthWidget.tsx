import { useState, useEffect, useCallback } from 'react';

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG0  = '#0d1117';
const BG2  = '#21262d';
const BD   = '#30363d';
const T0   = '#e6edf3';
const T1   = '#8b949e';
const GRN  = '#3fb950';
const YEL  = '#d29922';
const RED  = '#f85149';
const MONO = "'JetBrains Mono','Fira Code',monospace";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemorySummary {
  status:                  'healthy' | 'warning' | 'critical';
  active_memories:         number;
  injected_24h:            number;
  extraction_failures_24h: number;
  low_confidence_stored:   number;
  never_used:              number;
  recent_alerts:           { time: string; type: string; count: number }[];
  trend24h?: {
    injections:  number[];
    failures:    number[];
    staleGrowth: number[];
  } | null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function renderSparkline(values: number[]): string {
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values);
  if (max === 0) return '▁▁▁▁▁▁▁▁';
  return values
    .slice(-8)
    .map(v => bars[Math.round((v / max) * (bars.length - 1))])
    .join('');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MemoryHealthWidget() {
  const [data,     setData]     = useState<MemorySummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:7430/api/memory/quality/summary');
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (error) {
    return (
      <div style={{
        borderTop: `1px solid ${BD}`, padding: '12px 14px',
        fontSize: 11, color: T1,
      }}>
        Memory health unavailable
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ borderTop: `1px solid ${BD}`, padding: '12px 14px', fontSize: 11, color: T1 }}>
        Loading memory health…
      </div>
    );
  }

  if (!data) return null;

  const statusColor: Record<string, string> = { healthy: GRN, warning: YEL, critical: RED };
  const col = statusColor[data.status] ?? T1;

  return (
    <div style={{ borderTop: `1px solid ${BD}`, display: 'flex', flexDirection: 'column' }}>

      {/* Widget header */}
      <div style={{
        padding: '10px 14px', borderBottom: `1px solid ${BD}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T0 }}>⚡ Memory Health</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span
            onClick={fetchData}
            style={{ fontSize: 14, color: loading ? `${T1}66` : T1, cursor: loading ? 'wait' : 'pointer' }}
          >↻</span>
          <span
            onClick={() => setExpanded(e => !e)}
            style={{ fontSize: 12, color: T1, cursor: 'pointer' }}
          >{expanded ? '↑' : '↓'}</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, color: T1 }}>
          Status:{' '}
          <span style={{ color: col, fontWeight: 600 }}>● {data.status.toUpperCase()}</span>
        </div>

        <div style={{ fontSize: 11, color: T0, fontFamily: MONO }}>
          Active: {data.active_memories} | 24h: {data.injected_24h}
        </div>

        <div style={{ fontSize: 11, fontFamily: MONO }}>
          <span style={{ color: data.extraction_failures_24h > 0 ? RED : T0 }}>Fails: {data.extraction_failures_24h}</span>
          <span style={{ color: T1 }}>{' | '}</span>
          <span style={{ color: data.never_used > 10 ? YEL : T0 }}>Unused: {data.never_used}</span>
        </div>

        {data.extraction_failures_24h > 0 && (
          <div style={{ fontSize: 10, color: RED, padding: '4px 8px', background: `${RED}12`, borderRadius: 3, border: `1px solid ${RED}22` }}>
            ⚠ {data.extraction_failures_24h} Extraction Failures
          </div>
        )}
        {data.low_confidence_stored > 0 && (
          <div style={{ fontSize: 10, color: YEL, padding: '4px 8px', background: `${YEL}12`, borderRadius: 3, border: `1px solid ${YEL}22` }}>
            ⚠ {data.low_confidence_stored} Low Confidence
          </div>
        )}

        <button
          onClick={() => window.dispatchEvent(new CustomEvent('nid:navigate', { detail: 'memory' }))}
          style={{
            marginTop: 8, padding: '8px 12px', background: BG2, border: `1px solid ${BD}`,
            borderRadius: 6, fontSize: 11, color: T0, cursor: 'pointer', fontWeight: 500,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = BG0; e.currentTarget.style.borderColor = T1; }}
          onMouseLeave={e => { e.currentTarget.style.background = BG2; e.currentTarget.style.borderColor = BD; }}
        >
          Inspect Dashboard →
        </button>
      </div>

      {/* Expanded sections */}
      {expanded && (
        <>
          <div style={{ borderTop: `1px solid ${BD}`, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T1, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
              Recent Issues
            </div>
            {(data.recent_alerts ?? []).length === 0 ? (
              <div style={{ fontSize: 9, color: T1, fontFamily: MONO }}>No recent issues</div>
            ) : (
              (data.recent_alerts ?? []).map((alert, i) => (
                <div key={i} style={{ fontSize: 9, color: T1, fontFamily: MONO, marginBottom: 4 }}>
                  {alert.time} {alert.type} ×{alert.count}
                </div>
              ))
            )}
          </div>

          {data.trend24h && (
            <div style={{ borderTop: `1px solid ${BD}`, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T1, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                24h Trend
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 9, color: T1, marginBottom: 2 }}>Injections</div>
                  <div style={{ fontSize: 10, color: GRN, fontFamily: MONO, letterSpacing: '2px' }}>
                    {renderSparkline(data.trend24h.injections)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: T1, marginBottom: 2 }}>Failures</div>
                  <div style={{ fontSize: 10, color: RED, fontFamily: MONO, letterSpacing: '2px' }}>
                    {renderSparkline(data.trend24h.failures)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: T1, marginBottom: 2 }}>Stale Growth</div>
                  <div style={{ fontSize: 10, color: YEL, fontFamily: MONO, letterSpacing: '2px' }}>
                    {renderSparkline(data.trend24h.staleGrowth)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
