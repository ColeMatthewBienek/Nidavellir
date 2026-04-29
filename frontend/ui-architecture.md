# Nidavellir Frontend UI Architecture

## 1. Directory Structure

```
src/
├── App.tsx                          # Main app router and screen dispatcher
├── main.tsx                         # React root entry point
├── api/
│   ├── client.ts                    # OpenAPI fetch client wrapper
│   └── types.ts                     # Generated API types
├── components/
│   ├── SpawnModal.tsx               # Agent spawning wizard
│   ├── chat/                        # Chat UI components
│   │   ├── AgentSelector.tsx        # Model/provider selector dropdown
│   │   ├── ContextPanel.tsx         # File context & token usage sidebar
│   │   ├── FileSearchModal.tsx      # File picker for working set
│   │   ├── HandoffModal.tsx         # Provider switch confirmation dialog
│   │   ├── MarkdownRenderer.tsx     # Markdown → React renderer
│   │   ├── MemoryHealthWidget.tsx   # Memory status indicator
│   │   ├── MessageList.tsx          # Chat history list with scroll
│   │   ├── MsgBubble.tsx            # Individual message bubble
│   │   ├── SlashMenu.tsx            # Command autocomplete menu
│   │   ├── StreamingCursor.tsx      # Live streaming indicator
│   │   ├── StreamRenderer.tsx       # Stream event → visual rendering
│   │   ├── ThinkingBubble.tsx       # Claude thinking visualization
│   │   ├── ThinkingDots.tsx         # Animated loader
│   │   └── ToastBar.tsx             # Toast notification component
│   ├── dashboard/
│   │   └── TokenUsageDashboard.tsx  # Token usage analytics & charts
│   ├── nav/
│   │   ├── NavSidebar.tsx           # Left sidebar navigation
│   │   ├── NavItem.tsx              # Individual nav menu item
│   │   └── nav-config.tsx           # Nav menu configuration
│   └── shared/
│       ├── Btn.tsx                  # Button component (primary/secondary)
│       ├── ProviderIcon.tsx         # AI provider icon display
│       ├── SBadge.tsx               # Status badge
│       ├── SecPanel.tsx             # Secondary sidebar panel
│       └── TopBar.tsx               # Screen header bar
├── hooks/
│   ├── useAgentModels.ts            # Load available LLM models
│   └── useProviders.ts              # Load provider configurations
├── lib/
│   ├── agentSocket.ts               # WebSocket agent communication
│   ├── parsers/
│   │   ├── index.ts                 # Parser factory
│   │   ├── ClaudeStreamParser.ts    # Anthropic event parser
│   │   ├── CodexStreamParser.ts     # OpenAI event parser
│   │   └── OllamaStreamParser.ts    # Local model parser
│   ├── providerTheme.ts             # Provider color/icon theming
│   ├── streamTypes.ts               # Stream event type definitions
│   ├── types.ts                     # Shared lib type definitions
│   └── utils.ts                     # Utility functions
├── screens/
│   ├── AgentsScreen.tsx             # Agent pool dashboard
│   ├── ChatScreen.tsx               # Main conversation interface
│   ├── MemoryScreen.tsx             # Memory management & analytics
│   ├── PlanScreen.tsx               # Plan DAG visualization
│   ├── ScheduleScreen.tsx           # Work schedule calendar
│   ├── SettingsScreen.tsx           # App configuration
│   ├── SkillsScreen.tsx             # Skills library browser
│   ├── TasksScreen.tsx              # Task queue viewer
│   └── TokenScreen.tsx              # Token usage metrics
├── store/
│   ├── index.ts                     # App state store (screens, status)
│   └── agentStore.ts                # Chat state (messages, conversations, context)
├── types/
│   └── index.ts                     # Global types (ScreenId, BadgeStatus)
└── __tests__/                       # Test suite
```

---

## 2. Screens

| Screen | File | Purpose |
|--------|------|---------|
| Chat | `ChatScreen.tsx` | Main conversation interface |
| Plan | `PlanScreen.tsx` | Project planning with task DAG |
| Schedule | `ScheduleScreen.tsx` | Weekly agent work schedule |
| Agents | `AgentsScreen.tsx` | Active agent pool status |
| Tasks | `TasksScreen.tsx` | Task queue with filtering |
| Skills | `SkillsScreen.tsx` | Skills library browser |
| Memory | `MemoryScreen.tsx` | Memory health & deduplication |
| Tokens | `TokenScreen.tsx` | Token usage analytics |
| Settings | `SettingsScreen.tsx` | App configuration |

---

## 3. Routing

Routing is manual and event-based — no React Router.

- `App.tsx` holds a static `SCREENS` map keyed by `ScreenId`
- `NavSidebar` dispatches `nid:navigate` custom events to switch screens
- `SlashMenu` commands can also trigger navigation (e.g. `/plan`)
- `useAppStore.setActiveScreen(id)` updates state and triggers re-render

---

## 4. State Management (Zustand)

### `useAppStore` (`store/index.ts`)

