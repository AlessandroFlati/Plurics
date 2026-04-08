# Claude Agent Auto Manager - Architecture Document

Last updated: 2026-04-08 07:38 UTC

## Overview

CAAM is a web-based platform for managing multiple Claude Code terminal sessions as a coordinated agent network. It provides a browser-based IDE-like interface where each pane hosts an autonomous Claude Code agent, and agents communicate with each other through filesystem-based messaging.

The system is split into two packages in a monorepo:

- **`packages/server`** -- Node.js + TypeScript backend: terminal process management, WebSocket transport, SQLite persistence, filesystem-based agent communication
- **`packages/web`** -- React + TypeScript frontend: terminal rendering (xterm.js), resizable split panes, workspace management, agent spawn modal

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES2022) |
| Language | TypeScript (strict mode) |
| Backend framework | Express.js |
| Real-time transport | WebSocket (ws library) |
| Terminal emulation | node-pty (server), xterm.js + WebGL addon (client) |
| Database | SQLite via better-sqlite3 (`~/.caam/caam.db`) |
| File watching | chokidar |
| Frontend framework | React 18 |
| Build tool | Vite |
| Layout | Allotment (resizable split panes) |
| Package manager | npm workspaces |
| Test runner | Vitest |

## Project Structure

```
claude-agent-auto-manager/
  package.json                          # Monorepo root, npm workspaces
  packages/
    server/
      src/
        app.ts                          # Entry point: Express + HTTP server + wiring
        db/
          database.ts                   # SQLite singleton, migrations
          workspace-repository.ts       # Workspace CRUD
          preset-repository.ts          # Agent preset CRUD
        modules/
          terminal/
            types.ts                    # TerminalInfo, TerminalConfig, constants
            terminal-session.ts         # PTY process wrapper
            terminal-registry.ts        # In-memory session registry
            tmux-manager.ts             # Legacy tmux wrapper (unused on Windows)
          knowledge/
            agent-bootstrap.ts          # .caam/ directory management
            knowledge-watcher.ts        # chokidar inbox watcher
        transport/
          protocol.ts                   # WebSocket message types
          websocket.ts                  # WebSocket server + message handler
    web/
      src/
        main.tsx                        # React entry point
        App.tsx                         # Root component: layout, state, WebSocket
        types.ts                        # Shared TypeScript types
        theme.css                       # Design tokens (CSS custom properties)
        services/
          websocket-client.ts           # WebSocket wrapper with auto-reconnect
        stores/
          terminal-store.ts             # React external store for terminal state
        components/
          sidebar/
            TerminalManager.tsx          # Sidebar: workspace, spawn, terminal list
            TerminalManager.css
            WorkspaceSelector.tsx        # Directory autocomplete + workspace persistence
            WorkspaceSelector.css
            SpawnModal.tsx               # Agent spawn modal with purpose editor
            SpawnModal.css
          grid/
            SplitLayout.tsx             # Recursive split-pane renderer
            SplitLayout.css
            PaneToolbar.tsx             # Split/close buttons with SVG icons
            PaneToolbar.css
            EmptySlot.tsx               # Empty pane placeholder
            EmptySlot.css
            split-tree.ts              # Binary tree layout data structure
          terminal/
            TerminalPane.tsx            # xterm.js terminal wrapper
            TerminalPane.css
```

---

## Server Architecture

### Entry Point (`app.ts`)

The server initializes all modules and wires them together:

```
TerminalRegistry
AgentBootstrap
KnowledgeWatcher(registry)
PresetRepository(db)
WorkspaceRepository(db)
createWebSocketServer(server, registry, bootstrap, presetRepo)
```

