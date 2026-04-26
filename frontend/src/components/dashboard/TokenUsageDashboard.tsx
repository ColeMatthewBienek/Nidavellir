import { useState } from 'react';

interface TokenUsageData {
  model: string;
  currentTokens: number;
  usableTokens: number;
  totalLimit: number;
  reserved: number;
  accurate: boolean;
}

interface TokenUsageDashboardProps {
  data?: TokenUsageData;
  onExport?: (format: 'json' | 'csv') => void;
}

export function TokenUsageDashboard({
  data = {
    model: 'Claude Sonnet',
    currentTokens: 12847,
    usableTokens: 192000,
    totalLimit: 200000,
    reserved: 8000,
    accurate: true,
  },
  onExport,
}: TokenUsageDashboardProps) {
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  const percentage = Math.round((data.currentTokens / data.usableTokens) * 100);

  // Determine health state
  let healthState: string;
  let healthColor: string;
  if (percentage >= 85) {
    healthState = 'Blocked';
    healthColor = 'var(--red)';
  } else if (percentage >= 75) {
    healthState = 'Compaction Required';
    healthColor = '#ff6b35';
  } else if (percentage >= 65) {
    healthState = 'Prepare Compaction';
    healthColor = 'var(--yel)';
  } else if (percentage >= 50) {
    healthState = 'At Risk';
    healthColor = 'var(--yel)';
  } else {
    healthState = 'OK';
    healthColor = 'var(--grn)';
  }

  return (
    <div
      style={{
        background: 'var(--bg1)',
        border: '1px solid var(--bd)',
        borderRadius: 8,
        padding: 20,
        maxWidth: 600,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--t0)',
              margin: 0,
              marginBottom: 4,
            }}
          >
            Token Usage Dashboard
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'var(--t1)',
              margin: 0,
            }}
          >
            Real-time context consumption monitoring
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            onClick={() => onExport?.('json')}
            style={{
              padding: '6px 12px',
              background: 'var(--bg2)',
              border: '1px solid var(--bd)',
              borderRadius: 4,
              fontSize: 10,
              color: 'var(--t0)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Export JSON
          </button>
          <button
            onClick={() => onExport?.('csv')}
            style={{
              padding: '6px 12px',
              background: 'var(--bg2)',
              border: '1px solid var(--bd)',
              borderRadius: 4,
              fontSize: 10,
              color: 'var(--t0)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 20,
          borderBottom: '1px solid var(--bd)',
          paddingBottom: 12,
        }}
      >
        {(['overview', 'history'] as const).map((t) => (
          <div
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? 'var(--t0)' : 'var(--t1)',
              cursor: 'pointer',
              textTransform: 'capitalize',
              position: 'relative',
              paddingBottom: 8,
            }}
          >
            {t}
            {tab === t && (
              <div
                style={{
                  position: 'absolute',
                  bottom: -12,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: 'var(--grn)',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div>
          {/* Model Info */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 10,
                color: 'var(--t1)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 8,
                fontWeight: 600,
              }}
            >
              Active Model
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--t0)',
                fontFamily: 'monospace',
                padding: '10px 12px',
                background: 'var(--bg0)',
                borderRadius: 4,
                border: '1px solid var(--bd)',
              }}
            >
              {data.model}
            </div>
          </div>

          {/* Usage Overview */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 10,
                color: 'var(--t1)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 8,
                fontWeight: 600,
              }}
            >
              Context Usage
            </div>

            {/* Big Numbers */}
            <div
              style={{
                marginBottom: 12,
                padding: '12px',
                background: 'var(--bg0)',
                borderRadius: 4,
                border: `1px solid ${healthColor}44`,
              }}
            >
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: 'var(--t0)',
                  fontFamily: 'monospace',
                  marginBottom: 4,
                }}
              >
                {percentage}%
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--t1)',
                  fontFamily: 'monospace',
                }}
              >
                {data.currentTokens.toLocaleString()} / {data.usableTokens.toLocaleString()} tokens
              </div>
            </div>

            {/* Usage Bar */}
            <div
              style={{
                height: 8,
                background: 'var(--bd)',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${percentage}%`,
                  background: healthColor,
                  borderRadius: 4,
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>

          {/* Health State */}
          <div
            style={{
              marginBottom: 20,
              padding: '12px',
              background: `${healthColor}12`,
              borderRadius: 4,
              border: `1px solid ${healthColor}44`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: healthColor,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: healthColor,
                  textTransform: 'uppercase',
                }}
              >
                {healthState}
              </span>
            </div>
            <p
              style={{
                fontSize: 11,
                color: healthColor,
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              {percentage >= 85 &&
                'Context window is blocked. Compaction required immediately.'}
              {percentage >= 75 &&
                percentage < 85 &&
                'Context compaction is required to continue.'}
              {percentage >= 65 &&
                percentage < 75 &&
                'Prepare for context compaction. Consider removing old messages.'}
              {percentage >= 50 &&
                percentage < 65 &&
                'Context usage is at risk. Monitor closely.'}
              {percentage < 50 && 'Context usage is healthy. Continue normally.'}
            </p>
          </div>

          {/* Accuracy */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 12px',
                background: 'var(--bg0)',
                borderRadius: 4,
                border: `1px solid ${data.accurate ? 'var(--grn)44' : 'var(--red)44'}`,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: data.accurate ? 'var(--grn)' : 'var(--red)',
                  fontWeight: 600,
                }}
              >
                {data.accurate ? '✔' : '✘'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: data.accurate ? 'var(--grn)' : 'var(--red)',
                }}
              >
                {data.accurate ? 'Counts Accurate' : 'Counts Estimated'}
              </span>
            </div>
          </div>

          {/* Limits Breakdown */}
          <div
            style={{
              padding: '12px',
              background: 'var(--bg0)',
              borderRadius: 4,
              border: '1px solid var(--bd)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--t1)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 8,
                fontWeight: 600,
              }}
            >
              Limits Breakdown
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                fontSize: 11,
                color: 'var(--t1)',
                fontFamily: 'monospace',
              }}
            >
              <div>
                <div style={{ color: 'var(--t1)' }}>Total Limit</div>
                <div style={{ color: 'var(--t0)', fontWeight: 600 }}>
                  {data.totalLimit.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--t1)' }}>Reserved</div>
                <div style={{ color: 'var(--yel)', fontWeight: 600 }}>
                  {data.reserved.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--t1)' }}>Usable</div>
                <div style={{ color: 'var(--grn)', fontWeight: 600 }}>
                  {data.usableTokens.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--t1)' }}>Available</div>
                <div style={{ color: 'var(--grn)', fontWeight: 600 }}>
                  {(data.usableTokens - data.currentTokens).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div
          style={{
            padding: '20px',
            background: 'var(--bg0)',
            borderRadius: 4,
            border: '1px solid var(--bd)',
            textAlign: 'center',
            color: 'var(--t1)',
          }}
        >
          <p style={{ margin: 0, fontSize: 12 }}>
            Historical token usage data coming soon.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--t1)' }}>
            View sparklines and export historical reports.
          </p>
        </div>
      )}
    </div>
  );
}
