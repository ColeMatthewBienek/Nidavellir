# Technical Memory Architecture — Nidavellir

## 1. Executive Summary

Nidavellir implements a **hybrid memory system** that combines deterministic lexical retrieval (FTS) with probabilistic semantic retrieval (vector search), layered with **strict gating, scoring, and full observability**. The system is designed to be:

- **Deterministic-first** (FTS dominates when strong)
- **Semantically aware** (vector fills lexical gaps)
- **Auditable** (all decisions logged)
- **Reversible** (feature-flag controlled)
- **Extensible** (modular components)

---

## 2. System Goals

- Retrieve **relevant prior knowledge** for each user query
- Avoid **hallucinated or irrelevant memory injection**
- Maintain **full traceability of decisions**
- Enable **future self-optimization** via logged signals

---

## 3. High-Level Architecture

```
User Query
   ↓
Extractor → Memory Store (SQLite)
   ↓
Embedding → Vector Store (Qdrant)
   ↓
Retrieval Layer
   ├── FTS (SQLite FTS5)
   ├── Vector Search (Qdrant)
   ↓
Hybrid Merge + Scoring
   ↓
Selection (ContextPack)
   ↓
Injection into Prompt
   ↓
Event Logging + Diagnostics
```

---

## 4. Core Components

### 4.1 Memory Store (SQLite)

Primary source of truth.

Stores:
- content
- confidence (0–1)
- importance (0–10)
- category/type
- use_count
- timestamps

Properties:
- strongly consistent
- queryable via FTS5
- supports joins for diagnostics

---

### 4.2 Vector Store (Qdrant)

Secondary semantic index.

- Stores embeddings of memory content
- Enables similarity search
- Typical score range: 0.55–0.75

Key constraint:
- Not authoritative (SQLite remains source of truth)

---

### 4.3 Retrieval Layer

#### FTS Retrieval
- Deterministic lexical matching
- Strong matches override all other signals

#### Vector Retrieval
- Semantic similarity via embeddings
- Used when FTS is weak or absent
- Results filtered by MIN_VECTOR_SIM (~0.55)

---

## 5. Hybrid Retrieval (Phase 2C)

### 5.1 Merge Strategy

Candidates merged by `memory_id`:

```
FTS only
Vector only
Both
```

---

### 5.2 Scoring Function

```
score =
  normalize_bm25 * 2.0
+ vector_boost
+ confidence
+ importance / 10
+ log(use_count + 1) * 0.15
+ recency_decay
```

---

### 5.3 Vector Boost (Tiered)

| Score Range | Weight |
|------------|--------|
| ≥ 0.70     | ×1.5   |
| 0.63–0.69  | ×1.0   |
| 0.55–0.62  | ×0.25  |
| < 0.55     | ignored |

---

### 5.4 Dominance Rules

- Strong FTS → overrides vector
- Vector-only allowed only if gated
- Weak vector → minimal influence

---

### 5.5 Vector-Only Gate

All must be true:

- no strong FTS match
- vector_score ≥ 0.63
- confidence ≥ 0.70
- importance ≥ 5
- memory active and valid

---

## 6. Context Injection

Selected memories are injected into the prompt via ContextPack.

Constraints:
- max memory count
- character budget
- category caps

---

## 7. Observability

### 7.1 Event Types

- vector_searched
- hybrid_scored
- retrieval_fallback
- injected
- bad_hybrid_pick_candidate

---

### 7.2 Key Diagnostics

- top_memory_ids
- raw_top_scores
- vector_results_count
- hybrid candidate list
- selected_ids

---

## 8. Safety Layer

### Bad Hybrid Pick Detector

Detects suspicious selections:

- weak vector (<0.63)
- borderline vector (0.63–0.67)
- low confidence (<0.70)
- low importance (<5)
- over-dominance
- cross-domain mismatch

Behavior:
- logs only
- does not alter system behavior

---

## 9. Feature Flags

### Hybrid Retrieval

```
NIDAVELLIR_HYBRID_RETRIEVAL=true
```

Controls:
- hybrid scoring activation
- fallback to Phase 2B when disabled

---

### Test Override

```
HYBRID_ENABLED (module-level)
```

Used for:
- unit tests
- monkeypatching

---

## 10. Data Export

### Activity Export (JSONL)
- chronological event stream
- agent-readable

### State Export (JSON)
- full memory snapshot
- system summary

---

## 11. System Properties

### Deterministic
- FTS dominance guarantees stability

### Probabilistic
- vector enables semantic generalization

### Observable
- every decision logged

### Safe
- feature flags + detector

### Extensible
- modular scoring + detection layers

---

## 12. Current Limitations

- no automatic correction of bad picks
- no adaptive scoring
- no semantic consolidation
- no contradiction handling

---

## 13. Future Roadmap

- Phase 2I: adaptive weighting
- Phase 2J: memory dominance metrics
- Phase 2K: semantic consolidation
- Phase 3: temporal reasoning

---

## 14. Summary

Nidavellir’s memory system is a:

**Hybrid, observable, safety-aware retrieval system**

It is production-capable and positioned for evolution into a **self-optimizing memory architecture**.
