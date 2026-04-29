// ─── MEMORY HEALTH WIDGET ────────────────────────────────────────────────────
// Component: MemoryHealthWidget
// For: Chat screen right sidebar / home dashboard
// Purpose: Compact memory system health indicator with expandable details

const { useState, useEffect } = React;

// ─── TOKENS (reference from main styles) ────────────────────────────────────
const BG0 = '#0d1117';
const BG1 = '#161b22';
const BG2 = '#21262d';
const BD  = '#30363d';
const T0  = '#e6edf3';
const T1  = '#8b949e';
const GRN = '#3fb950';
const YEL = '#d29922';
const RED = '#f85149';
const MONO = "'JetBrains Mono','Fira Code',monospace";

// ─── MOCK DATA ───────────────────────────────────────────────────────────────
// Replace with API calls to /api/memory/quality/summary

const MOCK_SUMMARY = {
  status: 'warning',
  totalActive: 847,
  injected24h: 342,
  issueCount: 3,
  staleCount: 67,
  extractionFailures: 8,
  lowConfidenceCount: 34,
  recentAlerts: [
    { time: '14:32', type: 'Extraction Failure', count: 3 },
    { time: '14:21', type: 'Low Confidence', count: 5 },
  ],
  trend24h: {
    injections: [45, 52, 48, 55, 60, 58, 62, 65, 68, 70, 72, 69],
    failures: [0, 0, 1, 0, 0, 2, 1, 3, 2, 1, 0, 2],
    staleGrowth: [2, 2, 3, 3, 4, 4, 5, 6, 7, 7, 8, 9],
  },
};

// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────

function renderSparkline(values) {
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values);
  if (max === 0) return '▁▁▁▁▁▁▁▁';
  return values
    .slice(-8)
    .map(v => bars[Math.round((v / max) * (bars.length - 1))])
    .join('');
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

function MemoryHealthWidget() {
  const [data, setData] = useState(MOCK_SUMMARY);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Replace with actual API call:
      // const res = await fetch('/api/memory/quality/summary');
      // const json = await res.json();
      // setData(json);

      // For now, simulate async fetch
      await new Promise(resolve => setTimeout(resolve, 500));
      setData(MOCK_SUMMARY);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Auto-refresh every 60 seconds (optional)
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div style={{
        width: 260,
        background: BG1,
        border: `1px solid ${BD}`,
        borderRadius: 8,
        padding: '12px 14px',
        fontSize: 11,
        color: RED,
      }}>
        Unable to load memory stats
      </div>
    );
  }

  if (!data) return null;

  const statusColor = {
    healthy: GRN,
    warning: YEL,
    critical: RED,
  }[data.status] || T1;

  return (
    <div style={{
      width: 260,
      background: BG1,
      border: `1px solid ${BD}`,
      borderRadius: 8,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${BD}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T0 }}>
          ⚡ Memory Health
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span
            onClick={fetchData}
            style={{
              fontSize: 14,
              color: loading ? `${T1}88` : T1,
              cursor: loading ? 'wait' : 'pointer',
              transition: 'color 0.2s',
              opacity: loading ? 0.5 : 1,
            }}
          >
            ↻
          </span>
          <span
            onClick={() => setExpanded(!expanded)}
            style={{
              fontSize: 12,
              color: T1,
              cursor: 'pointer',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            ▼
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
      }}>

        {/* Status */}
        <div style={{ fontSize: 11, color: T1 }}>
          Status:{' '}
          <span style={{ color: statusColor, fontWeight: 600 }}>
            ● {data.status.toUpperCase()}
          </span>
        </div>

        {/* Metrics line 1 */}
        <div style={{ fontSize: 11, color: T0, fontFamily: MONO }}>
          Active: {data.totalActive} | 24h: {data.injected24h}
        </div>

        {/* Metrics line 2 */}
        <div style={{ fontSize: 11, color: T0, fontFamily: MONO }}>
          <span style={{ color: data.issueCount > 0 ? RED : T0 }}>
            Issues: {data.issueCount}
          </span>
          {' | '}
          <span style={{ color: data.staleCount > 10 ? YEL : T0 }}>
            Stale: {data.staleCount}
          </span>
        </div>

        {/* Alerts */}
        {data.extractionFailures > 0 && (
          <div style={{
            fontSize: 10,
            color: RED,
            padding: '4px 8px',
            background: `${RED}12`,
            borderRadius: 3,
            border: `1px solid ${RED}22`,
          }}>
            ⚠ {data.extractionFailures} Extraction Failures
          </div>
        )}
        {data.lowConfidenceCount > 0 && (
          <div style={{
            fontSize: 10,
            color: YEL,
            padding: '4px 8px',
            background: `${YEL}12`,
            borderRadius: 3,
            border: `1px solid ${YEL}22`,
          }}>
            ⚠ {data.lowConfidenceCount} Low Confidence
          </div>
        )}

        {/* CTA Button */}
        <button
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('nid:navigate', { detail: 'memory' })
            )
          }
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: BG2,
            border: `1px solid ${BD}`,
            borderRadius: 6,
            fontSize: 11,
            color: T0,
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = BG0;
            e.currentTarget.style.borderColor = T1;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = BG2;
            e.currentTarget.style.borderColor = BD;
          }}
        >
          Inspect Dashboard →
        </button>
      </div>

      {/* Expanded sections */}
      {expanded && (
        <>
          {/* Recent Issues */}
          <div style={{
            borderTop: `1px solid ${BD}`,
            padding: '12px 14px',
            flexShrink: 0,
          }}>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              color: T1,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 8,
            }}>
              Recent Issues
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {data.recentAlerts.map((alert, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 9,
                    color: T1,
                    fontFamily: MONO,
                  }}
                >
                  {alert.time} {alert.type} ×{alert.count}
                </div>
              ))}
            </div>
          </div>

          {/* Trending */}
          {data.trend24h && (
            <div style={{
              borderTop: `1px solid ${BD}`,
              padding: '12px 14px',
              flexShrink: 0,
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                color: T1,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 8,
              }}>
                24h Trend
              </div>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                <div>
                  <div style={{ fontSize: 9, color: T1, marginBottom: 2 }}>Injections</div>
                  <div style={{
                    fontSize: 10,
                    color: GRN,
                    fontFamily: MONO,
                    letterSpacing: '2px',
                  }}>
                    {renderSparkline(data.trend24h.injections)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: T1, marginBottom: 2 }}>Failures</div>
                  <div style={{
                    fontSize: 10,
                    color: RED,
                    fontFamily: MONO,
                    letterSpacing: '2px',
                  }}>
                    {renderSparkline(data.trend24h.failures)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: T1, marginBottom: 2 }}>Stale Growth</div>
                  <div style={{
                    fontSize: 10,
                    color: YEL,
                    fontFamily: MONO,
                    letterSpacing: '2px',
                  }}>
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

// Export for use in Chat screen
window.MemoryHealthWidget = MemoryHealthWidget;
