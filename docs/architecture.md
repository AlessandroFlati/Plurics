# Plurics — Architecture Document

Last updated: 2026-04-11 10:59 UTC

## Why Plurics

The project began as CAAM — "Claude Agent Auto Manager" — a browser-side tool
for orchestrating multiple Claude Code terminal sessions on a shared workspace.
That name described an early prototype. Over time the surface area drifted:
the platform grew a DAG workflow engine, filesystem-based agent communication,
a normalization layer for LLM output, an evolutionary pool for discovery
workflows, a Lean 4 integration for formal proofs, and — most importantly — a
backend abstraction that allows non-Claude agents (deterministic processes,
local LLMs via Ollama/vLLM) to participate as first-class citizens. It stopped
being a "manager for Claude Code" and became a general-purpose orchestrator
for heterogeneous agent networks.

**Plurics** is the rename that catches up with reality. The name is a nod to
Multics (Multiplexed Information and Computing Service), the 1960s operating
system that coordinated many users sharing a single mainframe: where Multics
was about *multi*plexing human users onto one machine, Plurics is about
*pluri*plexing cognitive work across many agents of different kinds — humans,
frontier LLMs, local models, and deterministic tools — each contributing to a
single workflow.

The rename was scoped to user-facing identifiers and concepts whose old name
had become a lie (e.g. `modules/terminal/` that held three backend types, not
just terminals). Identifiers that remain accurate and stable (`DagExecutor`,
`WorkflowPlugin`, `SignalFile`, SQL table names) were left alone.

## Overview

Plurics orchestrates **heterogeneous agent networks** — mixing Claude Code
terminals, local LLMs, and deterministic processes — via a YAML-defined DAG
workflow engine. The platform is domain-agnostic: any multi-agent pipeline
can be defined as a workflow with reusable presets and a plugin that
implements domain-specific behavior.

**Three layers, clear separation:**

```
┌───────────────────────────────────────────────────────────────┐
│ Layer 3 — Workflow Instances (domain-specific)                │
│                                                               │
│   workflows/research-swarm/       — Hypothesis discovery      │
│   workflows/math-discovery/       — Financial + formal proof  │
│   workflows/theorem-prover-mini/  — Lean 4 theorem proving    │
│   workflows/sequence-explorer/    — OEIS evolutionary search  │
│   workflows/smoke-test/           — Backend validation        │
└───────────────────────────────────────────────────────────────┘
              ▲
              │ implements
┌───────────────────────────────────────────────────────────────┐
│ Layer 2 — SDK (domain-agnostic primitives)                    │
│                                                               │
│   WorkflowPlugin interface (9 hooks)                          │
│   EvolutionaryPool (tournament / roulette / top-k)            │
│   AgentBackend interface (claude-code / process / local-llm)  │
│   SignalFile schema + normalization layer                     │
└───────────────────────────────────────────────────────────────┘
              ▲
              │ uses
┌───────────────────────────────────────────────────────────────┐
│ Layer 1 — Platform (no domain knowledge)                      │
│                                                               │
│   DagExecutor state machine + run snapshot + resume           │
│   AgentRegistry (backends factory)                            │
│   SignalWatcher (chokidar + polling)                          │
│   YAML parser, preset resolver, purpose generator             │
│   React frontend (DAG + Findings + optional terminal grid)   │
│   SQLite (workspaces, presets, workflow runs)                 │
└───────────────────────────────────────────────────────────────┘
```

## Deployment Topology

