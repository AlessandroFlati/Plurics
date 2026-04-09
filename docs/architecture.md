# Claude Agent Auto Manager (CAAM) - Architecture Document

Last updated: 2026-04-09 07:47 UTC

## Overview

CAAM is a web-based platform for managing multiple Claude Code terminal sessions as a coordinated agent network. It provides a browser-based IDE-like interface where each pane hosts an autonomous Claude Code agent. Agents communicate through filesystem-based messaging and can be orchestrated by a DAG workflow engine.

The platform is general-purpose: any multi-agent pipeline can be defined as a YAML workflow with reusable agent presets. A research data analysis swarm is included as an example use case.

## Architecture

```
+--------------------------------------------------+
|  Browser (localhost:11000)                        |
|                                                   |
|  +----------+  +------------------------------+  |
|  | Sidebar  |  | Terminal Grid (split panes)   |  |
|  | Workspace|  |  +--------+  +--------+      |  |
|  | Terminals|  |  | Agent1 |  | Agent2 |      |  |
|  | Workflow  |  |  +--------+  +--------+      |  |
|  | Controls |  +------------------------------+  |
|  +----------+  | Bottom Panel (tabs)            |  |
|                |  [DAG] [Findings]               |  |
|                +------------------------------+  |
+--------------------------------------------------+
        |  WebSocket + REST API (Vite proxy)
        v
+--------------------------------------------------+
|  Server (localhost:11001)                         |
|                                                   |
|  Express HTTP + WebSocket                         |
|  +-- TerminalRegistry (node-pty sessions)         |
|  +-- AgentBootstrap (.caam/ dirs, purpose.md)     |
|  +-- KnowledgeWatcher (chokidar inbox injection)  |
|  +-- DagExecutor (workflow state machine)          |
|  +-- SignalWatcher (polling + chokidar)            |
|  +-- PresetResolver (filesystem + DB)              |
|  +-- NormalizationLayer (LLM output tolerance)     |
|  +-- SQLite (workspaces, presets, workflow runs)    |
+--------------------------------------------------+
```

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES2022) |
| Language | TypeScript (strict mode) |
| Backend | Express.js, ws (WebSocket) |
| Terminal | node-pty (server), xterm.js + WebGL (client) |
| Database | SQLite via better-sqlite3 (`~/.caam/caam.db`) |
| File watching | chokidar + manual polling fallback |
| Frontend | React 18, Vite |
| Layout | Allotment (resizable split panes) |
| Workflow | YAML-defined DAG, filesystem-based signals |
| Testing | Vitest |

## Project Structure

```
claude-agent-auto-manager/
  package.json                          # Monorepo root (npm workspaces)
  workflows/
    research-swarm/
      workflow.yaml                     # 14-node research analysis pipeline
      plugin.ts                         # WorkflowPlugin (BH correction, manifest slicing)
      presets/                          # 14 agent purpose templates
        ingestor.md ... reporter.md
      schemas/                          # Domain types (hypothesis DSL, manifest, etc.)
    presets/
      research/                         # Preset resolution fallback directory
  test-data/
    run-e2e.js                          # WebSocket-based E2E test runner
    input-manifest.json                 # Test dataset configuration
    *.parquet                           # Synthetic number theory dataset
  packages/
    server/src/
      app.ts                            # Entry point, routes, wiring
      db/
        database.ts                     # SQLite init + migrations
        workspace-repository.ts         # Workspace CRUD
        preset-repository.ts            # Agent preset CRUD
        workflow-repository.ts          # Run + event persistence + resumable runs
      modules/
        terminal/
          types.ts                      # TerminalInfo, TerminalConfig
          terminal-session.ts           # PTY process wrapper (node-pty)
          terminal-registry.ts          # Session registry + callbacks
        knowledge/
          agent-bootstrap.ts            # .caam/ directory management
          knowledge-watcher.ts          # Inbox notification injection
        workflow/
          types.ts                      # Signal, DagNode, WorkflowConfig, NodeSnapshot
          utils.ts                      # Atomic write, SHA-256, sleep, normalization
          signal-validator.ts           # Signal schema + output integrity
          signal-watcher.ts             # Polling + chokidar, dedup, pre-populate
          yaml-parser.ts                # Parse + validate + cycle detection
          dag-executor.ts               # DAG state machine + resume + snapshot
          sdk.ts                        # WorkflowPlugin interface (7 hooks)
          purpose-templates.ts          # Purpose generation + literal JSON template
          preset-resolver.ts            # Filesystem + DB preset resolution
          input-types.ts                # 12 DataSource types
          input-validator.ts            # Input manifest validation
      transport/
        protocol.ts                     # WebSocket message types
        websocket.ts                    # Message handler + workflow lifecycle
    web/src/
      App.tsx                           # Root: layout, state, WebSocket, bottom tabs
      types.ts                          # Shared protocol types
      theme.css                         # Design tokens (dark theme)
      services/
        websocket-client.ts             # Auto-reconnect WebSocket
      stores/
        terminal-store.ts               # React external store (useSyncExternalStore)
      components/
        sidebar/
          TerminalManager.tsx           # Workspace, spawn, terminal list, workflow
          WorkspaceSelector.tsx          # Directory autocomplete
          SpawnModal.tsx                 # Purpose editor + preset quicklist
        grid/
          SplitLayout.tsx               # Recursive split-pane renderer
          PaneToolbar.tsx               # Split/close buttons (SVG icons)
          EmptySlot.tsx                 # Empty pane placeholder
          split-tree.ts                # Binary tree layout functions
        terminal/
          TerminalPane.tsx              # xterm.js wrapper + resize
        workflow/
          WorkflowPanel.tsx             # Sidebar controls, resumable runs list
          DagVisualization.tsx           # SVG DAG with pan/zoom
          FindingsPanel.tsx             # Real-time findings display
          SourceModal.tsx               # Data source configuration (12 types)
```

