# Home Screen Memory Widget — Technical Specification

**Version:** 1.0
**Status:** Proposed
**Date:** April 25, 2026
**Context:** Chat screen / Home dashboard widget
**Related:** Memory Quality Dashboard

---

## Overview

A compact memory health widget designed for the Chat home screen (or main dashboard). Displays at-a-glance memory system status without leaving the primary interface. Acts as a quick diagnostic and entry point to the full Memory Quality Dashboard.

**Purpose:** Surface memory health anomalies in context, not buried in a separate page.
**Placement:** Chat screen sidebar or dashboard quick-glance panel
**Interaction:** Click to navigate to full Memory Quality Dashboard

---

## Widget Placement Options

### Option A: Sidebar Panel (Secondary Panel in Chat)
- Location: Right-hand secondary panel in Chat, below Context panel
- Trigger: Add toggle in Chat top bar or sidebar menu
- Height: ~200–280px (fixed or collapsible)
- Width: 260px (matches SecPanel standard)

### Option B: Floating Card in Chat Footer
- Location: Above message input area, optional collapsible
- Height: ~120px (compact mode)
- Width: Full input area width
- Expandable to full-height panel on click

### Option C: Dashboard Grid Widget
- Location: Dedicated home/dashboard screen (future)
- Height: 220px
- Width: 1/3 grid column or full-width
- Part of larger dashboard with other system metrics

**Recommended: Option A** (integrates cleanly with existing Chat UI without disrupting message flow)

---

## Compact View (Default)

**Size:** 260×220px
**Display:** Always visible or toggled on/off

### Structure

```
┌─────────────────────────────┐
│ ⚡ Memory Health      [↗]    │  ← Header (refresh icon optional)
├─────────────────────────────┤
│ Status: ● HEALTHY           │  ← Overall status badge
│                             │
│ Active: 847 | 24h: 342      │  ← Key metrics (2-line)
│ Issues: 3 | Stale: 67       │
│                             │
│ ⚠ 8 Extraction Failures     │  ← Alert (if any)
│ ⚠ 34 Low Confidence         │
│                             │
│ [View Full Dashboard →]     │  ← CTA button
└─────────────────────────────┘
```

### Layout Details

**Header (36px):**
- Icon: ⚡ or 🧠 (monospace or SVG, 12px)
- Title: "Memory Health" (12px, bold, T0)
- Right: Refresh icon (optional, 14px, T1, clickable)
- Padding: 10px 14px
- Border-bottom: 1px BD

**Body (184px):**
- Padding: 12px 14px
- Line height: 1.8
- Background: BG1

**Status Row (20px):**
- "Status: " (10px, T1) + Badge
- Badge: Dot + label (e.g., "● HEALTHY")
- Green dot if no critical issues; yellow if warnings; red if failures

**Metrics Row (20px):**
- Two metrics per line, separated by " | "
- Font: 11px, monospace
- Color: T0 for values, T1 for labels
- Example: `Active: 847 | 24h: 342`

**Metrics Row 2 (20px):**
- `Issues: X | Stale: Y`
- Color-code counts if >0 (issues in red, stale in yellow)

**Alerts (variable, up to 40px):**
- Show up to 2 critical alerts
- Format: `⚠ [Count] [Issue Type]`
- Colors: RED for failures, YEL for warnings
- Font: 10px
- Only render if count > 0

**CTA Button (32px):**
- Style: Secondary button (BG2 background, BD border)
- Text: "View Full Dashboard →" or "Inspect Memory →"
- Font: 11px, T0
- Padding: 8px 12px
- Click action: Navigate to `/memory-quality`
- Hover: Brightens to match button hover rules

---

## Expanded View (Optional)

**Size:** 260×380px (or full-height)
**Trigger:** Click header to expand OR dedicated toggle

### Additional Sections (Collapsed/Expanded)

Below compact view, add collapsible sections:

1. **Recent Issues (80px)**
   - Header: "Recent Issues" (collapsed: chevron →, expanded: chevron ↓)
   - Content (when expanded):
     - List of last 3 issues (3 lines × 3 items max)
     - Format: `[Time] [Type] [Count]` (monospace, 9px)
     - Example: `14:32 Duplicate ×3`

2. **Trending (60px)**
   - Header: "24h Trend" (collapsed)
   - Content (when expanded):
     - Tiny sparkline or bar chart (ASCII style or SVG)
     - Shows injection rate, failures, stale count trend
     - Format: Simple bars (▁▂▃▄▅▆▇█) or dots
     - Time markers: 6am, 12pm, 6pm, now

---

## Data Model