```
┌──────────────────────────────────────────────────┐
│  Browser (localhost:11000)                       │
│                                                  │
│  React UI — dashboard-first                      │
│   • DAG visualization (SVG, pan/zoom)            │
│   • Findings panel (real-time via WebSocket)     │
│   • Workflow controls (start/pause/resume/stop)  │
│   • Resumable runs list                          │
│   • Terminal grid (optional, secondary)          │
└──────────────────────────────────────────────────┘
        │  WebSocket + REST API (Vite proxy)
        ▼
┌──────────────────────────────────────────────────┐
│  Server (localhost:11001)                        │
│                                                  │
│  Express HTTP + WebSocket server                 │
│   • AgentRegistry — 3 backend types              │
│   • DagExecutor + snapshot persistence           │
│   • SignalWatcher — polling + chokidar           │
│   • SQLite (workspaces, presets, runs)           │
│   • Knowledge/inbox watcher                      │
│                                                  │
│  Optional local resources:                       │
│   • Ollama (local LLMs) — http://localhost:11434│
│   • Lean 4 + Mathlib (lake build)                │
│   • Python modules (data fetchers, backtesters)  │
└──────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ (ES2022) |
| Language | TypeScript (strict mode) |
| Backend server | Express.js, ws (WebSocket) |
| Agent backends | node-pty (claude-code), child_process (process), fetch (local-llm) |
| Terminal UI (optional) | xterm.js + WebGL |
| Database | SQLite via better-sqlite3 (`~/.plurics/plurics.db`) |
| File watching | chokidar v5 + manual polling fallback |
| Frontend | React 18, Vite |
| Layout | Allotment (resizable split panes) |
| Workflow definition | YAML (parsed via `yaml` package) |
| Formal verification (optional) | Lean 4.29.0 + Mathlib via elan/lake |
| Local LLM providers | Ollama (native API), vLLM/llama.cpp (OpenAI-compatible) |
| Testing | Vitest |

---

## Layer 1 — Platform

The platform provides general-purpose primitives that know nothing about
specific domains. It loads workflows, spawns agents, tracks state, persists
artifacts, and exposes a UI. Everything domain-specific is deferred to the
SDK (Layer 2) and workflow instances (Layer 3).

### 1.1 Project Structure

```
claude-agent-auto-manager/
  package.json                          # Monorepo root (npm workspaces)
  docs/architecture.md                   # This file
  workflows/                             # Layer 3 instances
  packages/
    server/src/
      app.ts                             # Entry point, routes, wiring
      db/
        database.ts                      # SQLite init + migrations
        workspace-repository.ts          # Workspace CRUD
        preset-repository.ts             # Agent preset CRUD
        workflow-repository.ts           # Run + event persistence
      modules/
        agents/                          # Agent backend layer (all three types)
          agent-backend.ts               # AgentBackend interface + types
          agent-registry.ts              # Unified multi-backend registry
          claude-code-session.ts         # node-pty PTY + ClaudeCodeSession
          process-session.ts             # child_process wrapper
          local-llm-session.ts           # HTTP client (OpenAI + Ollama native)
        knowledge/
          agent-bootstrap.ts              # .plurics/ directory management
          knowledge-watcher.ts            # Inbox notification injection
        workflow/
          types.ts                        # WorkflowConfig, DagNode, NodeSnapshot
          utils.ts                        # Atomic write, SHA-256, normalization, path helpers
          signal-validator.ts             # Signal schema + output integrity
          signal-watcher.ts               # Polling + chokidar, dedup
          yaml-parser.ts                  # Parse + cycle detection + deprecation warnings
          dag-executor.ts                 # Core DAG state machine + resume
          sdk.ts                          # WorkflowPlugin interface (Layer 2)
          evolutionary-pool.ts            # Pool manager (Layer 2)
          purpose-templates.ts            # Purpose generation + signal template
          preset-resolver.ts              # Filesystem + DB preset resolution
          input-types.ts                  # 12 DataSource types
          input-validator.ts              # Input manifest validation
      transport/
        protocol.ts                       # WebSocket message types (workflow:* only)
        websocket.ts                      # Message handler + workflow lifecycle
    web/src/
      App.tsx                             # Root: Sidebar + bottom DAG/Findings tabs
      types.ts                            # Shared protocol types
      services/
        websocket-client.ts               # Auto-reconnect WebSocket
      components/
        sidebar/
          Sidebar.tsx                     # WorkspaceSelector + WorkflowPanel
          WorkspaceSelector.tsx           # Directory autocomplete
        workflow/
          WorkflowPanel.tsx                # Controls + resumable runs list
          DagVisualization.tsx             # SVG DAG with pan/zoom
          FindingsPanel.tsx                # Real-time findings display
          SourceModal.tsx                  # Data source configuration
```

### 1.2 Agent Backend Abstraction

The platform supports three agent backend types, all conforming to a single
`AgentBackend` interface. The `AgentRegistry` dispatches to the correct
implementation based on the YAML node's `backend` field.

| Backend | Use case | Transport |
|---|---|---|
| `claude-code` | Creative/analytical agents (Claude Opus/Sonnet/Haiku) | node-pty → `claude --dangerously-skip-permissions` |
| `process` | Deterministic scripts (Python, `lake build`, data fetchers) | `child_process.spawn` with stdout/stderr capture |
| `local-llm` | Open-source models (reasoning, specialized) | HTTP to OpenAI-compatible (`/v1/chat/completions`) or Ollama native (`/api/chat`) |

**Signal generation:**
- `claude-code` agents write signal files themselves via shell commands (the agent sees the signal protocol in its purpose).
- `process` and `local-llm` backends don't write signals directly. The platform generates a signal from the `AgentResult` (exit code, stdout, artifacts) and writes it to the run directory, where the `SignalWatcher` picks it up naturally.

**Local LLM providers:**

The `LocalLlmSession` supports two API formats:
- **OpenAI-compatible** (default, `provider: openai`): for vLLM, llama.cpp, LM Studio
- **Ollama native** (`provider: ollama`): required for Qwen 3.5 / Goedel / DeepSeek-R1 where the `think: false` flag is needed to disable thinking mode (those models otherwise waste all tokens on reasoning prose and produce empty `content`)

### 1.3 DAG State Machine

```
pending ──► ready ──► spawning ──► running ──► validating ──► completed
                                        │             │
                                        ▼             ▼
                                     retrying ◄── retrying ──► failed
                                        │
                                        ▼
                                      ready   (on retry)