It exposes REST endpoints for:
- `GET /api/health` -- health check
- `GET /api/terminals` -- list active terminals
- `POST /api/validate-path` -- check if a directory exists
- `GET /api/list-dirs?prefix=` -- directory autocomplete (supports both `/` and `\`)
- `GET|POST|PUT|DELETE /api/workspaces` -- workspace CRUD
- `GET|POST|PUT|DELETE /api/agent-presets` -- preset CRUD

Lifecycle hooks:
- `registry.onTerminalExit()` triggers `bootstrap.regenerateAgentsList()` to update `.caam/shared/agents.md`
- `registry.onSpawn()` starts the `KnowledgeWatcher` on the workspace directory

### Terminal Module

**TerminalSession** wraps a `node-pty` pseudo-terminal process. On Windows it spawns `powershell.exe`; on Linux/macOS it spawns `bash`. The actual command (e.g. `claude --dangerously-skip-permissions`) is deferred -- it is injected via `write()` only after the client reports its terminal dimensions (first `resize` event). This prevents TUI apps from rendering at wrong dimensions.

Key lifecycle:
1. `TerminalSession.create(config)` spawns PTY with shell
2. Client sends `terminal:subscribe` -- server attaches data/exit listeners
3. Client sends `terminal:resize` -- triggers deferred command on first call
4. PTY output streams to client via WebSocket
5. `destroy()` kills PTY and notifies exit listeners

**TerminalRegistry** is the in-memory registry. It maps session IDs to TerminalSession instances, tracks agent purposes in a separate map, and provides `getByName()` for the KnowledgeWatcher to find sessions by agent name.

### Knowledge Module

**AgentBootstrap** manages the `.caam/` directory inside the workspace:

```
<workspace>/
  .caam/
    shared/
      agents.md            # Auto-generated: list of running agents
      context.md           # Free-form shared context
    agents/
      <agent-name>/
        purpose.md         # Agent role + communication instructions
        inbox.md           # Messages from other agents (append-only)
```

When an agent is spawned with a purpose:
1. Creates `agents/<name>/purpose.md` with user content + communication template
2. Creates empty `agents/<name>/inbox.md`
3. Regenerates `shared/agents.md` with all active agents
4. After 2s delay, injects into the terminal: `Read your purpose and instructions at .caam/agents/<name>/purpose.md and follow them.`

When an agent exits, `agents.md` is regenerated without it.

**KnowledgeWatcher** uses chokidar to watch `<workspace>/.caam/agents/*/inbox.md`. When a file changes (another agent wrote a message):
1. Debounces for 300ms per agent name
2. Looks up the target terminal by agent name via `registry.getByName()`
3. Injects `[CAAM] New message in your inbox. Read .caam/agents/<name>/inbox.md` into the terminal

### Database

SQLite at `~/.caam/caam.db` with WAL journal mode and foreign keys.

**Tables:**

| Table | Purpose |
|---|---|
| `workspaces` | Saved workspace paths with usage stats |
| `workspace_agents` | Agent configurations per workspace (legacy, from Phase 1) |
| `agent_presets` | Reusable agent purpose templates with use_count |

### WebSocket Protocol

Single multiplexed WebSocket connection per browser client on `/ws`.

**Client -> Server:**

| Message | Fields | Description |
|---|---|---|
| `terminal:spawn` | name, cwd, command?, purpose?, presetId? | Create new terminal |
| `terminal:input` | terminalId, data | Send keystrokes |
| `terminal:resize` | terminalId, cols, rows | Resize terminal |
| `terminal:kill` | terminalId | Kill terminal process |
| `terminal:subscribe` | terminalId | Start receiving output |
| `terminal:list` | -- | Request terminal list |

**Server -> Client:**

| Message | Fields | Description |
|---|---|---|
| `terminal:created` | terminalId, name | Terminal spawned |
| `terminal:output` | terminalId, data | PTY output chunk |
| `terminal:exited` | terminalId, exitCode | Terminal process ended |
| `terminal:list` | terminals[] | All active terminals |
| `error` | message | Error message |

---

## Frontend Architecture

### State Management

Terminal state is managed via a **React external store** (`terminal-store.ts`) using `useSyncExternalStore`. The store:
- Processes incoming WebSocket messages (created, exited, list, output)
- Maintains a `Map<string, TerminalInfo>` of active terminals
- Maintains per-terminal output listener sets for xterm.js subscriptions
- Exposes `useTerminals()` hook and `subscribeToOutput()` function

### Layout System

The layout is a **binary tree** (`split-tree.ts`):

```typescript
type LayoutNode =
  | { type: 'leaf'; terminalId: string | null }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; ratio: number;
      children: [LayoutNode, LayoutNode] };
```

Pure functions mutate the tree immutably:
- `splitLeaf(tree, terminalId, direction)` -- split a terminal's pane
- `mergePane(tree, terminalId)` -- remove a terminal and collapse its parent split
- `assignTerminals(tree, ids)` -- fill empty leaves with terminal IDs
- `createPreset(cols, rows)` -- generate balanced grid layouts

The tree is rendered by `SplitLayout` using the Allotment library for resizable panes. Each leaf renders either a `TerminalPane` (if it has a terminal) or an `EmptySlot`.

A `useEffect` in `App.tsx` syncs the layout with terminal state:
1. Collapses panes of exited terminals (via `mergePane`)
2. Clears stale terminal IDs from root leaves that can't be merged
3. Assigns unassigned terminals to empty slots

### Component Hierarchy

```
App
  TerminalManager (sidebar)
    WorkspaceSelector
    "Spawn Agent" button -> opens SpawnModal
    Terminal list with kill buttons
  SplitLayout (main area)
    RenderNode (recursive)
      TerminalPane (occupied leaf)
        xterm.js terminal
        PaneToolbar (split H/V, close)
      EmptySlot (empty leaf) -> opens SpawnModal
  SpawnModal (overlay, when open)
    Preset quicklist (left sidebar)
    Name input + Purpose textarea (right form)
    Save as Preset / Cancel / Spawn buttons
```

### Terminal Rendering

`TerminalPane` wraps xterm.js with:
- WebGL addon for hardware-accelerated rendering (canvas fallback)
- Manual cell dimension calculation (reading xterm internals) for accurate fitting
- `ResizeObserver` for responsive resize on pane drag
- 100ms delay before subscribing to allow layout to settle
- Buffer reset before subscribing for clean slate on reconnect

### Design System

Dark theme defined in `theme.css` with CSS custom properties:
- 4-layer surface hierarchy: `bg` -> `surface-1` -> `surface-2` -> `surface-3`
- Border colors with focus variant
- 3-tier text hierarchy: primary, secondary, muted
- Semantic colors: success (green), error (red) with background variants
- Inter font for UI, JetBrains Mono / Fira Code for monospace
- 4px / 6px border radius tokens

---

## Data Flow

### Agent Spawn Flow

```
User clicks "Spawn Agent"
  -> SpawnModal opens
  -> User fills name + purpose (or selects preset)
  -> Click "Spawn"
  -> Frontend sends terminal:spawn { name, cwd, purpose, presetId }
  -> Server: registry.spawn() creates PTY process
  -> Server: bootstrap.createAgentFiles() writes purpose.md + inbox.md
  -> Server: bootstrap.regenerateAgentsList() updates agents.md
  -> Server: presetRepo.incrementUseCount() if preset used
  -> Server sends terminal:created to client
  -> Store adds terminal, useEffect assigns to empty layout slot
  -> TerminalPane mounts, subscribes to output, sends resize
  -> Server injects purpose prompt after 2s delay
  -> Claude Code reads purpose.md and starts working
```

### Inter-Agent Communication Flow

```
Agent A writes to Agent B's inbox:
  -> Agent A appends to .caam/agents/agent-b/inbox.md
  -> chokidar detects file change
  -> KnowledgeWatcher debounces (300ms)
  -> KnowledgeWatcher finds Agent B's terminal via registry.getByName()
  -> Injects "[CAAM] New message in your inbox..." into Agent B's terminal
  -> Agent B reads .caam/agents/agent-b/inbox.md
```

### Terminal Close Flow

```
User clicks Close Pane (or types "exit"):
  -> Frontend sends terminal:kill
  -> Server: registry.kill() -> session.destroy() -> PTY killed
  -> session.destroy() fires exit listeners
  -> Server sends terminal:exited to client
  -> Store removes terminal
  -> useEffect: mergePane() collapses layout, clearStale() handles root leaves
  -> Server: onTerminalExit callback regenerates agents.md
```

---

## Network Topology

```
Browser (localhost:11000)
  |
  | Vite dev proxy
  |
  +-- /api/* ---------> Express (localhost:11001)
  +-- /ws ------------> WebSocket (localhost:11001/ws)
  |
  | xterm.js <-> WebSocket <-> node-pty
  |
  +-- Terminal 1 (PowerShell -> claude)
  +-- Terminal 2 (PowerShell -> claude)
  +-- Terminal N ...
```

## Ports

| Port | Service |
|---|---|
| 11000 | Vite dev server (frontend + proxy) |
| 11001 | Express + WebSocket server (backend) |

---

## Phasing

| Phase | Status | Description |
|---|---|---|
| Phase 1: Terminal Grid | Complete | PTY management, split panes, workspace persistence |
| Phase 2: Agent Communication | Complete | Spawn modal, purpose editor, presets, FileWatcher inbox injection, agents.md registry |
| Phase 3: Workflow Orchestration | Complete | Signal protocol, DAG executor, YAML parser, registrar, WorkflowPanel |
| Research Swarm Schemas | Complete | Hypothesis DSL, TestPlan, DataManifest, hypothesis validator |

---

## Workflow Orchestration (Phase 3)

### Signal Protocol

Agents report task completion by writing JSON signal files to `.caam/shared/signals/`. The signal file is the sole mechanism by which the DAG executor learns that an agent has finished. Signals use atomic write (`.tmp` + rename) and include SHA-256 checksums for output integrity verification.

Signal statuses: `success`, `failure`, `branch` (with goto decision), `budget_exhausted`.

### DAG Executor

The `DagExecutor` manages a directed acyclic graph of agent nodes with a state machine:

```
pending -> ready -> spawning -> running -> validating -> completed
                                  |            |
                                  v            v
                               retrying     retrying -> failed
```

Features: timeout handling, retry with exponential context, crash detection (per-terminal exit listeners), branch decisions with scoped sub-DAG fan-out, budget exhaustion propagation.

### Registrar

Server-side module that maintains a test registry and applies Benjamini-Hochberg FDR correction after each test execution. Tracks test budget and adjusts significance thresholds.

### Workflow YAML

Declarative schema for multi-agent pipelines with `depends_on`, `branch`, `max_invocations` (loop control), per-node timeout/retry overrides, and cycle detection via Kahn's algorithm.

### Workflow Files

```
packages/server/src/modules/workflow/
  types.ts                  # Signal, DagNode, WorkflowConfig, NodeState
  utils.ts                  # Atomic JSON write, SHA-256, sleep
  signal-validator.ts       # Schema validation + output integrity
  signal-watcher.ts         # chokidar on *.done.json
  yaml-parser.ts            # YAML parse + validate + cycle detection
  dag-executor.ts           # Core DAG state machine
  registrar.ts              # BH FDR correction + budget
  purpose-templates.ts      # Generate purpose.md with signal protocol
  hypothesis-types.ts       # Hypothesis DSL type definitions
  manifest-types.ts         # Profiler data manifest types
  test-plan-types.ts        # Architect test plan types
  hypothesis-validator.ts   # DSL validation rules
  synthesis-types.ts        # Meta-Analyst, Falsifier, Generalizer types
```

---

## Research Swarm Schemas

### Hypothesis DSL

Central artifact flowing through the agent pipeline: Hypothesist -> Adversary -> Judge -> Architect -> Coder -> Falsifier -> Generalizer.

Six hypothesis types: `association`, `difference`, `distribution`, `causal`, `temporal`, `structural`. Each has a type-specific payload with structured fields for machine execution.

Lifecycle annotations accumulate as the hypothesis flows through agents: `adversary_review`, `judge_verdict`, `test_result`, `falsification_result`, `generalization`.

Joint acceptance gate: both statistical significance (after BH correction) AND practical significance (effect size threshold) must pass.

### TestPlan (Architect Output)

Four modes: `correlation`, `causal`, `distributional`, `structural`. Each with mode-specific plan (test selection, identification strategy, robustness checks) plus common preprocessing steps, assumption checks, and sample size analysis.

The Architect chooses mode and test based on hypothesis type and data manifest column types (decision matrix in spec).

### DataManifest (Profiler Output)

Comprehensive dataset profile: metadata (shape, time series detection, natural experiments), per-column profiles (semantic types, stats, distribution, anomalies), cross-column analysis (correlations, collinearity), data quality report, and analysis leads for the Hypothesist.

### Schema File Locations

| Schema | Written by | File location |
|---|---|---|
| DataManifest | Profiler | `.caam/shared/profiling-report.json` |
| Hypothesis | Hypothesist | `.caam/shared/hypotheses/H-{NNN}.json` |
| TestPlan | Architect | `.caam/shared/test-plans/H-{NNN}-plan.json` |
| TestResult | Executor | `.caam/shared/results/H-{NNN}-result.json` |
| FinalReport | Meta-Analyst | `.caam/shared/final-report.json` + `.md` |

---

## Synthesis Agents

### Meta-Analyst

Final agent that sees all outputs and produces a synthesis report. Five analysis tasks:
1. **Finding clusters** -- groups hypotheses by shared variables, synthesizes mechanism narratives
2. **Causal graph synthesis** -- merges validated causal edges into a DAG, detects contradictions
3. **Consistency checks** -- Simpson's paradox, ecological fallacy, collider bias detection
4. **Gap analysis** -- unexplored variables, unused leads, recoverable hypotheses
5. **Importance ranking** -- composite score (statistical 0.15, practical 0.25, robustness 0.25, generalizability 0.15, novelty 0.20)

### Falsifier

Tries to break validated hypotheses. 8 strategies with applicability matrix per hypothesis type:
- **Required** (permutation, bootstrap): failure = falsified
- **Informational** (subgroup reversal, leave-one-out, temporal split, random confounder, collider check, effect threshold probe): contribute to robustness_score

`robustness_score = n_survived / n_attempted`

### Generalizer

Relaxes conditions on validated hypotheses (Occam's razor). 6 strategies: remove subgroup filter, remove confounder, weaken condition, broaden variable, cross time period, merge related hypotheses. Runs tests directly (shortcut, not full pipeline).

### Context Window Management

`manifestSlice()` in purpose-templates.ts provides per-agent manifest filtering:
- Full manifest: hypothesist, adversary, generalizer, meta_analyst
- Filtered columns: architect, coder, auditor, fixer, falsifier
- Summary only: judge
- None: executor

### DAG Executor Enhancements

- **Concurrency limit**: `max_parallel_hypotheses` enforced via semaphore on scoped nodes
- **Graceful degradation**: Meta-analyst runs when all scoped nodes terminate or when judge exhausts rounds with zero approvals
- **Namespace guard**: `validateOutputNamespace()` ensures agents only write to their scope's paths
- **Hypothesis IDs**: counter in `.caam/shared/hypothesis-counter.json`
