# Claude Agent Auto Manager (CAAM) - Architecture Document

Last updated: 2026-04-08 16:02 UTC

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
|  +----------+  | DAG Visualization (pan/zoom)  |  |
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
|  +-- PresetResolver (filesystem + DB)              |
|  +-- Registrar (BH FDR correction)                 |
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
| File watching | chokidar |
| Frontend | React 18, Vite |
| Layout | Allotment (resizable split panes) |
| Workflow | YAML-defined DAG, filesystem-based signals |
| Testing | Vitest (63 tests) |

## Project Structure

```
claude-agent-auto-manager/
  package.json                          # Monorepo root (npm workspaces)
  workflows/
    research-swarm.yaml                 # Example: research analysis pipeline
    presets/
      research/                         # 13 agent purpose templates
        ingestor.md ... meta-analyst.md
  packages/
    server/src/
      app.ts                            # Entry point, routes, wiring
      db/
        database.ts                     # SQLite init + migrations
        workspace-repository.ts         # Workspace CRUD
        preset-repository.ts            # Agent preset CRUD
        workflow-repository.ts          # Workflow run + event persistence
      modules/
        terminal/
          types.ts                      # TerminalInfo, TerminalConfig
          terminal-session.ts           # PTY process wrapper (node-pty)
          terminal-registry.ts          # Session registry + callbacks
        knowledge/
          agent-bootstrap.ts            # .caam/ directory management
          knowledge-watcher.ts          # Inbox notification injection
        workflow/
          types.ts                      # Signal, DagNode, WorkflowConfig
          utils.ts                      # Atomic write, SHA-256, sleep
          signal-validator.ts           # Signal schema + output integrity
          signal-watcher.ts             # chokidar on *.done.json
          yaml-parser.ts                # Parse + validate + cycle detection
          dag-executor.ts               # DAG state machine engine
          registrar.ts                  # Benjamini-Hochberg FDR correction
          purpose-templates.ts          # Purpose generation + manifest slicing
          preset-resolver.ts            # Filesystem + DB preset resolution
          hypothesis-types.ts           # Hypothesis DSL (research example)
          manifest-types.ts             # Data manifest types (research example)
          test-plan-types.ts            # Test plan types (research example)
          hypothesis-validator.ts       # DSL validation rules
          synthesis-types.ts            # Meta-analyst, falsifier, generalizer types
      transport/
        protocol.ts                     # WebSocket message types
        websocket.ts                    # Message handler + workflow lifecycle
    web/src/
      App.tsx                           # Root: layout, state, WebSocket, workflow
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
          WorkflowPanel.tsx             # Sidebar controls (file picker, start/abort)
          DagVisualization.tsx           # SVG DAG with pan/zoom
```

---

## Terminal Management

### PTY Sessions

Each terminal wraps a `node-pty` pseudo-terminal process. On Windows it spawns `powershell.exe`; on Linux/macOS it spawns `bash`. The actual command (e.g., `claude --dangerously-skip-permissions`) is deferred until the client reports terminal dimensions (first `resize` event), preventing TUI apps from rendering at wrong dimensions.

### Terminal Registry

In-memory `Map<id, TerminalSession>` with:
- `getByName(name)` for inbox notification injection
- `listWithPurpose()` for agents.md regeneration
- `onSpawn(callback)` / `onTerminalExit(callback)` for workflow hooks
- `onTerminalExitById(id, callback)` for DAG executor crash detection

### WebSocket Protocol

Single multiplexed connection per browser client on `/ws`. Terminal messages: `spawn`, `input`, `resize`, `kill`, `subscribe`, `list`. Workflow messages: `start`, `abort`, `status`, `started`, `node-update`, `completed`.

---

## Agent Communication

### Filesystem-Based Messaging

Each workspace has a `.caam/` directory:

```
<workspace>/.caam/
  shared/
    agents.md               # Auto-generated active agent registry
    context.md              # Free-form shared context
    signals/                # Workflow completion signals (*.done.json)
  agents/
    <name>/
      purpose.md            # Agent instructions + communication protocol
      inbox.md              # Messages from other agents (append-only)
```

### Agent Bootstrap

When an agent spawns (manually or via workflow):
1. Creates `.caam/agents/<name>/purpose.md` with user content + communication template
2. Creates empty `inbox.md`
3. Regenerates `shared/agents.md` with all active agents
4. Injects purpose prompt into terminal after 2s delay

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
  WorkflowPlugin interface, hook points, lifecycle contracts

Layer 1: CAAM Platform        packages/server/ + packages/web/
  Terminals, signals, DAG executor, UI (domain-agnostic)