Also: pending ──► skipped (upstream_failed | budget_exhausted | template skip)
```

Features:
- **Timeout + retry**: per-node timeout with configurable retries. Previous error is injected into the retry purpose for self-correction.
- **Branch / fan-out**: `decision.goto` with optional `foreach` spawns scoped sub-DAGs. Each sub-DAG is an isolated copy of downstream nodes parameterized by a scope string.
- **Scope concurrency**: `max_parallel_scopes` limits how many distinct scopes can run in parallel. Nodes within an already-active scope are never blocked. The legacy name `max_parallel_hypotheses` is accepted as an alias for one release and triggers a deprecation warning at parse time.
- **Global cap**: `max_concurrent_agents` is a hard cap on total terminals/processes in `spawning`/`running`/`validating` state.
- **Template skip**: base nodes get marked `completed` automatically when scoped versions exist (they have no work to do).
- **Routing chain**: `decision.goto` → `plugin.onResolveRouting` → YAML branch rules fallback.
- **`depends_on_all`**: aggregator nodes wait for all scoped instances of named dependencies. The evaluation ignores the base template node when scoped versions exist.

### 1.4 State Persistence & Run Resume

Every state transition writes a `node-states.json` snapshot to the run
directory (debounced via `queueMicrotask`). The snapshot contains the complete
node graph **including dynamically created scoped nodes**.

**Resume flow** (`DagExecutor.resumeFrom(runId)`):

1. Load `node-states.json`
2. Rebuild full node graph (base + scoped) from snapshot
3. Recover signals from `.done.json` files on disk
4. Demote orphaned nodes (`running`/`spawning` without live process) to `ready`
5. Re-scan for signals written between crash and resume
6. Pre-populate `SignalWatcher.processedSignals` to avoid re-processing
7. Call `plugin.onWorkflowResume()` for domain state reconstruction
8. If present, restore `pool-state.json` into the `EvolutionaryPool`
9. Re-evaluate ready nodes and reschedule

### 1.5 Signal Protocol & Normalization Layer

Agents report completion by writing JSON signal files to `.plurics/shared/signals/`.
Signals use atomic write (`.tmp` + rename) and include SHA-256 checksums.

**Normalization layer** (`normalizeAgentSignal` in `utils.ts`) runs before
schema validation and centralizes all LLM output tolerances:
- Field aliases: `size` → `size_bytes`
- Path normalization via `normalizeAgentPath`: strips `.plurics/` prefix, converts `\` to `/`
- Decision flexibility: any object or string accepted; interpretation delegated to plugin

The purpose template includes a **literal JSON signal template** personalized
per-agent that reduces LLM field-naming errors. Generic signal protocol
instructions live in the YAML `shared_context` (read once per session).

### 1.6 Traceability

Each workflow run creates an isolated directory under `.plurics/runs/{runId}/`:

```
.plurics/runs/{runId}/
  purposes/          # Every agent's generated purpose.md (including retries)
  logs/              # Captured stdout/stderr per agent
  signals/           # Completion signal files
  findings/          # Human-readable finding reports (domain-specific)
  node-states.json   # Snapshot for run resume
  pool-state.json    # Evolutionary pool snapshot (if used)
  run-metadata.json  # Timing, config, summary
  input-manifest.json
```

`.plurics/shared` is a junction (Windows) or symlink (Linux) to the current run
directory — agents write to `shared/` as usual, traceability is automatic.

### 1.7 Frontend Philosophy

**The UI is an observability dashboard**, period. There is no terminal
multiplexer and no manual spawn affordance — humans cannot realistically
follow multiple Claude Code sessions in parallel, and any attempt to do so
was dead weight that we removed in the rebrand (−1524 LOC, bundle from
670 kB to 180 kB, 3.7x smaller).

The interface has exactly three concerns:

1. **Workflow controls** — workspace selector, YAML file picker, data source
   modal, start/pause/resume/stop buttons, resumable runs list
2. **DAG visualization** — horizontal left-to-right flow, state-colored nodes,
   pan/zoom, updates live via WebSocket `workflow:node-update` events
3. **Findings panel** — real-time collapsible list of finding reports with
   verdict badges, populated via `workflow:finding` events

All agent I/O is captured server-side in `.plurics/runs/{runId}/logs/` and
accessible via REST (`GET /api/workflows/runs/:runId/log/:agent`). Process
and local-llm backends run headless; claude-code backends use a PTY
internally but the PTY stream stays on the server — the browser never sees
it live. If you need to watch a single agent step-by-step for debugging,
read the log file directly.

---

## Layer 2 — SDK

The SDK is the contract between the platform and workflow instances. Plugins
implement hooks to inject domain-specific behavior at well-defined points,
and use helper modules (EvolutionaryPool) that the platform persists and
manages for them.

### 2.1 WorkflowPlugin Interface

Nine optional hooks:

| Hook | When called | Purpose |
|---|---|---|
| `onWorkflowStart` | Once before any agent spawns | Initialize registries, counters, directories, Lean project setup |
| `onWorkflowResume` | Once when resuming an interrupted run | Reconstruct plugin internal state from disk artifacts |
| `onSignalReceived` | After signal validation, before routing | Process signals with domain logic (e.g. copy files, update test budget, compact handoffs) |
| `onEvaluationResult` | After a signal from an evaluator node | Update the `EvolutionaryPool` based on the evaluation |
| `onEvolutionaryContext` | Before generator node purpose (rounds 2+) | Return pool context (positive/negative examples, confirmed findings) |
| `onPurposeGenerate` | Per agent spawn | Enrich agent purpose with domain context (data profile, handoffs, relevant columns) |
| `onEvaluateReadiness` | Per pending node per cycle | Custom readiness logic (aggregator nodes) |
| `onResolveRouting` | When `decision.goto` is absent and branch rules exist | Resolve domain-specific decisions to routing targets (including foreach fan-out) |
| `onWorkflowComplete` | Once at end | Cleanup, notifications |

`PurposeContext` passed to `onPurposeGenerate` includes: `scope`, `retryCount`,
`previousError`, `workspacePath`, `config`, `pool` (EvolutionaryPool instance),
and `round` (invocation count of the calling node).

### 2.2 AgentBackend Interface

```typescript
interface AgentBackend {
  readonly id: string;
  readonly name: string;
  readonly backendType: 'claude-code' | 'process' | 'local-llm';
  readonly info: AgentInfo;

  start(): Promise<void>;
  stop(): Promise<void>;
  isAlive(): boolean;

  inject(content: string): Promise<void>;
  onOutput(callback: (data: string) => void): () => void;
  onExit(callback: () => void): () => void;

  resize(cols: number, rows: number): Promise<void>;  // claude-code only
  write(data: string): void;                           // claude-code only

