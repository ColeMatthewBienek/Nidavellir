# Memory Dashboard — UI Structure

## Entry Points

### 1. Sidebar Widget — `MemoryHealthWidget`
**File:** `src/components/chat/MemoryHealthWidget.tsx`
Embedded in `ContextPanel.tsx` (Working Set panel, bottom).
Polls `GET /api/memory/quality/summary` every 60 seconds.

### 2. Full Dashboard — `MemoryScreen`
**File:** `src/screens/MemoryScreen.tsx`
Navigated to via the nav bar (Resources > Memory, Database icon).
Registered in `App.tsx` under the `'memory'` screen ID.

---

## Component Tree

```
MemoryHealthWidget                        (compact sidebar view)
  MetricRow[]                             summary stats: active, injected, failures, confidence
  Expandable: Recent Issues               low-confidence / stale items
  Expandable: 24h Trends                  sparkline chart (injections, failures, stale growth)
  Button: Open Memory Dashboard →         navigates to MemoryScreen

MemoryScreen                              (full diagnostics dashboard)
  Header + Refresh + Export controls
  MetricCard[]                            active memories, injected, failures, confidence, never-used, stale
  2-column grid
    Left column — Issues
      SectionHeader: Duplicates
        HoverRow[] + SimilarityBadge      duplicate candidate pairs
      SectionHeader: Stale
        HoverRow[]                        stale memories
      SectionHeader: Low Confidence
        HoverRow[]                        low-confidence memories
      SectionHeader: Never Used
        HoverRow[]                        memories never injected
    Right column — Behavior
      SectionHeader: Top Injected
        HoverRow[]                        most frequently injected memories
      SectionHeader: Top Scored
        HoverRow[]                        highest-ranked memories
      SectionHeader: Events
        HoverRow[]                        recent memory system events
  Detail Drawer (slide-in)               full memory item details
  Consolidation Preview + Apply          dry-run → preview → apply workflow
  Export Controls                        activity log / state snapshot download
```

---

## Internal Types

| Type | Fields | Purpose |
|------|--------|---------|
| `Summary` | active, injected_24h, failures_24h, low_confidence, stale, never_used, health | Overall health |
| `MemItem` | id, content, category, memory_type, confidence, importance, last_used, created_at | Single memory record |
| `DupGroup` | items: MemItem[], similarity: number | Duplicate candidate grouping |
| `MemEvent` | id, event_type, description, timestamp | Memory system event |
| `ScoredItem` | item: MemItem, score: number | Ranked memory |
| `ConsolidateState` | `'idle' \| 'previewing' \| 'applying'` | Consolidation workflow state |
| `DetailType` | `MemItem \| DupGroup \| null` | Detail drawer content union |

`MemoryRecord` (in `agentStore.ts`): `{ id, content, category, memory_type, confidence, importance }` — lightweight version for store.

---

## Health States & Color Coding

| State | Trigger | Color |
|-------|---------|-------|
| `healthy` | no issues | green |
| `warning` | minor issues | yellow/amber |
| `critical` | significant failures or stale growth | red |

`MetricCard` and `SimilarityBadge` use these same color tokens.

---

## API Endpoints

| Method | Endpoint | Used By |
|--------|----------|---------|
| `GET` | `/api/memory/quality/summary?workflow=chat` | MemoryHealthWidget (60s poll), MemoryScreen |
| `GET` | `/api/memory/quality/duplicates?workflow=chat` | MemoryScreen |
| `GET` | `/api/memory/quality/stale?workflow=chat` | MemoryScreen |
| `GET` | `/api/memory/quality/low-confidence?workflow=chat` | MemoryScreen |
| `GET` | `/api/memory/quality/never-used?workflow=chat` | MemoryScreen |
| `GET` | `/api/memory/quality/frequent?workflow=chat` | MemoryScreen |
| `GET` | `/api/memory/quality/top-scored?workflow=chat` | MemoryScreen |
| `GET` | `/api/memory/quality/events?workflow=chat` | MemoryScreen |
| `POST` | `/api/memory/consolidate?workflow=chat&dry_run={true\|false}` | MemoryScreen consolidation |
| `GET` | `/api/memory/export/activity?hours={n}&workflow=chat&include_snapshots=true` | MemoryScreen export |
| `GET` | `/api/memory/export/state?workflow=chat&include_events=true&include_vectors=true` | MemoryScreen export |
| `GET` | `/api/memory/?workflow=chat&limit=12` | agentSocket on session events |

---

## State Management

**Zustand store** (`src/store/agentStore.ts`):
- `memories: MemoryRecord[]` — up to 12 most recent memories
- `setMemories(records)` — setter, called by socket handler

**Socket triggers** (`src/lib/agentSocket.ts`):
`_fetchMemories()` is called on `session_ready`, `session_switch_ready`, and `conversation_created` events.

`MemoryScreen` and `MemoryHealthWidget` manage their own local state (fetch on mount / interval) and do not read from the Zustand store.

---

## Data Flow

```
WebSocket event (session_ready / session_switch_ready / conversation_created)
  └─> agentSocket._fetchMemories()
        └─> GET /api/memory/?workflow=chat&limit=12
              └─> agentStore.setMemories(records)

MemoryHealthWidget (mounted in ContextPanel)
  └─> polls GET /api/memory/quality/summary every 60s
        └─> local state: summary, issues, trends

MemoryScreen (opened via nav)
  └─> parallel fetch on mount: summary + duplicates + stale +
      low-confidence + never-used + frequent + top-scored + events
        └─> local state: all quality data
  └─> user clicks Consolidate
        └─> POST /api/memory/consolidate?dry_run=true  (preview)
        └─> POST /api/memory/consolidate?dry_run=false (apply)
  └─> user clicks Export
        └─> GET /api/memory/export/activity or /export/state → file download
```

---

## Shared Sub-Components (all defined inline in `MemoryScreen.tsx`)

| Component | Purpose |
|-----------|---------|
| `MetricCard` | Single stat tile: label, value, color |
| `SimilarityBadge` | Percentage badge with color gradient |
| `HoverRow` | Clickable row with hover highlight |
| `SectionHeader` | Dot + title section divider |
| `InlineError` | Inline error message display |
| `EmptyRow` | Empty-state row message |
| `LabeledValue` | Label + value pair |
| `QuotedBox` | Styled quoted text block |

---

## Navigation Config

- **Label:** Memory
- **Icon:** Database/cylinder SVG
- **Section:** Resources (alongside Tasks, Skills, Tokens)
- **Screen ID:** `'memory'` (defined in `src/types/index.ts` as part of `ScreenId` union)