```

**Layer 1 (Platform)** owns terminal management, signal protocol, DAG state machine, YAML parsing, and the frontend. It has no knowledge of what agents do inside their terminals.

**Layer 2 (SDK)** defines the `WorkflowPlugin` interface with 5 hook points: `onWorkflowStart`, `onSignalReceived`, `onPurposeGenerate`, `onEvaluateReadiness`, `onWorkflowComplete`.

**Layer 3 (Instance)** is a self-contained directory with workflow YAML, agent presets, domain schemas, and a plugin that implements the hooks with domain-specific logic.

### Plugin System

Workflows can specify a `plugin` field in their YAML. The DAG executor dynamically imports the plugin at workflow start and calls its hooks at defined points:

- **onWorkflowStart**: Initialize domain registries, counters, directories
- **onSignalReceived**: Process signals with domain logic (e.g., update test budget)
- **onPurposeGenerate**: Enrich agent purpose with domain context (e.g., data manifest slices)
- **onEvaluateReadiness**: Custom readiness logic for aggregator nodes
- **onWorkflowComplete**: Cleanup, notifications

### Signal Protocol

Agents report completion by writing JSON signal files to `.caam/shared/signals/`. Signals use atomic write (`.tmp` + rename) and include SHA-256 checksums for output integrity. The signal schema is domain-agnostic — `decision.payload` is `unknown`, interpreted by the plugin.

### DAG State Machine

```
pending -> ready -> spawning -> running -> validating -> completed
                                  |            |
                                  v            v
                               retrying     retrying -> failed
```

Features: timeout, retry with context, branch (decision.goto), fan-out (foreach), concurrency semaphore, namespace guard.

### Workflow YAML

```yaml
name: my-pipeline
version: 1
plugin: ./plugin.ts                # Optional: WorkflowPlugin module
config:
  agent_timeout_seconds: 300       # Platform config
  max_parallel_hypotheses: 3       # Platform config
  custom_domain_key: 42            # Passed through to plugin
shared_context: |
  Instructions for all agents.
nodes:
  step_a:
    preset: presets/step-a
    depends_on: []
  step_b:
    preset: presets/step-b
    depends_on: [step_a]
    branch:
      - condition: "ready"
        goto: step_c
        foreach: items
```

### Preset Resolution

1. Filesystem: `workflows/presets/{name}.md`
2. Database: `agent_presets` table
3. Fallback: generic description

Templates use `{{PLACEHOLDER}}` syntax resolved at spawn time. All config values are available as uppercase placeholders.

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
| Workflow   | DAG Visualization (220px, pan/zoom)     |
| File Pick  |  [node]-->[node]-->[node]-->[node]      |
| Start/Stop +----------------------------------------+
+------------+
```

- **Sidebar**: workspace selector, spawn agent button, terminal list, workflow controls
- **Terminal grid**: resizable split panes (Allotment), binary tree layout
- **Bottom panel**: DAG visualization (horizontal left-to-right flow, pan with drag, zoom with wheel, auto-fit centered)

### State Management

- Terminal state: React external store (`useSyncExternalStore`)
- Layout state: binary tree in `useState`, synced with terminal state via `useEffect`
- Workflow state: custom `useWorkflowState` hook, shared between sidebar and DAG panel

### Design System

Dark theme with CSS custom properties: 4-layer surface hierarchy, 3-tier text, semantic colors (success/error), Inter font for UI, monospace for terminals.

---

## Database

SQLite at `~/.caam/caam.db` with WAL journal mode.

| Table | Purpose |
|---|---|
| `workspaces` | Saved workspace paths with usage stats |
| `workspace_agents` | Agent configurations per workspace |
| `agent_presets` | Reusable purpose templates (cross-project) |
| `workflow_runs` | Workflow execution history |
| `workflow_events` | Per-node state transition log |

---

## REST API

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/terminals` | GET | List active terminals |
| `/api/validate-path` | POST | Check directory exists |
| `/api/list-dirs` | GET | Directory autocomplete |
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

---

## Ports

| Port | Service |
|---|---|
| 11000 | Vite dev server (frontend + proxy) |
| 11001 | Express + WebSocket server (backend) |

---

## Example Use Case: Research Data Analysis Swarm

CAAM includes a complete 13-agent research pipeline (`workflows/research-swarm.yaml`) as a reference implementation:

**Phase 0 -- Ingestion**: Ingestor (format detection, normalization) -> Profiler (EDA, data manifest)

**Phase 1 -- Hypothesis Screening**: Hypothesist (structured hypothesis generation) -> Adversary (adversarial review) -> Judge (filter + routing, loops back for more if needed)

**Phase 2 -- Validation**: Per-hypothesis fan-out: Architect (test design) -> Coder (script implementation) -> Auditor <-> Fixer (code review loop) -> Executor (script execution) -> Falsifier (robustness testing)

**Phase 3 -- Synthesis**: Generalizer (condition relaxation) -> Meta-Analyst (clustering, causal graph, importance ranking, final report)

The research swarm demonstrates: structured data schemas (Hypothesis DSL with 6 types, TestPlan with 4 modes, DataManifest), Benjamini-Hochberg FDR correction, effect size joint acceptance gates, 6 falsification strategies, and a comprehensive final report.

---

## Testing

63 tests across 6 test files:
- Signal validator: schema + output integrity (12 tests)
- YAML parser: validation + cycle detection (8 tests)
- DAG executor: state machine + node graph (22 tests)
- Registrar: BH correction + budget (7 tests)
- Hypothesis validator: DSL rules (10 tests)
- Workflow repository: run + event CRUD (4 tests)
