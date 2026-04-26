# Nidavellir

Agentic coding, scheduling, and assistant desktop app.

## Prerequisites

- Node 20+
- Python 3.12
- [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- Claude Code CLI
- Codex CLI

## One-time setup

```bash
npm install
npm run install:all
cd backend && uv sync && cd ..
```

## Dev

```bash
npm run dev
```

Starts all three processes concurrently:
- **BE** — FastAPI on `http://localhost:7430`
- **FE** — Vite on `http://localhost:5173`
- **EL** — Electron (waits for Vite to be ready before opening)

## Tests

```bash
npm test
```

Runs backend pytest suite then frontend vitest suite. All must be green before merging.

## Ports

| Service  | Port |
|----------|------|
| FastAPI  | 7430 |
| Vite dev | 5173 |

## Memory System

Nidavellir includes a hybrid memory system combining SQLite/FTS5 and Qdrant vector search to persist knowledge across sessions, inject relevant context into agent prompts, and log all retrieval decisions for inspection. See [Technical Memory Architecture](Technical%20Memory%20Architecture.md).

## Notes

- Electron hot reload: the Electron window loads `http://localhost:5173` in dev mode. Vite HMR handles frontend hot reload automatically. Backend changes reload via uvicorn `--reload`.
- The Electron renderer has `sandbox: true` and `nodeIntegration: false`. All backend communication goes through HTTP to `localhost:7430`.
