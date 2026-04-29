# Memory Quality Dashboard — Technical Specification

**Version:** 1.0
**Status:** Built
**Date:** April 25, 2026
**Component:** Nidavellir.NidMemory

---

## Overview

The Memory Quality Dashboard is a diagnostic interface for inspecting the internal memory system used by the agent. It surfaces system health, identifies issues (staleness, duplication, noise), and provides zero-ambiguity visibility into memory behavior.

**Scope:** Technical inspection tool for power users. NOT a general user feature.
**Tone:** Technical, precise, slightly industrial — internal tooling aesthetic.

---

## Navigation Integration

### Sidebar Entry
- **Label:** Memory
- **Icon:** Database/memory icon (16×16 SVG)
- **Position:** Resources group, below Skills, above Settings
- **Route:** `/memory-quality`
- **Navigation:** Click triggers `setView('memory')` and renders `NidMemory` component

---

## Page Structure

### 1. Header Bar
- **Left:**
  - Title: "Memory Quality" (14px, bold)
  - Subtitle: "Agent memory diagnostics and health" (12px, muted)
- **Right:**
  - Refresh button (small, secondary style)
- **Height:** 48px
- **Styling:** Matches TopBar component (BG1 background, BD border-bottom)

---

### 2. Summary Metrics Section
**Height:** Variable (metric cards + padding)
**Layout:** Horizontal flex row, wrappable

7 metric cards displayed:
1. **Total Active Memories** — 847 (neutral gray)
2. **Injected (24h)** — 342 (neutral gray)
3. **Extract Fails (24h)** — 8 (red, failure indicator)
4. **Dedup Rejections** — 23 (yellow, warning)
5. **Low Confidence** — 34 (yellow, warning)
6. **Never Used** — 67 (yellow, warning)
7. **Superseded** — 12 (neutral gray)

**Card Structure:**
- Large number (28px, monospace, color-coded)
- Small label (11px, uppercase, gray)
- Optional subtext (10px, color-coded)
- Padding: 14px internal
- Border: 1px BD, radius 8px
- Background: BG1
- Min width: 140px, flex 0 0 calc(25% - 10px)

---

### 3. Main Content Grid
**Layout:** 2-column, equal width, bordered divider
**Overflow:** Both columns independently scrollable
**Border:** 1px BD vertical divider

#### LEFT COLUMN: Issues

**1. Duplicate Candidates**
- Header: "Duplicate Candidates (N)" with yellow dot indicator
- List of similarity groups
- **Row structure:**
  - Similarity badge: score as % (e.g., "94%"), YEL background
  - Occurrence count: "×N"
  - First memory text
  - Separator: "↔"
  - Second memory text
- **Interaction:** Hover reveals BG2 background; click opens detail drawer
- **Color:** YEL accents for similarity warnings

**2. Stale Memories**
- Header: "Stale Memories (N)" with yellow dot
- Sorted by days since last used (descending)
- **Row structure:**
  - Memory ID (monospace, gray)
  - Memory text
  - "Not used: Xd" + "Confidence: Y%"
- **Sorting:** Most stale first
- **Interaction:** Clickable rows

**3. Low Confidence (Stored but Not Injected)**
- Header: "Low Confidence (N)" with yellow dot
- **Row structure:**
  - Memory ID (monospace, RED)
  - Category tag (monospace, BG2 background)
  - Confidence score (RED, bold, right-aligned)
  - Memory content preview
- **Highlighting:** RED for low-confidence visual emphasis

**4. Never Used**
- Header: "Never Used (N)" with yellow dot
- **Row structure:**
  - Memory ID
  - "Created YYYY-MM-DD"
  - Memory content
- **Note:** These have never been injected into any agent context

---

#### RIGHT COLUMN: Behavior

**1. Top Injected (Frequent Memories)**
- Header: "Top Injected (N)" with green dot indicator
- **Row structure:**
  - Use count badge: "#N" (GRN, monospace)
  - "Last: Xm/Xh"
  - Memory content
  - Score breakdown on second line: "rel:X% imp:X% decay:X%"
- **Ranking:** By use_count descending
- **Color:** GRN accents for healthy/frequent

**2. Extraction Failures**
- Header: "Extraction Failures (N)" with red dot
- **Row structure:**
  - Timestamp (HH:MM)
  - Error type badge (RED, monospace, BG+border)
  - Failed query text