Minimal global store for screen navigation and backend health.

```typescript
{
  activeScreen: ScreenId,
  backendStatus: 'ok' | 'error' | 'unknown',
  setActiveScreen(id): void,
  setBackendStatus(status): void,
}
```

Polls `/api/health` every 30 seconds.

### `useAgentStore` (`store/agentStore.ts`)

Full chat, conversation, and context state (~500 lines).

**Provider / connection**:
```typescript
selectedAgent: string          // default: "nid-agent-0"
selectedProvider: string       // default: "claude"
connectionStatus: ConnectionStatus
providers: ProviderInfo[]
```

**Model selection**:
```typescript
agentModels: AgentModelDef[]
selectedModel: string          // format: "provider_id:model_id"
```
Calling `setSelectedModel` auto-derives `selectedProvider`.

**Messages**:
```typescript
interface Message {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: Date
  streaming: boolean
  rawChunks: string[]
  events: StreamEvent[]
}
```

**Conversations**:
```typescript
conversationId: string | null
activeConversationId: string | null
conversations: ConversationListItem[]
```
Actions: `createConversation`, `loadConversation`, `renameConversation`, `pinConversation`, `archiveConversation`.

**Working set (context files)**:
```typescript
workingSetFiles: ConversationFile[]
workingDirectory: string | null
```
Actions: `setWorkingDirectory`, `refreshWorkingSetFiles`, `addWorkingSetFiles`, `removeWorkingSetFile`.

**Token tracking**:
```typescript
contextUsage: {
  model, provider, currentTokens, usableTokens, totalLimit,
  percentUsed, state: 'ok' | 'warn' | 'prepare' | 'force' | 'blocked',
  accurate, lastUpdatedAt
} | null
```

**Session handoff** (provider switching):
```typescript
handoffPending: boolean
handoffProvider: string
handoffSummary: string | null
toastMessage: string
```

---

## 5. Communication & Streaming

### WebSocket (`lib/agentSocket.ts`)

- Connects to `ws://localhost:7430/api/ws` on app mount
- `sendMessage(content)` dispatches user messages
- `sendCancel()` interrupts streaming
- Incoming chunks are fed through provider-specific parsers → `StreamEvent[]`

### Stream Event Types (`lib/streamTypes.ts`)

```typescript
type StreamEvent =
  | { type: 'answer_delta';     content: string }
  | { type: 'progress';          content: string }
  | { type: 'tool_start';        name: string; args: unknown; raw: string }
  | { type: 'tool_delta';        content: string }
  | { type: 'tool_end';          status: 'success' | 'error'; summary: string }
  | { type: 'skill_use';         name: string; detail: string }
  | { type: 'patch';             content: string }
  | { type: 'reasoning_signal';  content: string }
  | { type: 'think';             content: string }
  | { type: 'tool_use';          tool: string; args: unknown }
  | { type: 'tool_result';       content: string }
  | { type: 'diff';              content: string }
  | { type: 'done' }
  | { type: 'error';             message: string }
```

### Parsers (`lib/parsers/`)

Three provider-specific parsers normalize raw stream chunks:

| Parser | Format |
|--------|--------|
| `ClaudeStreamParser` | Anthropic Messages API SSE |
| `CodexStreamParser` | OpenAI / CodexMini |
| `OllamaStreamParser` | Local Ollama |

Each implements `feed(chunk): StreamEvent[]`, `flush(): StreamEvent[]`, `reset(): void`.

---

## 6. Chat Screen Component Hierarchy

```
ChatScreen
├── SecPanel (conversation list sidebar)
│   ├── Pinned conversations
│   └── Recent conversations
├── TopBar
│   ├── AgentSelector
│   ├── CWD indicator
│   └── Context panel toggle
├── MessageList
│   └── Per message:
│       ├── MsgBubble (user messages)
│       ├── StreamRenderer (agent messages — event-driven)
│       └── MarkdownRenderer (fallback)
├── Input area
│   ├── SlashMenu (autocomplete)
│   ├── Textarea
│   ├── Send button
│   └── Pending attachments
└── Overlays
    ├── ContextPanel (file list, token usage, memory health)
    ├── FileSearchModal
    ├── HandoffModal
    └── Delete confirmation dialog
```

---

## 7. Shared / Layout Components

| Component | Purpose |
|-----------|---------|
| `TopBar` | Screen header with title, subtitle, and action slots |
| `SecPanel` | Secondary sidebar container |
| `Btn` | Button (primary / secondary / small variants) |
| `SBadge` | Status badge (idle / active / pending / complete / error) |
| `ProviderIcon` | AI provider icon (Anthropic / OpenAI / Google) |

---

## 8. Hooks

| Hook | Endpoint | Caches in |
|------|----------|-----------|
| `useProviders` | `GET /api/agents/providers` | `agentStore.providers` |
| `useAgentModels` | `GET /api/agents/models` | `agentStore.agentModels` |

---

## 9. Modals

