# Integration Guide — Token Usage & Context Panel Components

## Quick Start

### 1. Add CSS Variables to Global Styles

In your root `globals.css` or `App.css`, add these CSS variables:

```css
:root {
  --bg0: #0d1117;
  --bg1: #161b22;
  --bg2: #21262d;
  --bd: #30363d;
  --t0: #e6edf3;
  --t1: #8b949e;
  --grn: #3fb950;
  --yel: #d29922;
  --org: #ff6b35;
  --red: #f85149;
  --blu: #1f6feb;
}
```

### 2. Copy Component Files

```
frontend/src/components/chat/
  ├── ContextPanel.tsx (use provided)
  ├── FileSearchModal.tsx (update with file search logic)
  └── [existing components]

frontend/src/components/dashboard/
  └── TokenUsageDashboard.tsx (new)
```

### 3. Update ChatScreen.tsx

```typescript
// Add to imports
import { ContextPanel } from '../components/chat/ContextPanel';

// In ChatScreen component
export function ChatScreen() {
  // ... existing state
  const [ctxOpen, setCtxOpen] = useState(true);

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left sidebar — Threads */}
      <SecPanel title="Threads" action="+" onAction={startNewChat}>
        {/* Thread list */}
      </SecPanel>

      {/* Center — Messages + Input */}
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title="chat">
          <AgentSelector compact />

          {/* Context toggle button */}
          <div onClick={() => setCtxOpen(o => !o)} style={{
            fontSize: 12,
            color: ctxOpen ? 'var(--grn)' : 'var(--t1)',
            background: ctxOpen ? '#3fb95012' : 'var(--bg2)',
            border: `1px solid ${ctxOpen ? '#3fb95044' : 'var(--bd)'}`,
            borderRadius: 5,
            padding: '4px 10px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}>
            {ctxOpen ? '● Context' : `${3} files`}
          </div>
        </TopBar>

        <MessageList />

        {/* Input section */}
      </div>

      {/* Right sidebar — Context Panel */}
      {ctxOpen && <ContextPanel onClose={() => setCtxOpen(false)} />}
    </div>
  );
}
```

### 4. Implement FileSearchModal

The `ContextPanel` expects a `FileSearchModal` component. Implement it to:

```typescript
interface FileSearchModalProps {
  onClose: () => void;
  onAddFiles: (files: ContextFile[]) => void;
}

export function FileSearchModal({ onClose, onAddFiles }: FileSearchModalProps) {
  // Show modal overlay
  // Implement folder/file tree browsing
  // Allow multi-select
  // Filter by file type
  // Call onAddFiles with selected files
  // Call onClose when done
}
```

---

## Token Usage Flow

### Per-Message Token Update

After user sends a message, the API response includes token counts:

```typescript
const send = () => {
  if (!input.trim() || isStreaming) return;

  addMessage('user', input);
  setInput('');

  // Send to API
  const response = await sendMessage(input);

  // Update context usage from response
  // response.tokensUsed = 847
  // response.totalContextTokens = 12847
  updateContextTokens({
    current: response.totalContextTokens,
    used: response.tokensUsed,
  });
};
```

### Real-Time Context Calculation

In `ContextPanel`, the health state updates dynamically:

```typescript
const percentage = Math.round((currentTokens / usableTokens) * 100);

// This triggers color/state changes automatically
// No additional API call needed
```

---

## Display TokenUsageDashboard

### As a Separate Page/Modal

```typescript
import { TokenUsageDashboard } from '../components/dashboard/TokenUsageDashboard';

function TokenDashboardPage() {
  const handleExport = (format: 'json' | 'csv') => {
    // Download endpoint: /api/tokens/export?format=json
    window.location.href = `/api/tokens/export?format=${format}`;
  };

  return (
    <div style={{ padding: 20 }}>
      <TokenUsageDashboard onExport={handleExport} />
    </div>
  );
}
```

### Connect "Inspect Dashboard" Button

In `ContextPanel`, wire the Memory Health Widget button:

```typescript
<button
  onClick={() => window.dispatchEvent(new CustomEvent('nid:navigate', { detail: 'tokens' }))}
  style={{ /* ... */ }}
>
  Inspect Dashboard →
</button>
```

Then handle the navigation in your app root.

---

## API Endpoints Needed

### Get Current Token Usage

```
GET /api/context/usage
Response: {
  model: string;
  currentTokens: number;
  usableTokens: number;
  totalLimit: number;
  reserved: number;
  accurate: boolean;
}
```

### Export Token Data

```
GET /api/tokens/export?format=json|csv
Response: JSON or CSV file download
```

### Compact Memory (Future)

```
POST /api/memory/compact
Response: { success: boolean; tokensFreed: number; }
```

---

## Styling Notes

### Dark Theme
All components use CSS variables for easy theme swapping. To use light theme:

```css
:root {
  --bg0: #ffffff;
  --bg1: #f6f8fa;
  --bg2: #eaeef2;
  --bd: #d0d7de;
  --t0: #24292f;
  --t1: #57606a;
  /* ... rest of vars */
}
```

### Responsive
- Components are fixed-width (260px sidebar)
- Assume side-by-side layout (desktop)
- For mobile, implement collapsible sidebar or full-screen context view

---

## Testing Checklist

- [ ] Click "Context" button in TopBar to toggle panel on/off
- [ ] Collapse/expand Files section
- [ ] Collapse/expand Token Usage section
- [ ] Remove a file from the list
- [ ] Click "+ Add files" (should open FileSearchModal)
- [ ] Send a message and watch token count increase
- [ ] Verify health state color changes at thresholds (50%, 65%, 75%, 85%)
- [ ] Memory Health Widget stays visible when scrolling content
- [ ] Click "Inspect Dashboard" (navigate to TokenUsageDashboard)
- [ ] Export token data as JSON and CSV

---

## Future Enhancements

1. **Memory Compaction UI**
   - Add "Compact Now" button when health state >= "At Risk"
   - Show progress indicator during compaction
   - Display tokens freed after completion

2. **Historical Analytics**
   - Token usage sparkline in Token Usage section
   - Daily/weekly/monthly breakdown in TokenUsageDashboard
   - Trend analysis and projections

3. **Alerts & Notifications**
   - Browser notification when usage hits threshold
   - Toast notification on new high-water mark
   - Email digest of daily usage

4. **Batch File Operations**
   - "Remove All" button for Files section
   - File search/filter within context
   - Drag-to-reorder file priority

5. **Memory Search**
   - Search within pinned memory items
   - Filter by tag, date, relevance
   - Export selected memories
