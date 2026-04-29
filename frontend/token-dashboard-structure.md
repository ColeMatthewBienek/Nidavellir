# Token Dashboard — Structure Reference

## Entry Points

There are two entry points into token data:

| Entry point | File | Role |
|---|---|---|
| **ContextPanel** widget | `src/components/chat/ContextPanel.tsx` | Compact inline summary inside the chat sidebar |
| **TokenScreen** full dashboard | `src/screens/TokenScreen.tsx` | Full-page dashboard, reached via nav or the "Open Token Usage Dashboard →" button |

---

## 1. ContextPanel Token Widget (compact)

**File:** `src/components/chat/ContextPanel.tsx`

Lives inside the collapsible **"Token Usage"** accordion in the right-side Working Set panel. Shown only when `expanded.tokens === true`.

Data source: `useAgentStore((s) => s.contextUsage)` (Zustand store, live from backend WebSocket).

### Fields displayed
| UI element | Data field | Fallback |
|---|---|---|
| Model name | `contextUsage.model` | `'Claude Sonnet'` |
| Usage counter | `contextUsage.currentTokens / contextUsage.usableTokens` | `12847 / 192000` |
| Percentage | Computed: `round(currentTokens / usableTokens * 100)` | — |
| Progress bar | Width = percentage, color = `healthColor` | — |
| Health state badge | Derived from percentage (see thresholds below) | — |
| Accuracy indicator | `contextUsage.accurate` | `true` |
| Limits block | `contextUsage.totalLimit`, `contextUsage.usableTokens` | — |

### Health state thresholds
| Percentage | State label | Color token |
|---|---|---|
| ≥ 85% | Blocked | `--red` |
| ≥ 75% | Compaction Required | `--org` |
| ≥ 65% | Prepare Compaction | `--yel` |
| ≥ 50% | At Risk | `--yel` |
| < 50% | OK | `--grn` |

### Navigation button
At the bottom of the widget — fires a `CustomEvent('nid:navigate', { detail: 'tokens' })` to navigate to the full TokenScreen.

---

## 2. TokenScreen (full dashboard)

**File:** `src/screens/TokenScreen.tsx`

Wraps `<TokenUsageDashboard>` inside a `<TopBar title="Token Usage" />` + scrollable container.

Data source: `GET http://localhost:7430/api/tokens/dashboard` — fetched once on mount, stored in local state.

Export: triggers a browser navigation to `GET /api/tokens/export?range=<range>` (JSONL download).

---

## 3. TokenUsageDashboard component

**File:** `src/components/dashboard/TokenUsageDashboard.tsx`

Purely presentational — receives `DashboardData` as a prop and renders five sub-sections in order:

```
TokenUsageDashboard
├── ProviderBreakdown
├── TimeAggregates
│   ├── AggCard  (rolling window)
│   └── AggCard  (today local)
├── AnomaliesSection
├── RecentIssuesSection
└── ExportSection
```

### Data types

```ts
DashboardData {
  providers:     ProviderRow[]    // per-provider + per-model breakdown
  rollingWindow: RollingWindow    // last N hours totals
  dailyTotals:   DailyTotals      // today's totals
  anomalies:     Anomaly[]        // detected spikes / discrepancies
  recentIssues:  RecentIssue[]    // recent error log entries
  generatedAt:   string           // ISO timestamp
}
```

### Sub-sections

#### ProviderBreakdown
- Collapsible rows per provider (all expanded by default via `useState<Set<string>>`).
- Each provider row shows: chevron, provider name, request count, total tokens (input + output).
- Expanded provider shows model sub-rows: model name, request count, input ↑ / output ↓ split.

#### TimeAggregates
- Two `AggCard` cards side by side.
- Left: rolling window (e.g. "Last 24 Hours") from `rollingWindow`.
- Right: "Today (Local)" from `dailyTotals`.
- Each card: Input, Output, Requests displayed in a 2-column grid.

#### AnomaliesSection
- Empty state: plain "No anomalies detected." box.
- Each anomaly: left-bordered card, color-coded by severity (`--red` / `--yel` / `--grn`).
- Type labels mapped via `ANOMALY_TYPE_LABELS`: `input_spike`, `output_spike`, `high_discrepancy`.

#### RecentIssuesSection
- Empty state: plain "No recent issues." box.
- List of issues: description + timestamp, separated by dividers.

#### ExportSection
- Range dropdown: 1h / 6h / 24h / 7d / All Time (default: 24h).
- "⬇ Download JSONL" button: calls `onExport('jsonl', range)` prop.

---

## API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/tokens/dashboard` | GET | Full `DashboardData` JSON |
| `/api/tokens/export` | GET `?range=` | JSONL download of usage records |

---

## Design tokens used

| Token | Meaning |
|---|---|
| `--bg0` | Deepest background |
| `--bg1` | Panel background |
| `--bg2` | Elevated surface (section headers) |
| `--bd` | Border color |
| `--t0` | Primary text |
| `--t1` | Secondary / muted text |
| `--red` / `--org` / `--yel` / `--grn` | Severity / health colors |
| `--blu` | Accent blue |
| `--mono` | Monospace font family |