- **Errors tracked:** context_window_exceeded, extraction_timeout, invalid_format, etc.
- **Color:** RED for failures

**3. Search Fallback Events** (optional, not in current mock)
- When FTS (full-text search) fails, recorded here
- Shows query + reason

**4. Top Scored Memories** (optional, not in current mock)
- Alternative ranking by computed score
- Shows relevance, importance, decay breakdown

---

### 4. Detail Drawer (Side Panel)

**Trigger:** Click any memory row
**Position:** Right edge, overlay on content
**Size:** 320px wide
**Behavior:** Slides in from right; click ✕ to close; also clickable on backdrop

**Header:**
- "DETAILS" label (12px, uppercase, gray)
- Close button (✕, 16px)

**Content:** Scrollable, 14px padding, gap: 14px between sections

**Per Memory Type:**

**Duplicate:**
- Similarity percentage (large, YEL, monospace)
- First memory text (quoted box)
- Second memory text (quoted box)
- Occurrence count

**Stale:**
- ID (monospace)
- Full content (quoted box)
- Days since last used
- Confidence percentage
- Created date

**Low Confidence:**
- ID
- Confidence percentage (large, RED)
- Content (quoted box)
- Category tag

**Never Used:**
- ID
- Content (quoted box)
- Created date
- Warning box (YEL background): "⚠ Never injected — This memory has never been used..."

**Frequent:**
- ID
- Content (quoted box)
- Use count
- Last used timestamp
- Score breakdown (3 horizontal bars: relevance, importance, decay)

**Extraction Failure:**
- Timestamp
- Error type badge (RED)
- Failed query (quoted box)

---

## Data Model

### Mock Endpoints (to be implemented)
- `GET /api/memory/quality/summary` — Returns MEM_SUMMARY object
- `GET /api/memory/quality/duplicates` — Returns array of duplicate groups
- `GET /api/memory/quality/stale` — Returns stale memories, sorted by age
- `GET /api/memory/quality/low-confidence` — Returns low-confidence stored memories
- `GET /api/memory/quality/never-used` — Returns never-injected memories
- `GET /api/memory/quality/frequent` — Returns top-injected memories with scores
- `GET /api/memory/quality/extraction-failures` — Returns recent extraction errors
- `GET /api/memory/events` — Returns event history (optional)

### Data Structures

```typescript
// Summary metrics
{
  totalActive: number,
  injected24h: number,
  extractionFails: number,
  dedupRejections: number,
  lowConfidence: number,
  neverUsed: number,
  superseded: number,
}

// Duplicate candidate
{
  id: string,
  score: number,        // 0–1, similarity
  text1: string,        // First memory
  text2: string,        // Second memory
  count: number,        // How many times this pair appeared
}

// Stale memory
{
  id: string,
  text: string,
  lastUsed: number,     // Days ago
  confidence: number,   // 0–1
  created: string,      // YYYY-MM-DD
}

// Low confidence memory
{
  id: string,
  confidence: number,   // 0–1
  content: string,
  category: string,     // e.g., "optimization", "caching"
}

// Never-used memory
{
  id: string,
  created: string,      // YYYY-MM-DD
  content: string,
}

// Frequent memory
{
  id: string,
  content: string,
  useCount: number,
  lastUsed: string,     // e.g., "14m", "1h"
  score: number,        // Overall computed score 0–1
  relevance: number,    // 0–1
  importance: number,   // 0–1
  decay: number,        // 0–1
}

// Extraction failure
{
  id: string,
  time: string,         // HH:MM
  error: string,        // Error type
  query: string,        // What was being queried
}
```

---

## Visual Design System

### Colors (Nidavellir tokens)
- **BG0:** #0d1117 (darkest background)
- **BG1:** #161b22 (panel background)
- **BG2:** #21262d (hover background)
- **BD:** #30363d (border color)
- **T0:** #e6edf3 (primary text)
- **T1:** #8b949e (secondary text)
- **GRN:** #3fb950 (healthy/success)
- **YEL:** #d29922 (warning)
- **RED:** #f85149 (failure)
- **MONO:** JetBrains Mono, Fira Code, monospace