---

## Terminal Management

### PTY Sessions

Each terminal wraps a `node-pty` pseudo-terminal process. On Windows it spawns `powershell.exe`; on Linux/macOS it spawns `bash`. The actual command (e.g., `claude --dangerously-skip-permissions`) is deferred until the client reports terminal dimensions (first `resize` event), preventing TUI apps from rendering at wrong dimensions.

For headless workflow terminals (no browser client), the DAG executor sends `resize(120, 30)` programmatically and uses `waitForOutput` to detect when Claude Code is ready before injecting the purpose prompt.

### waitForOutput

```typescript
waitForOutput(session, /bypass permissions|>\s*$/i, { timeout: 30000 })
```

Polls terminal output for a regex match. When Claude Code displays "bypass permissions" (its input readiness indicator), the purpose is injected. Falls back to injection after 30s timeout. Replaces the previous fixed 5-second delay.

### Terminal Registry

In-memory `Map<id, TerminalSession>` with:
- `getByName(name)` for inbox notification injection
- `listWithPurpose()` for agents.md regeneration
- `onSpawn(callback)` / `onTerminalExit(callback)` for workflow hooks
- `onTerminalExitById(id, callback)` for DAG executor crash detection
- `onOutput(id, callback)` for log capture

### WebSocket Protocol

Single multiplexed connection per browser client on `/ws`.

| Category | Messages |
|---|---|
| Terminal | `spawn`, `input`, `resize`, `kill`, `subscribe`, `list` |
| Workflow | `start`, `abort`, `pause`, `resume`, `status`, `resume-run` |
| Server -> Client | `started`, `node-update`, `completed`, `paused`, `resumed`, `finding` |

---

## Agent Communication

### Filesystem-Based Messaging

Each workspace has a `.caam/` directory:

```
<workspace>/.caam/
  shared/                           # Symlink to current run directory
    agents.md                       # Auto-generated active agent registry
    context.md                      # Free-form shared context
    signals/                        # Workflow completion signals (*.done.json)
    findings/                       # Human-readable finding reports (*.md)
    data/                           # Workflow-specific data artifacts
  agents/
    <name>/
      purpose.md                    # Agent instructions + communication protocol
      inbox.md                      # Messages from other agents (append-only)
  runs/
    run-<timestamp>-<hex>/          # Per-run isolated directory
      purposes/                     # Saved purpose.md per agent
      logs/                         # Terminal output capture
      signals/                      # Signal files for this run
      findings/                     # Finding reports for this run
      node-states.json              # Snapshot for run resume
      run-metadata.json             # Timing, config, summary
      input-manifest.json           # Input data sources
```

### Agent Bootstrap

When an agent spawns (manually or via workflow):
1. Creates `.caam/agents/<name>/purpose.md` with user content + communication template
2. Creates empty `inbox.md`
3. Regenerates `shared/agents.md` with all active agents
4. Waits for Claude Code readiness via `waitForOutput`, then injects purpose prompt

### Inbox Notifications

`KnowledgeWatcher` uses chokidar to watch `agents/*/inbox.md`. When a file changes, it debounces (300ms) and injects `[CAAM] New message in your inbox` into the target terminal.