### Summary Object
```typescript
{
  status: 'healthy' | 'warning' | 'critical',  // Overall health
  totalActive: number,
  injected24h: number,
  issueCount: number,                          // High-priority issues
  staleCount: number,
  extractionFailures: number,
  lowConfidenceCount: number,
  recentAlerts: [                              // Last 2–3 alerts
    { time: string, type: string, count: number },
  ],
  trend24h: {                                  // Optional, for expanded view
    injections: number[],                      // Hourly buckets
    failures: number[],
    staleGrowth: number[],
  },
}
```

### Status Calculation Rules
- **HEALTHY:** No failures, <10 low-confidence, <5% stale
- **WARNING:** 1–3 failures OR >10 low-confidence OR >5% stale
- **CRITICAL:** >3 failures OR >20 low-confidence OR >20% stale

---

## Styling

### Colors
Same as Memory Quality Dashboard:
- **Status dot:** GRN (healthy), YEL (warning), RED (critical)
- **Alert text:** RED or YEL
- **Count highlights:** RED for failures, YEL for warnings
- **Text:** T0 (primary), T1 (secondary)
- **Background:** BG1 (matching sidebar panels)
- **Border:** BD (matching sidebar panels)

### Typography
- **Title:** 12px, bold, T0
- **Metrics:** 11px, monospace, T0/T1
- **Alerts:** 10px, T0 or color-coded
- **Button text:** 11px, T0
- **Recent issues (expanded):** 9px, monospace, T1

### Spacing
- **Padding:** 10px 14px (header), 12px 14px (body)
- **Line gap:** 8px between sections
- **Button margin:** 12px 0 0 0

---

## Interactions

### Compact View
- **Click "View Full Dashboard →":** Navigate to `/memory-quality`
- **Click header (if expandable):** Toggle expanded/compact
- **Hover button:** Brightens (standard button hover)
- **Hover metrics:** No special effect (informational only)

### Expanded View
- **Click section headers (Recent Issues, Trending):** Toggle collapse/expand
- **Click anywhere in widget to collapse back:** No (only explicit close or toggle)
- **Scroll if content overflows:** Yes, within widget bounds

### Refresh
- **Auto-refresh:** Optional, every 30–60 seconds (configurable)
- **Manual refresh:** Click ↻ icon in header (if present)

---

## Data Fetching

### Endpoint
`GET /api/memory/quality/summary`

**Response:**
```json
{
  "status": "warning",
  "totalActive": 847,
  "injected24h": 342,
  "issueCount": 3,
  "staleCount": 67,
  "extractionFailures": 8,
  "lowConfidenceCount": 34,
  "recentAlerts": [
    { "time": "14:32", "type": "Extraction Failure", "count": 3 },
    { "time": "14:21", "type": "Low Confidence", "count": 5 }
  ],
  "trend24h": {
    "injections": [45, 52, 48, 55, 60, 58, 62, 65, ...],
    "failures": [0, 0, 1, 0, 0, 2, 1, 3, ...],
    "staleGrowth": [2, 2, 3, 3, 4, 4, 5, 6, ...]
  }
}
```

### Fetch Timing
- **On mount:** Load widget data once
- **Auto-refresh (optional):** Every 30–60 seconds
- **Manual refresh:** On ↻ click (resets timer)
- **Error handling:** Show "Unable to load memory stats" message in place of widget

---

## Alert Priority

**Critical (Red):**
- Extraction failures > 5 per hour
- Low confidence memories > 20% of total

**Warning (Yellow):**
- Extraction failures 1–5 per hour
- Low confidence 10–20% of total
- Stale memories > 5% of total
- Duplicate candidates > 3 groups

**Info (Green):**
- All metrics nominal
- Status: "HEALTHY"

---

## Integration with Chat Screen

### Current Chat Layout
```
┌─────────────────────────┬──────────────────────────┐
│ Thread List (SecPanel)  │ Messages                 │
│ [active thread]         │ [chat messages]          │
│                         │                          │
│                         │ [input area]             │
├─────────────────────────┴──────────────────────────┤
                                          (Context Panel appears right)
```

### With Memory Widget (Option A)
```
┌─────────────────────────┬──────────────────────────┬──────────────┐
│ Thread List (SecPanel)  │ Messages                 │ Context      │
│ [active thread]         │ [chat messages]          │ [files/etc]  │
│                         │                          │              │
│                         │ [input area]             │ ─────────── │
│                         │                          │ Memory      │
│                         │                          │ Health      │
│                         │                          │ [widget]    │
└─────────────────────────┴──────────────────────────┴──────────────┘
```

**Implementation:**
- Add Memory widget to right-side panel stack (after Context)
- Toggle: Add memory icon/toggle to Chat top bar (next to Context toggle)
- State: `[memoryPanelOpen, setMemoryPanelOpen]`
- Display: Conditional `{memoryPanelOpen && <MemoryHealthWidget />}`