| Modal | Trigger | Purpose |
|-------|---------|---------|
| `SpawnModal` | `nid:spawn` event | Multi-step wizard to launch agents |
| `HandoffModal` | Provider switch | Confirmation: Continue / Clean / Review / Cancel |
| `FileSearchModal` | From ContextPanel | File tree picker for working set |
| Delete confirmation | Conversation menu | Confirm conversation deletion |

---

## 10. Design Tokens

CSS custom properties used throughout:

| Token | Role |
|-------|------|
| `--bg0`, `--bg1`, `--bg2` | Background layers (dark theme) |
| `--bd` | Border color |
| `--t0`, `--t1` | Primary and secondary text |
| `--grn`, `--yel`, `--red`, `--blu`, `--org`, `--prp` | Status / accent colors |
| `--mono` | Monospace font stack |

**Keyframe animations**: `nidPulse`, `nidBounce`, `nidBlink`, `nidFadeSlide`

---

## 11. Key Type Definitions

```typescript
// types/index.ts
type ScreenId = 'chat' | 'plan' | 'schedule' | 'agents' | 'tasks' | 'skills' | 'memory' | 'tokens' | 'settings'
type BackendStatus = 'unknown' | 'ok' | 'error'
type BadgeStatus = 'idle' | 'busy' | 'active' | 'error' | 'pending' | 'running' | 'complete' | 'failed' | 'scheduled' | 'changes_requested'

// store/agentStore.ts
interface ConversationListItem {
  id: string
  title: string
  updatedAt: string
  createdAt: string
  activeProvider?: string
  activeModel?: string
  messageCount: number
  pinned: boolean
  archived: boolean
}

// lib/types.ts
interface ProviderInfo {
  id: string
  display_name: string
  available: boolean
  roles: string[]
  supports_session_resume: boolean
  supports_file_context: boolean
  supports_image_input: boolean
  supports_interrupt: boolean
  streams_incrementally: boolean
  cost_tier: string
  latency_tier: string
  max_concurrent_slots: number
  // ...more capability flags
}
```

---

## 12. Event System

**Custom window events**:
- `nid:spawn` — opens SpawnModal
- `nid:navigate` (detail: ScreenId) — switches active screen

**Internal listeners**:
- ChatScreen: `Escape` → `sendCancel()` while streaming
- MessageList: auto-scrolls on new message append

---

## 13. API Endpoints Referenced by the UI

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Backend liveness check |
| `/api/agents/providers` | GET | Load available providers |
| `/api/agents/models` | GET | Load available LLM models |
| `/api/conversations` | GET, POST | List and create conversations |
| `/api/conversations/{id}` | GET, PATCH | Load and rename a conversation |
| `/api/conversations/{id}/files` | GET, POST, DELETE | Manage working set files |
| `/api/conversations/{id}/files/blob` | POST | Upload file blobs (drag-drop) |
| `/api/conversations/{id}/workspace` | POST | Set working directory |
| `/api/conversations/{id}/pin` | POST | Pin / unpin conversation |
| `/api/conversations/{id}/archive` | POST | Archive conversation |
| `/api/context/usage` | GET | Token usage stats |
| `/api/memory/` | GET | Fetch memory items for chat |
| `/api/memory/*` | Various | Memory consolidation (MemoryScreen) |
| `/api/tokens/dashboard` | GET | Token usage metrics (TokenScreen) |
| `/api/ws` | WebSocket | Stream agent messages and events |

---

## 14. Screens with Static / Mock Data

These screens are scaffolded but not yet wired to live APIs:

- **AgentsScreen** — `AGENT_DATA`, `ACTIVITY_LOG` are hardcoded
- **PlanScreen** — `PLAN_PROJECTS`, DAG nodes/edges, stage content are hardcoded
- **ScheduleScreen** — `SCHED_RUNS`, weekly calendar are hardcoded
- **TasksScreen** — `ALL_TASKS` is hardcoded
- **SkillsScreen** — `SKILL_DATA` is hardcoded
- **MemoryScreen** — partially wired to API, some UI uses fallback data

---

## 15. Core User Flows

### Start a chat
1. Click "+" in the conversation sidebar
2. `createConversation()` → `POST /api/conversations` with selected model/provider
3. Store updates `activeConversationId`, clears messages, sets working directory

### Send a message
1. User types and hits Enter
2. Pending file blobs uploaded, then `sendMessage(content)` over WebSocket
3. `addMessage('user', content)` added to store
4. Server streams response → parser emits `StreamEvent[]`
5. Store calls `appendRawChunk` and `appendStreamEvents` per chunk
6. `finalizeLastAgentMessage()` sets `streaming: false` on completion

### Switch provider/model
1. Open AgentSelector dropdown, pick a model
2. `setSelectedModel(modelId)` — store auto-derives provider
3. Next message uses the new provider/model
4. May trigger HandoffModal if session switch is needed

### Manage context files
1. Open ContextPanel via TopBar toggle
2. View working set and token usage
3. Search and add files via FileSearchModal
4. Files uploaded via `/api/conversations/{id}/files/blob`
5. `refreshWorkingSetFiles()` refreshes the list