### Agent Presets

Presets are reusable purpose templates stored in SQLite (`agent_presets` table) for cross-project reuse. On startup, the server auto-seeds presets from `workflows/presets/` on the filesystem. The `SpawnModal` UI shows presets sorted by usage frequency.

---

## Workflow Orchestration

### Three-Layer Architecture

```
Layer 3: Workflow Instance    workflows/research-swarm/
  workflow.yaml, presets/, schemas/, plugin.ts

Layer 2: Workflow SDK         packages/server/src/modules/workflow/sdk.ts
  WorkflowPlugin interface, 7 hook points, lifecycle contracts

Layer 1: CAAM Platform        packages/server/ + packages/web/
  Terminals, signals, DAG executor, UI (domain-agnostic)
```

**Layer 1 (Platform)** owns terminal management, signal protocol, DAG state machine, YAML parsing, normalization layer, and the frontend. It has no knowledge of what agents do inside their terminals.

**Layer 2 (SDK)** defines the `WorkflowPlugin` interface with 7 hook points.

**Layer 3 (Instance)** is a self-contained directory with workflow YAML, agent presets, domain schemas, and a plugin that implements the hooks with domain-specific logic.

### Plugin System

Workflows can specify a `plugin` field in their YAML. The DAG executor dynamically imports the plugin at workflow start and calls its hooks at defined points:

| Hook | When Called | Purpose |
|---|---|---|
| `onWorkflowStart` | Once before any agent spawns | Initialize domain registries, counters, directories |
| `onWorkflowResume` | Once when resuming an interrupted run | Reconstruct plugin internal state from disk artifacts |
| `onSignalReceived` | After signal validation | Process signals with domain logic (e.g., update test budget) |
| `onPurposeGenerate` | Per agent spawn | Enrich agent purpose with domain context (e.g., data manifest slices) |
| `onEvaluateReadiness` | Per pending node per cycle | Custom readiness logic for aggregator nodes |
| `onResolveRouting` | When `decision.goto` is absent | Resolve domain-specific signal decisions to routing targets |
| `onWorkflowComplete` | Once at end | Cleanup, notifications |

### Signal Protocol

Agents report completion by writing JSON signal files to `.caam/shared/signals/`. Signals use atomic write (`.tmp` + rename) and include SHA-256 checksums for output integrity.

The purpose template includes a **literal JSON signal template** that agents can copy and fill, reducing LLM field-naming errors:

```json
{
  "schema_version": 1,
  "signal_id": "sig-YYYYMMDDTHHMMSS-agentName-XXXX",
  "agent": "agentName",
  "scope": null,
  "status": "success",
  "decision": null,
  "outputs": [{ "path": "shared/path/to/output.json", "sha256": "...", "size_bytes": 0 }],
  "metrics": { "duration_seconds": 0, "retries_used": 0 },
  "error": null
}
```

### Normalization Layer

Since agents are LLMs (not deterministic code), their output varies. A centralized normalization layer (`normalizeAgentSignal` in `utils.ts`) runs **before** schema validation:

- **Field aliases**: `size` -> `size_bytes`
- **Path normalization**: strips `.caam/` prefix, converts `\` to `/` (`normalizeAgentPath`)
- **Decision flexibility**: any object or string accepted; interpretation delegated to plugin

### Routing Chain

When a node completes with a branch decision, routing follows a three-step chain:

1. **`decision.goto`** — If the agent's signal includes an explicit `goto` field, use it directly
2. **`plugin.onResolveRouting`** — If no `goto`, ask the plugin to interpret the domain-specific decision
3. **Branch rules fallback** — Use the first matching branch rule from the YAML definition

### DAG State Machine

```
pending -> ready -> spawning -> running -> validating -> completed
                                  |            |
                                  v            v
                               retrying     retrying -> failed