---

## Component Code Structure

### React Component: `MemoryHealthWidget()`

```jsx
function MemoryHealthWidget() {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // 60s auto-refresh
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/memory/quality/summary');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (error) return <div>Unable to load memory stats</div>;
  if (loading) return <div>Loading…</div>;
  if (!data) return null;

  const statusColor = {
    healthy: GRN,
    warning: YEL,
    critical: RED,
  }[data.status];

  return (
    <div style={{
      width: 260,
      background: BG1,
      border: `1px solid ${BD}`,
      borderRadius: 8,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${BD}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T0 }}>
          ⚡ Memory Health
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span
            onClick={fetchData}
            style={{
              fontSize: 14,
              color: T1,
              cursor: 'pointer',
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
            }}
          >
            {expanded ? '↑' : '↓'}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Status */}
        <div style={{ fontSize: 11, color: T1 }}>
          Status:{' '}
          <span style={{ color: statusColor, fontWeight: 600 }}>
            ● {data.status.toUpperCase()}
          </span>
        </div>

        {/* Metrics */}
        <div style={{ fontSize: 11, color: T0, fontFamily: MONO }}>
          Active: {data.totalActive} | 24h: {data.injected24h}
        </div>
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
          <div style={{ fontSize: 10, color: RED }}>
            ⚠ {data.extractionFailures} Extraction Failures
          </div>
        )}
        {data.lowConfidenceCount > 0 && (
          <div style={{ fontSize: 10, color: YEL }}>
            ⚠ {data.lowConfidenceCount} Low Confidence
          </div>
        )}

        {/* CTA */}
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
          }}
        >
          Inspect Dashboard →
        </button>
      </div>

      {/* Expanded sections */}
      {expanded && (
        <>
          {/* Recent Issues */}
          <div style={{ borderTop: `1px solid ${BD}`, padding: '12px 14px' }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: T1,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Recent Issues
            </div>
            {data.recentAlerts.map((alert, i) => (
              <div key={i} style={{ fontSize: 9, color: T1, fontFamily: MONO, marginBottom: 4 }}>
                {alert.time} {alert.type} ×{alert.count}
              </div>
            ))}
          </div>

          {/* Trending */}
          {data.trend24h && (
            <div style={{ borderTop: `1px solid ${BD}`, padding: '12px 14px' }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: T1,
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                24h Trend
              </div>
              <div style={{ fontSize: 9, color: T1, fontFamily: MONO }}>
                Injections: {renderSparkline(data.trend24h.injections)}
              </div>
              <div style={{ fontSize: 9, color: T1, fontFamily: MONO }}>
                Failures: {renderSparkline(data.trend24h.failures)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Helper: simple ASCII sparkline
function renderSparkline(values) {
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values);
  if (max === 0) return '▁▁▁▁▁▁▁▁';
  return values
    .slice(-8)
    .map(v => bars[Math.round((v / max) * (bars.length - 1))])
    .join('');
}
```

---

## Styling Token Usage

```javascript
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
```

---

## Future Enhancements

1. **Customizable metrics:** Let users choose which metrics to display
2. **Anomaly detection:** Highlight unusual patterns (spikes, drops)
3. **Predictive alerts:** "Memory capacity at 87%, estimated full in 4 days"
4. **Comparison view:** Trend vs. previous week/month
5. **One-click actions:** "Cleanup stale" button (if permissions allow)
6. **Chart library:** Replace sparklines with Chart.js or similar for detailed trending
7. **Notifications:** Browser/system notifications for critical alerts
8. **Mobile view:** Collapse widget to icon + badge on small screens
9. **Theme support:** Dark/light mode variants
10. **Accessibility:** ARIA labels, keyboard navigation

---

## Testing Checklist

- [ ] Widget renders with mock data
- [ ] Status badge color matches status (GRN/YEL/RED)
- [ ] All metrics display correctly
- [ ] Alerts render only when count > 0
- [ ] "Inspect Dashboard →" button navigates to `/memory-quality`
- [ ] Refresh button (↻) refetches data
- [ ] Expand/collapse toggle works
- [ ] Expanded sections render correctly
- [ ] Auto-refresh happens every 60s (if enabled)
- [ ] Error state shows gracefully
- [ ] Loading state shows while fetching
- [ ] Numbers are formatted correctly (no decimals for counts)
- [ ] Monospace font renders clearly
- [ ] Widget fits in 260px width
- [ ] Scrolls if content overflows in expanded mode
- [ ] Hover states work on button and interactive elements

---

**End of Specification**