  getResult(): AgentResult | null;  // process/local-llm only
}
```

**`AgentConfig`** fields (YAML → backend selection):
- Common: `name`, `cwd`, `purpose`, `backend`
- `claude-code`: `command`, `effort`
- `process`: `processCommand` (array), `workingDir`, `env`
- `local-llm`: `endpoint`, `model`, `maxTokens`, `temperature`, `systemPrompt`, `provider` (`openai`|`ollama`), `disableThinking`

### 2.3 EvolutionaryPool

Population manager for discovery workflows. Maintains a pool of candidates
with fitness scores and lineage tracking.

```typescript
interface PoolCandidate {
  id: string;
  content: string;              // Natural language + formal representation
  fitness: { composite: number; dimensions: Record<string, number> };
  generation: number;           // Round when added
  parentIds: string[];          // Lineage
  status: 'pending' | 'testing' | 'confirmed' | 'falsified' | 'inconclusive' | 'superseded';
  metadata: Record<string, unknown>;  // Plugin-specific
  createdAt: number;
  updatedAt: number;
}
```

**Selection strategies**: `tournament`, `roulette`, `top-k`, `random`.

**Helpers**: `getConfirmed()`, `getFalsified()`, `getLineage(id)`,
`selectForContext(k)` (positive), `selectAsNegativeExamples(k)` (negative),
`computeCompositeFitness(dimensions, weights)`.

**Persistence**: `snapshot()` / `restore(snapshot)`. The platform writes
`pool-state.json` alongside `node-states.json` and restores it in `resumeFrom`.

### 2.4 SignalFile Schema

```typescript
interface SignalFile {
  schema_version: 1;
  signal_id: string;           // Unique per signal (dedup key)
  agent: string;               // Base agent name
  scope: string | null;        // Sub-DAG scope if applicable
  status: 'success' | 'failure' | 'branch' | 'budget_exhausted';
  decision: unknown;           // Domain-specific, interpreted by plugin
  outputs: Array<{ path: string; sha256: string; size_bytes: number }>;
  metrics: { duration_seconds: number; retries_used: number };
  error: { category: string; message: string; recoverable: boolean } | null;
}
```

The `decision` field is intentionally opaque to the platform. The routing
chain interprets it: first trying `decision.goto`, then delegating to
`plugin.onResolveRouting`, then falling back to YAML branch rules.

---

## Layer 3 — Workflow Instances

Each workflow instance lives in `workflows/{name}/` and is self-contained:

```
workflows/{instance-name}/
  workflow.yaml     # DAG definition, config, node backends
  plugin.ts         # WorkflowPlugin implementation
  schemas/          # Domain TypeScript types (optional)
  python/           # Python scripts for `process` backend nodes (optional)
  lean-template/    # Lean 4 project template (if applicable)
```

Agent presets (markdown files keyed by `preset: <name>` in YAML) are resolved
from a shared `workflows/presets/` tree, nested by workflow family, e.g.
`workflows/presets/sequence-explorer/conjecturer.md`. The `preset-resolver`
walks this tree at server startup and seeds the `agent_presets` table.

Five reference workflows ship with Plurics:

### 3.1 Research Swarm — `workflows/research-swarm/`

**Purpose**: autonomous statistical research on tabular datasets.

**Pipeline**: 14-agent DAG across 4 phases:
- **Phase 0 (Ingestion)**: Ingestor → Profiler
- **Phase 1 (Hypothesis screening)**: Hypothesist → Adversary → Judge (loop for more rounds)
- **Phase 2 (Validation)**: per-hypothesis fan-out: Architect → Coder → Auditor ⟷ Fixer → Executor → Falsifier
- **Phase 3 (Reporting)**: Generalizer → Reporter (writes finding.md)
- **Phase 4 (Synthesis)**: Meta-Analyst aggregates all findings

**Feedback loops**:
- Falsified hypotheses: Falsifier writes `rejection-reason.md` with reformulation suggestions. Branch routes back to Hypothesist round 2+.
- Hypothesist round 2+ reads both findings (positive context) and rejection-reasons (negative context).
- Code review loop: Auditor ⟷ Fixer iterates up to `max_audit_rounds`.

**Model selection**: Opus for reasoning (Hypothesist, Adversary, Judge, Architect, Auditor, Falsifier, Generalizer, Meta-Analyst); Sonnet for mechanical tasks (Ingestor, Profiler, Coder, Fixer, Executor, Reporter).

**E2E validated** (2026-04-09): 54/54 nodes completed in ~59 minutes on a synthetic number theory dataset (10K integers, 1.2K prime gaps, 39K digit distributions). 5 findings produced, final report generated by Meta-Analyst.

### 3.2 Math Discovery — `workflows/math-discovery/`

**Purpose**: formal mathematical discovery on financial time series. Combines empirical pattern mining with formal proof verification in Lean 4, gated by an operational backtest only after enough formally verified findings exist.

**Pipeline**: 14-node DAG across 3 phases:
- **Phase A (Empirical)**: OHLC Fetcher [process] → Profiler → Conjecturer → Critic → Selector
- **Phase B (Formal Verification, per-conjecture fan-out)**: Formalizer → Strategist → Prover [local-llm] → Lean check [process] → Counterexample search → Abstractor → Synthesizer
- **Phase C (Operational, gated)**: Backtest Designer → Backtester [process]

**Phase C gate**: the Synthesizer only routes to `backtest_designer` when
`min_confirmed_findings_for_backtest` findings exist in the pool. Otherwise
it loops back to the Conjecturer for another round.

**Mixed backends**: uses all three backend types:
- `claude-code`: Conjecturer, Critic, Selector, Formalizer, Strategist, Counterexample, Abstractor, Synthesizer, Backtest Designer
- `local-llm`: Prover (Goedel-Prover-V2 or similar, via vLLM or Ollama)
- `process`: OHLC Fetcher, Lean check (`lake build`), Backtester

**Evolutionary pool**: integrates `EvolutionaryPool` via the plugin's
`onEvaluationResult` and `onEvolutionaryContext` hooks. Fitness dimensions:
novelty, plausibility, formalizability, relevance.

**Prover self-correction loop**: the plugin manages the prover ⟷ lean_check
retry loop internally (avoiding explicit DAG back-edges). Up to
`prover_max_self_corrections` attempts, with compiler error feedback injected
on each retry.

**Incremental Lean project**: proved theorems are copied from
`Conjectures/` to `Theorems/` for reuse in subsequent proofs. Mathlib cache
(via Azure CDN) avoids rebuilding the library from scratch.

**Status**: implementation complete, requires local vLLM + OHLC fetcher Python module for E2E.

### 3.3 Theorem Prover Mini — `workflows/theorem-prover-mini/`

**Purpose**: minimal reference implementation of the formal verification
pattern (generator → formalizer → prover → compiler → reporter) with no
external data dependencies.

**Pipeline**: 5-node DAG:
```
conjecturer (claude-code/opus)
  ↓ generates 3 elementary theorems with fan-out