Also: pending -> skipped (upstream_failed or budget_exhausted)
```

Features:
- **Timeout**: configurable per-node, triggers retry
- **Retry with context**: previous error injected into retry purpose
- **Branch**: `decision.goto` routing with plugin fallback
- **Fan-out**: `foreach` field spawns scoped sub-DAGs per item
- **Scope concurrency**: `max_parallel_hypotheses` limits concurrent scopes (not nodes within scopes)
- **Agent hard cap**: `max_concurrent_agents` limits total terminals system-wide
- **Namespace guard**: output path containment per scope
- **Per-node model**: `model: opus|sonnet|haiku` maps to Claude model IDs
- **Effort level**: `effort: low` injects `/compact` before purpose for faster execution

### Concurrency Model

Two independent limits control parallelism:

1. **Scope concurrency** (`max_parallel_hypotheses`): limits how many distinct scoped sub-DAGs can be active simultaneously. Nodes within an already-active scope are always allowed to proceed.
2. **Agent hard cap** (`max_concurrent_agents`): global limit on total terminals in `spawning`/`running`/`validating` state. When reached, nodes stay in `ready` until a slot opens.

Worst case without hard cap: with 3 active scopes each running architect+coder+auditor+executor in overlapping phases, up to ~12 agents may be concurrent.

### State Persistence & Run Resume

Every state transition writes a `node-states.json` snapshot to the run directory (debounced via `queueMicrotask`). The snapshot contains the complete node graph including dynamically created scoped nodes.

**Resume flow** (`DagExecutor.resumeFrom(runId)`):

1. Load `node-states.json` snapshot from disk
2. Rebuild full node graph (base + scoped nodes) from snapshot
3. Recover signals from `.done.json` files on disk
4. Demote orphaned nodes (`running`/`spawning` without live terminal) to `ready`
5. Re-scan for signals written between crash and resume (race condition recovery)
6. Pre-populate `SignalWatcher.processedSignals` with known signal IDs
7. Call `plugin.onWorkflowResume()` for domain state reconstruction
8. Re-evaluate ready nodes and reschedule

### Workflow YAML

```yaml
name: my-pipeline
version: 1
plugin: ./plugin.ts
config:
  agent_timeout_seconds: 300
  max_parallel_hypotheses: 3      # Scope concurrency
  max_concurrent_agents: 8        # Hard cap on total terminals
  custom_domain_key: 42           # Passed through to plugin
shared_context: |
  Instructions for all agents.
nodes:
  step_a:
    preset: presets/step-a
    depends_on: []
    model: sonnet                  # Per-node model selection
    effort: low                    # Injects /compact before purpose
    timeout_seconds: 600
  step_b:
    preset: presets/step-b
    depends_on: [step_a]
    branch:
      - condition: "ready"
        goto: step_c
        foreach: items
    max_invocations: 3