### Color Coding Rules
- **Red (#f85149):** Failures, errors, critical issues
- **Yellow (#d29922):** Warnings, attention needed (low confidence, stale, unused)
- **Green (#3fb950):** Healthy, frequently used
- **Neutral (#8b949e):** Informational metrics, totals

### Typography
- **Headers:** 12px, bold, uppercase, gray (T1)
- **Card values:** 28px, bold, monospace, color-coded
- **Card labels:** 11px, uppercase, gray
- **Row text:** 11–12px, T0 or T1 depending on context
- **Details drawer:** 10–12px, various weights

### Spacing
- **Card padding:** 14px
- **Row padding:** 10px 14px
- **Gap between cards:** 12px
- **Section gap:** 14px (in drawer)
- **Column gap:** 0 (bordered divider)
- **Drawer width:** 320px

### Interactions
- **Hover:** Background changes to BG2, cursor becomes pointer
- **Click:** Opens detail drawer or state changes
- **Drawer close:** Click ✕ or outside (backdrop)
- **Scroll:** Independent per column and drawer
- **No animations:** Static, responsive only to state

---

## Component Breakdown

### `NidMemory()`
Main screen component. State: `selectedDetail` (null or {type, data}).

### `MetricCard({ label, value, color, subtext })`
Individual metric card. Displays large number + label.

### `MemoryRow({ mem, onClick, expandable })`
Generic row for list items. Shows hover state, click handler.

### `SimilarityBadge({ score })`
Small badge showing similarity as percentage with color coding.

### Detail Drawer
Inline JSX rendering based on `selectedDetail.type`. No separate component (for simplicity and single-file structure).

---

## Interactions & Flows

### Primary Flow: Inspect a Memory Issue
1. User clicks "Memory" in sidebar
2. Dashboard loads with summary + all issue panels
3. User spots issue (e.g., high similarity score)
4. User clicks the row
5. Drawer slides in from right with full details
6. User reads metadata, content, event history
7. User closes drawer (✕ or outside click)

### Secondary Flow: Monitor Health
1. User scans summary metrics
2. Red/yellow indicators draw eye to problems
3. User can drill into specific categories
4. User can use refresh button to reload data

### Tertiary Flow: Search & Filter (Future)
- Currently not implemented, but structure allows for query input, sorting toggles

---

## Non-Goals

- ❌ Redesign existing chat UI
- ❌ Add animations or gimmicks
- ❌ Create a "friendly" interface
- ❌ Simplify terminology — keep technical language
- ❌ Modal dialogs (drawer only)
- ❌ Inline editing of memories (read-only view)
- ❌ Export/report generation (future feature)

---

## Testing Checklist

- [ ] Memory nav item is visible and clickable
- [ ] Dashboard loads without errors
- [ ] All 7 metric cards display correct values
- [ ] Left column (Issues) renders all 4 sections
- [ ] Right column (Behavior) renders all 2 main sections
- [ ] Row hover shows BG2 background
- [ ] Clicking a row opens drawer from right
- [ ] Drawer displays correct data per memory type
- [ ] Drawer close button (✕) works
- [ ] Clicking outside drawer doesn't close it (only ✕ or explicit action)
- [ ] Columns scroll independently
- [ ] Drawer scrolls independently
- [ ] Color coding matches severity (red/yellow/green)
- [ ] Monospace font used for IDs, scores, timestamps
- [ ] No console errors

---

## Future Enhancements

1. **Filtering:** Add text search, category filters, date range picker
2. **Actions:** Supersede, delete, or re-inject memories from drawer
3. **Bulk ops:** Multi-select + bulk delete/supersede
4. **Trending:** Show memory injection/failure rates over time
5. **Comparison:** Side-by-side memory comparison
6. **Export:** Download memory health report as CSV/JSON
7. **Automation:** Auto-cleanup rules for stale/low-confidence memories
8. **Real-time updates:** WebSocket for live metrics refresh
9. **Search fallback events:** Track and display FTS failures
10. **Custom scoring:** Allow power users to adjust relevance/importance weights

---

## Implementation Notes

- All UI built with React 18.3.1 (inline JSX)
- No external dependencies beyond React/Babel
- Tokens centralized at top of screens file (BG0, BG1, etc.)
- State management via `useState` only
- Mock data in arrays at top of component (replace with API calls)
- Detail drawer positioned `fixed` with z-index: 10
- No modal backdrop (drawer only)
- Styling via inline `style` objects for simplicity

---

**End of Specification**