formalizer (claude-code/opus)
  ↓ writes Lean 4 statement with `sorry`
prover (claude-code/opus)                ← the variable backend node
  ↓ fills in the proof
lean_check (process/lake build)
  ↓ verifies
    ├─ proof_valid ──► reporter (claude-code/sonnet) ──► finding.md
    └─ proof_invalid ──► prover (retry with error context)
```

**Incremental Lean project lifecycle**: the plugin manages a standalone Lean
project at `{workspace}/lean-project/` (outside `.plurics/`) so that the Mathlib
build cache persists across runs. A `rebuildTheoremsIndex` helper keeps the
`Theorems.lean` aggregator in sync with the files present in `Theorems/`.

**File flow**: formalizer writes to `.plurics/shared/formalized/{SCOPE}.lean`;
the plugin's `onSignalReceived` copies to `lean-project/TheoremProverMini/Theorems/{snake_scope}.lean`
and rebuilds the aggregator index. The prover overwrites the same
`formalized/` file; the plugin applies the same copy.

**E2E validated** (2026-04-10, Claude Opus as prover):

| Stage | Duration (T-001) |
|---|---|
| Conjecturer (generates 3 theorems) | 90s |
| Formalizer.T-001 | 30s |
| Prover.T-001 (Claude Opus) | 50s |
| lean_check.T-001 (`lake build`) | 102s |
| Reporter.T-001 | 64s |
| **Total T-001 end-to-end** | **~337s** |

T-001 was the binomial identity `(n+m)² = n² + 2nm + m²`, proved with
`intro n m; ring` on the first attempt (no retries). The `workflow:finding`
event delivered the finding to the UI in real time.

**Known issues documented during the run**:

- **Goedel-Prover-V2-32B Q4_K_M GGUF (mradermacher)** is unusable as the
  `local-llm` prover backend. The quantized GGUF loses the original model's
  chat template, causing the model to loop on prosaic reasoning ("perhaps
  `ring_nf` is better for ℕ. Alternatively, perhaps...") and exhaust its
  token budget without producing a clean code block. This is a model-quality
  issue, not a workflow bug — validated by switching to Claude Opus, after
  which the same pipeline produced a verified proof on the first try.
- **`lean_check` timeout scaling**: 300s is sufficient for simple imports
  (`Mathlib.Tactic`) but insufficient when a theorem requires additional
  modules (e.g. `Mathlib.Algebra.BigOperators.Basic`) whose transitive
  dependencies have not yet been linked. Fix for future runs: raise
  `lean_check.timeout_seconds` to 900s or pre-import heavy modules in the
  `Theorems.lean` placeholder to amortize the cost.
- **Fan-out serialization**: `max_parallel_scopes: 1` correctly serializes
  scoped sub-DAGs when the local-llm backend is shared (Ollama processes one
  request per model at a time).

### 3.4 Sequence Explorer — `workflows/sequence-explorer/`

**Purpose**: evolutionary discovery of closed-form rules / recurrences for
integer sequences published in the [OEIS](https://oeis.org). A target OEIS
ID is fetched, profiled, then a round-based generator/verifier loop evolves
candidate formulas scored on empirical match, novelty, elegance, and
formalizability. The winning conjecture ships with extrapolated terms, a
cross-check against the OEIS catalog, and a human-readable finding report.

**Pipeline**: 10-node DAG with a round-loop back-edge:

```
sequence_fetch [process]           ← OEIS API fetch + manifest
  ↓
profiler [claude-code/sonnet]      ← growth + residues + recurrence fits
  ↓
conjecturer [claude-code/opus]     ← batch of N candidate rules
  ↓ (fan-out on decision.conjecture_ids)
┌────────────────────────────────────────────────┐
│ per-conjecture scope: C-001, C-002, …          │
│   formalizer [claude-code/sonnet]              │
│     ↓                                          │
│   quick_filter [local-llm/ollama qwen3.5:35b]  │
│     ↓                                          │
│   verifier [process: py verifier.py]           │
│     ↓                                          │
│   cross_checker [process: py cross_checker.py] │
│     ↓                                          │
│   critic [claude-code/opus]                    │
└────────────────────────────────────────────────┘
  ↓ (depends_on_all on critic — waits for every scope to finish)