```

### Preset Resolution

1. Filesystem: `workflows/presets/{name}.md` (relative to workflow YAML)
2. Database: `agent_presets` table
3. Fallback: generic description

Templates use `{{PLACEHOLDER}}` syntax resolved at spawn time. All config values are available as uppercase placeholders (e.g., `{{ROUND}}`, `{{SCOPE}}`).

---

## Frontend

### Layout

```
+--sidebar--+---main area----------------------------+
| Workspace  | Terminal Grid (Allotment split panes)   |
| Terminals  |   +----------+  +----------+           |
| Spawn Btn  |   | Agent 1  |  | Agent 2  |           |
| Term List  |   +----------+  +----------+           |
|            +----------------------------------------+
| Workflow   | Bottom Panel (tabbed)                   |
| File Pick  |  [DAG] [Findings (N)]                   |
| Sources    |  DAG: SVG nodes with state colors       |
| Start/Stop |  Findings: collapsible list per hyp.    |
| Resume     |                                         |
+------------+----------------------------------------+
```

- **Sidebar**: workspace selector, spawn agent button, terminal list, workflow controls (file picker, data sources, start/pause/resume/stop), resumable runs list
- **Terminal grid**: resizable split panes (Allotment), binary tree layout
- **Bottom panel**: tabbed view with DAG visualization and Findings panel

### DAG Visualization

SVG-based horizontal left-to-right layout via Kahn's topological sort. State-colored nodes (gray=pending, yellow=running, green=completed, red=failed, dimmed=skipped). Pan with mouse drag, zoom with wheel towards cursor, auto-fit centered on mount.

### Findings Panel

Real-time display of hypothesis findings as they complete the pipeline. Each finding shows:
- Hypothesis ID and title (extracted from markdown heading)
- Verdict badge (CONFIRMED=green, CONFIRMED WITH RESERVATIONS=orange, NOT CONFIRMED=gray, FALSIFIED=red)
- Collapsible full content (markdown)

Findings arrive via `workflow:finding` WebSocket events and are also loadable via REST endpoint for reconnection.

### State Management

- Terminal state: React external store (`useSyncExternalStore`)
- Layout state: binary tree in `useState`, synced with terminal state via `useEffect`
- Workflow state: custom `useWorkflowState` hook, shared between sidebar, DAG panel, and findings panel. Tracks: yaml, runId, nodes, summary, error, paused, findings.

### Design System

Dark theme with CSS custom properties: 4-layer surface hierarchy, 3-tier text, semantic colors (success/warning/error), Inter font for UI, monospace for terminals.

---

## Database

SQLite at `~/.caam/caam.db` with WAL journal mode.

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
| `/api/terminals` | GET | List active terminals |
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

## Ports

| Port | Service |
|---|---|
| 11000 | Vite dev server (frontend + proxy) |
| 11001 | Express + WebSocket server (backend) |

---

## Example Use Case: Research Data Analysis Swarm

CAAM includes a complete 14-agent research pipeline (`workflows/research-swarm/workflow.yaml`) as a reference implementation:

**Phase 0 -- Ingestion**: Ingestor (format detection, normalization) -> Profiler (EDA, data manifest)

**Phase 1 -- Hypothesis Screening**: Hypothesist (structured hypothesis generation, reads findings + rejection-reasons in rounds 2+) -> Adversary (adversarial review) -> Judge (filter + routing, loops back for more if needed)

**Phase 2 -- Validation**: Per-hypothesis fan-out: Architect (test design) -> Coder (script implementation) -> Auditor <-> Fixer (code review loop) -> Executor (script execution) -> Falsifier (robustness testing, writes rejection-reason.md if falsified)

**Phase 3 -- Reporting**: Generalizer (condition relaxation) -> Reporter (self-contained finding document per hypothesis)

**Phase 4 -- Synthesis**: Meta-Analyst (reads all findings, clustering, causal graph, importance ranking, final report)

### Feedback Loops

- **Falsified hypotheses**: Falsifier writes `rejection-reason.md` with root-cause analysis and reformulation suggestions. Branch routes back to Hypothesist round 2+, which reads rejection-reasons to generate improved replacements.
- **Confirmed findings**: Reporter writes `H-NNN-finding.md` to `findings/`. Hypothesist round 2+ reads these to build on discoveries and avoid redundancy.
- **Code review loop**: Auditor <-> Fixer can iterate up to `max_audit_rounds` times until code passes review.

### Model Selection

Agents are assigned models based on task complexity:

| Agent | Model | Rationale |
|---|---|---|
| Ingestor, Profiler, Coder, Fixer, Executor, Reporter | Sonnet | Mechanical tasks with clear instructions |
| Hypothesist, Adversary, Judge, Architect, Auditor, Falsifier, Generalizer | Opus | Reasoning, judgment, creativity required |
| Meta-Analyst | Default (Opus) | Complex synthesis across all findings |

### Research-Specific Features

- Structured Hypothesis DSL (6 types: association, difference, causal, structural, temporal, descriptive)
- Benjamini-Hochberg FDR correction for multiple testing
- Effect size joint acceptance gates (statistical significance + practical significance)
- 6 falsification strategies (permutation, bootstrap, subgroup reversal, leave-one-out, temporal split, random confounder)
- 4 generalization strategies (remove subgroup filter, remove covariates, weaken thresholds, correlated variable substitution)

### E2E Validation

Validated with synthetic number theory dataset: 10K integers (21 columns), 1.2K prime gaps, 39K digit distributions. Pipeline successfully executed 80+ nodes across all 14 agent types, with fan-out parallelism, auditor/fixer loops, falsification, and generalization. Findings panel populated in real-time via WebSocket.

---

## Traceability

Each workflow run creates an isolated directory under `.caam/runs/{runId}/`:

```
.caam/runs/{runId}/
  purposes/          # Every agent's generated purpose.md (including retries)
  logs/              # Terminal output captured per agent
  signals/           # Completion signal files
  findings/          # Human-readable finding reports
  node-states.json   # Snapshot for run resume
  run-metadata.json  # Timing, config, summary
  input-manifest.json
```

`.caam/shared` is a junction (Windows) or symlink (Linux) to the current run directory -- agents write to `shared/` as usual, traceability is automatic.

---

## Windows-Specific Considerations

- **chokidar + NTFS junctions**: chokidar with recursive globs does not reliably follow Windows NTFS junctions. Signal detection uses dual mechanism: chokidar (fast-path) + 2-second polling fallback (reliable). Both deduplicate via `processedSignals` Set.
- **Symlinks**: `.caam/shared` uses `junction` type on Windows (no admin required). Falls back to real directory if junction fails.
- **Shell**: node-pty spawns `powershell.exe` on Windows, `bash` on Linux/macOS.
- **Path normalization**: `normalizeAgentPath` converts backslashes to forward slashes and strips duplicate `.caam/` prefixes -- applied everywhere agent-written paths are consumed.