selector [claude-code/opus]
  ├─ decision.status == "converged" ──► reporter
  └─ decision.status == "continue"  ──► conjecturer (next round)
```

**Config knobs** (workflow.yaml `config` block): `max_rounds`,
`conjectures_per_round`, `top_k_positive_context`, `negative_examples`,
`fitness_success_threshold`, `stagnation_rounds`, `verifier_timeout_seconds`,
`target_oeis_id`, `known_terms_limit`, `extrapolation_count`,
`max_parallel_scopes`, `max_concurrent_agents`, `local_llm_endpoint`,
`local_llm_model`.

**Mixed backends**: Sequence Explorer uses every backend type for a clean
cost/latency/quality split:
- `claude-code` (Opus): Conjecturer (creative), Critic (evaluation), Selector
  (round control), Reporter (synthesis)
- `claude-code` (Sonnet): Profiler, Formalizer (mechanical Python generation)
- `local-llm` (Ollama, `qwen3.5:35b` with `disable_thinking: true`):
  quick_filter — a cheap sanity pass that rejects obviously broken Python
  before CPU is spent on the subprocess verifier
- `process`: `sequence_fetch` (OEIS fetcher), `verifier` (subprocess sandbox
  executing the formalized `sequence(n)` function against known terms),
  `cross_checker` (OEIS novelty lookup)

**Evolutionary pool**: integrates Layer 2's `EvolutionaryPool` via the
plugin's `onEvaluationResult` and `onEvolutionaryContext` hooks. Fitness
dimensions and default weights:

| Dimension | Weight | Source |
|---|---|---|
| `empirical` | 0.4 | verifier.py — fraction of known OEIS terms matched |
| `novelty` | 0.3 | cross_checker.py verdict (novel 1.0 / related 0.6 / rediscovery 0.1) |
| `elegance` | 0.2 | heuristic on formalized Python (lines, conditionals, imports) |
| `provability` | 0.1 | conjecture type heuristic (closed_form 0.9 .. asymptotic 0.3) |

**Lineage tracking**: in round ≥ 2 the plugin injects top-k positive examples
(confirmed or high-fitness) and k negative examples (falsified) into the
conjecturer purpose, and instructs it to set `parent_ids` on any conjecture
built from a parent. `getLineage(id)` walks the parent chain at report time.

**Python tooling as a process backend**: `sequence_fetch`, `verifier`, and
`cross_checker` are deterministic Python scripts (not LLMs). The plugin
copies them from `workflows/sequence-explorer/python/` into
`{workspace}/.plurics/tools/` on `onWorkflowStart` and `onWorkflowResume`, so
each process invocation reads fresh from disk. Live patches to these scripts
(bug fix → `cp` to `.plurics/tools/`) propagate to all scoped sub-DAGs in
subsequent rounds without restarting the run.

**Safety model for the verifier**: formalizer output is dynamically loaded
by the child subprocess (`importlib.util.spec_from_file_location`) and
executed with a 10-second wall clock. `socket.socket` is stubbed to a
no-op (best-effort; Windows has no `resource.setrlimit`). The child
captures exceptions per term rather than crashing, so a single bad
`sequence(n)` call is recorded as `first_mismatch_*` fields instead of
taking down the node.

**E2E validation** (2026-04-11, target A000045 / Fibonacci):

| Stage | Wall-clock | Notes |
|---|---|---|
| `sequence_fetch` | 4 s | First run; OEIS fetch + cache |
| `profiler` (Sonnet) | 283 s | Growth analysis + recurrence fits + leads |
| `conjecturer` round 1 (Opus) | 92 s | 5 conjectures C-001..C-005 |
| Fan-out formalizer (Sonnet × 5) | ~50 s first, ~23 min last (serialized) | Ollama's single-model serialization propagates back through the fan-out |
| `quick_filter` × 5 (Qwen 3.5:35b) | ~35 s each | All 5 accepted |
| `verifier` × 5 (Python subprocess) | ~6 s each | All 5: `empirical_score = 1.0` against all 30 known Fibonacci terms |
| `cross_checker` × 5 (OEIS API) | ~55 s each | — |
| `critic` × 5 (Opus) | ~60 s each | All 5 rated `keep`, all 5 rediscovery of A000045 |
| **Round 1 total** | **~27 min** | Before selector decision |

**Bugs surfaced and fixed during the run** — four issues across all three
layers, the most severe of which was a latent Layer 1 bug that had been
invisible until Sequence Explorer became the first workflow to fan out a
`process` backend through a scoped sub-DAG:

1. **Layer 1 — scoped-node backend config lost** (`dag-executor.ts:648`):
   when spawning a scoped node like `cross_checker.C-002`, `spawnAgent`
   looked up the YAML node definition by the full scoped name, which does
   not exist as a YAML key (only the base name `cross_checker` does). The
   lookup returned `undefined`, `backendType` fell through to the
   `'claude-code'` default, and the scheduler silently spawned every
   scoped `verifier` / `cross_checker` / `quick_filter` / `formalizer` as a
   Claude Code PTY session instead of the backend declared in the YAML.
   Symptoms: per-scope log files 80–170 KB of terminal escape sequences
   instead of 172 B of Python stdout; Claude Opus agents dutifully reading
   the `process` preset ("the platform runs this script on your behalf")
   and then executing `py .plurics/tools/cross_checker.py` manually via
   shell tools anyway, producing the correct JSON but with non-trivial
   latency and the occasional orphaned `.tmp` signal when the shell
   mv step was interrupted. Fix: strip the scope suffix before the YAML
   lookup and prefer the base-name definition. The same base-name lookup
   bug was present at `dag-executor.ts:470` for `depends_on_all`
   evaluation; fixed in the same commit. `research-swarm` and
   `math-discovery` were unaffected because their fan-out nodes are all
   `claude-code` backends, so the fallback happened to return the right
   value by coincidence; this bug had been latent since the fan-out
   feature landed.

2. **Layer 3 — `sequence_fetcher.py` crash** (`'list' object has no
   attribute 'get'`): the OEIS JSON endpoint returns a bare top-level
   `list`, not a `{"results": [...]}` wrapper. Fix: handle both shapes.
   Retryable via signal, so two auto-retries consumed before the fix
   landed.

3. **Layer 3 — `cross_checker.py` crash** (same signature, same root
   cause): the cross-checker wrote `verdict: "inconclusive"` with
   `notes: "OEIS query error: 'list' object has no attribute 'get'"` — the
   pipeline kept flowing because cross-check failures are expected (network
   errors degrade gracefully), but novelty scores for all 5 conjectures
   defaulted to the 0.5 inconclusive fallback instead of 0.1 rediscovery.
   Fix: same list/dict dispatch as the fetcher.

4. **Layer 3 — `verifier.py` symbolic-eval noise**: every
   verification.json had a non-null `sympy_error` because the verifier was
   calling `sequence(sympy.Symbol('n'))` to extract a closed form from the
   formalizer-generated Python. Three failure modes observed across the 5
   candidates:
   - `RecursionError: maximum recursion depth exceeded` — for `lru_cache`-d
     recursive implementations where the `if n == 0` base case never
     triggers on a symbol
   - `TypeError: Cannot round symbolic expression` — for closed-form
     implementations that use `int(round(...))` (e.g. Binet's formula)
   - `TypeError: 'Add' object cannot be interpreted as an integer` — for
     implementations using `math.comb(2*n, n)` or `range()` on a symbol

   The symbolic eval was a best-effort nice-to-have that failed ~100% of
   the time because it was in direct tension with the formalizer's style
   rules (`lru_cache`, `int(round(...))`, `math.comb`). It added no value:
   empirical score already proves correctness, the cross-checker already
   handles novelty, and the critic already scores elegance from the Python
   source. Fix: remove the symbolic eval block entirely and drop
   `sympy_closed_form` / `sympy_error` from both the runtime schema and
   `schemas/verification.ts`.

**Live-patching policy** (validated during this run): because the verifier
and cross_checker run as fresh subprocesses per scope, patching the
installed scripts (`test-data/.plurics/tools/*.py`) during the run is safe
— all subsequent scope invocations in later rounds pick up the fix without
a restart. The plugin's `installPythonTools` (called from
`onWorkflowStart` and `onWorkflowResume`) handles the normal case of
re-syncing from `workflows/sequence-explorer/python/` at (re)startup. This
policy does not apply to Layer 1 fixes like the scoped-node backend bug,
which required a TypeScript edit and `tsx watch` hot reload of the server.

**Observed design wins from this run**:
- The `depends_on_all` aggregator on `critic` → `selector` is the right
  abstraction for round boundaries: once the Layer 1 bug is fixed, the
  selector will only fire after every scoped critic completes. The wiring
  works even when fan-out is serialized behind Ollama's single-model queue.
- The plugin's `onPurposeGenerate` tiered injection (OEIS manifest for
  profiler, target + profile + lineage for conjecturer, scope artifacts
  for critic, pool summary for selector, winner artifacts for reporter)
  kept agent purposes bounded even as the pool grew.
- The three-layer separation made root-causing tractable: each bug's fix
  site was unambiguous and local. The Layer 1 fix was 6 lines in
  `spawnAgent`; the Layer 3 fixes were 3–15 lines per Python file; no
  cross-layer shims were needed.

**Run outcome**: the 4-hour run hit the safety timeout with 4/5 critics
completed in round 1 (C-001, C-003, C-004, C-005 all `keep` / rediscovery)
and the selector still blocked waiting on `critic.C-002`, which was itself
blocked behind `cross_checker.C-002` stuck in `running` with an orphaned
`.tmp` signal — all downstream effects of the Layer 1 bug. The Layer 1
fix lands after the run; the next invocation will be the clean E2E.

### 3.5 Smoke Test — `workflows/smoke-test/`

**Purpose**: minimal validation of the three backend types end-to-end.

**Pipeline**: 3-node linear DAG:
1. `echo_node` [process] — `powershell Write-Output 'hello'` (~2s)
2. `writer` [claude-code/sonnet] — writes a sentence about primes (~30s)
3. `reviewer` [local-llm/ollama] — Qwen 3.5:35b reviews with `think: false` (~0.6s)

**E2E validated** (2026-04-10): 3/3 nodes completed in 34s. Reviewer responded
"APPROVED" with 4 tokens. This was the run that surfaced two bugs later fixed:
- `LocalLlmSession.inject()` needed `onExit` registered before the fetch call (race for fast completions)
- Qwen 3.5 reasoning mode exhausts `max_tokens` in thinking before producing `content`, requiring Ollama native API with `think: false` (OpenAI-compat endpoint cannot disable thinking)

---

## Database

SQLite at `~/.plurics/plurics.db` with WAL journal mode.

| Table | Purpose |
|---|---|
| `workspaces` | Saved workspace paths with usage stats |
| `workspace_agents` | Agent configurations per workspace |
| `agent_presets` | Reusable purpose templates (cross-project) |
| `workflow_runs` | Workflow execution history (YAML content preserved for resume) |
| `workflow_events` | Per-node state transition log |

---

## REST API

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/terminals` | GET | List active terminals (claude-code backends only) |
| `/api/validate-path` | POST | Check directory exists |
| `/api/list-dirs` | GET | Directory autocomplete |
| `/api/list-files` | GET | List files by extension in directory |
| `/api/workspaces` | GET/POST | Workspace CRUD |
| `/api/workspaces/:id` | PUT/DELETE | Workspace update/delete |
| `/api/workspaces/:id/select` | POST | Mark workspace used |
| `/api/agent-presets` | GET/POST | Preset CRUD |
| `/api/agent-presets/:id` | PUT/DELETE | Preset update/delete |
| `/api/agent-presets/seed` | POST | Import presets from filesystem |
| `/api/workflow-files` | GET | List workflow YAML files |
| `/api/workflow-files/:name` | GET | Read workflow YAML content |
| `/api/workflows` | GET | Workflow run history |
| `/api/workflows/:id` | GET | Workflow run details + events |
| `/api/workflows/runs/resumable` | GET | List interrupted runs that can be resumed |
| `/api/workflows/runs/:runId/log/:agent` | GET | Agent terminal log |
| `/api/workflows/runs/:runId/purpose/:agent` | GET | Agent purpose file |
| `/api/workflows/runs/:runId/metadata` | GET | Run metadata + summary |
| `/api/workflows/runs/:runId/findings` | GET | Finding reports for a run |

---

## WebSocket Protocol

Single multiplexed connection per browser client on `/ws`.

| Client → Server | Description |
|---|---|
| `terminal:spawn` | Manual spawn (always creates a claude-code backend) |
| `terminal:input` / `terminal:resize` / `terminal:kill` / `terminal:subscribe` / `terminal:list` | Terminal ops for claude-code backends |
| `workflow:start` | Begin a new workflow run (with optional `inputManifest`) |
| `workflow:abort` | Abort a running workflow |
| `workflow:pause` / `workflow:resume` | Suspend/continue scheduling |
| `workflow:status` | Query current state |
| `workflow:resume-run` | Resume an interrupted run from snapshot |

| Server → Client | Description |
|---|---|
| `terminal:output` / `terminal:created` / `terminal:exited` / `terminal:list` | Terminal events |
| `workflow:started` | Initial snapshot sent to client |
| `workflow:node-update` | State transition event |
| `workflow:completed` | Run finished (or aborted) with summary |
| `workflow:paused` / `workflow:resumed` | Pause/resume acknowledgments |
| `workflow:finding` | Real-time finding emission (content + hypothesis/theorem ID) |
| `error` | Protocol or validation error |

---

## Windows-Specific Considerations

- **chokidar + NTFS junctions**: chokidar with recursive globs does not reliably follow NTFS junctions. Signal detection uses dual mechanism: chokidar (fast-path) + 2-second polling fallback (reliable). Both deduplicate via `processedSignals` Set.
- **Symlinks**: `.plurics/shared` uses `junction` type (no admin required). Falls back to a real directory if junction creation fails.
- **Shell**: node-pty spawns `powershell.exe` on Windows, `bash` elsewhere.
- **Path normalization**: `normalizeAgentPath` converts backslashes to forward slashes and strips duplicate `.plurics/` prefixes — applied everywhere agent-written paths are consumed.
- **Claude Code v2.1.100+**: slash command autocomplete intercepts programmatic `/compact` injection. The DAG executor no longer uses `/compact`; the `effort` config field is a no-op for `claude-code` backends.
- **Ollama on Windows**: installed at `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`. Must be started with `ollama serve` (no `ollama app.exe` wrapper when running in background).
- **Lean 4 on Windows**: install via elan (`iwr -useb https://raw.githubusercontent.com/leanprover/elan/master/elan-init.ps1 | iex`). Toolchain pins to `leanprover/lean4:v4.29.0`; Mathlib cache via `lake exe cache get` downloads precompiled oleans from Azure CDN.

---

## Ports

| Port | Service |
|---|---|
| 11000 | Vite dev server (frontend + proxy) |
| 11001 | Express + WebSocket server (backend) |
| 11434 | Ollama (if using `local-llm` backend with Ollama) |
| 8000 | vLLM (if using `local-llm` backend with vLLM, default) |

---

## Design Invariants

1. **Layer 1 never knows the domain**: the DagExecutor, SignalWatcher, YAML parser, and frontend must work identically for research hypotheses, mathematical theorems, or any other domain. Domain logic lives in plugins.
2. **Signals are append-only and self-contained**: once written, a signal file is never modified. The `signal_id` is a unique dedup key. Plugins interpret `decision` but never mutate signals.
3. **The platform serializes what the plugin allows**: `max_parallel_scopes` and `max_concurrent_agents` are enforced by the scheduler. Plugins can further constrain via `onEvaluateReadiness`.
4. **Snapshots are the source of truth for resume**: the only thing that must survive a crash is `node-states.json` and `pool-state.json`. Everything else (terminal state, timers, plugin internal state) is recomputable.
5. **Agents are stateless between invocations**: each retry spawns a fresh agent with a fresh purpose. State is transmitted via filesystem (shared workspace, signal files, handoff files).
6. **One signal per completion**: the platform expects exactly one signal per scheduled invocation. Multiple signals from the same agent invocation cause undefined behavior.
