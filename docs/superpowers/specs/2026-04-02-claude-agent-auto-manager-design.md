# Claude Agent Auto Manager -- Design Specification

## Overview

A web-based platform for managing multiple Claude Code terminal sessions as a coordinated agent network. Three core subsystems:

1. **Terminal Proxy Layer** -- WebSocket-based proxy exposing Claude Code terminals in a browser grid
2. **Shared Knowledge / Agent Graph Layer** -- cross-session knowledge sharing and inter-terminal communication
3. **Workflow Orchestration Layer** -- user-defined pipelines that coordinate the agent graph

## Technology Stack

- **Backend**: Node.js + TypeScript, single server with plugin architecture
- **Frontend**: React + TypeScript, xterm.js for terminal rendering
- **Terminal management**: tmux-backed PTY sessions
- **Package manager**: npm
- **Default command**: `claude --dangerously-skip-permissions`

## Project Structure

```
claude-agent-auto-manager/
  packages/
    server/                  # Node.js backend
      src/
        modules/
          terminal/          # tmux session management, PTY spawning, attach
          message-bus/       # structured inter-terminal messaging
          knowledge/         # file watcher, change notifications, API
          workflow/          # pipeline engine, YAML parsing, execution
        transport/
          websocket.ts       # WebSocket gateway (terminal I/O + control messages)
          http.ts            # REST API (session CRUD, workflow CRUD, etc.)
        app.ts               # server entry point, module registration
    web/                     # React frontend
      src/
        components/
          terminal/          # xterm.js wrapper, terminal pane
          grid/              # layout manager, drag/resize
          workflow-editor/   # visual node editor
          knowledge/         # shared state viewer
        stores/              # state management
        services/            # WebSocket client, API client
```

Each module under `server/src/modules/` exports a typed interface. Modules never import from each other's internals -- they interact through their public interfaces, registered at startup in `app.ts`.

## Module Architecture

All modules register through a common interface at startup. Cross-module communication happens through typed public interfaces only -- no reaching into another module's internals.

---

## Section 1: Terminal Module

### Responsibilities

Spawn new Claude Code sessions, attach to existing tmux sessions, manage lifecycle, relay I/O.

### Key Components

- **TmuxManager** -- wraps tmux CLI commands: create session, list sessions, send-keys, capture-pane, kill-session. Each terminal gets a unique tmux session name (e.g., `caam-<uuid>`).
- **TerminalSession** -- represents one active terminal. Holds metadata (id, name, purpose, creation time, status). Exposes `write(data)`, `onData(callback)`, `resize(cols, rows)`, `getScrollback()`.
- **TerminalRegistry** -- in-memory registry of all managed sessions. Handles discovery of pre-existing tmux sessions (by prefix convention `caam-*`).

### I/O Relay Flow

1. Backend creates a tmux session via `tmux new-session -d` and attaches a `node-pty` pseudo-terminal to it using `tmux pipe-pane` for output capture and `tmux send-keys` for input injection
2. PTY output is streamed over WebSocket to the specific xterm.js instance
3. User keystrokes from xterm.js are sent over WebSocket, written into the PTY
4. For programmatic access (terminal-to-terminal), the same `write()` / `onData()` interface is used internally

### Spawning Claude Code

The tmux session runs `claude --dangerously-skip-permissions` (configurable). The system does not interpret Claude Code's protocol -- it is a transparent terminal proxy. Claude Code thinks it is in a normal terminal.

### Attaching to Existing Sessions

On startup (and on-demand refresh), the backend runs `tmux list-sessions` filtered by `caam-*` prefix, and reconciles with the registry.

---

## Section 2: WebSocket Transport & Frontend Terminal Grid

### WebSocket Protocol

A single WebSocket connection per browser client, multiplexed by terminal ID. Messages are JSON-framed:

```typescript
// Client -> Server
{ type: "terminal:input", terminalId: string, data: string }
{ type: "terminal:resize", terminalId: string, cols: number, rows: number }
{ type: "terminal:spawn", name?: string, command?: string }
{ type: "terminal:attach", tmuxSessionName: string }
{ type: "terminal:kill", terminalId: string }

// Server -> Client
{ type: "terminal:output", terminalId: string, data: string }
{ type: "terminal:created", terminalId: string, name: string }
{ type: "terminal:exited", terminalId: string, exitCode: number }
{ type: "terminal:list", terminals: TerminalInfo[] }
```

Single multiplexed connection avoids per-terminal WebSocket overhead, simplifies reconnection logic, and the message bus reuses the same connection later.

### Frontend Grid

- **GridLayout** component uses `react-grid-layout` for drag/resize with preset layout buttons (1x1, 2x2, 2x3, etc.)
- **TerminalPane** wraps xterm.js with a header bar (terminal name, purpose label, close button)
- **TerminalManager** sidebar/panel for spawning new terminals, attaching to existing, seeing the full list
- xterm.js `FitAddon` handles auto-sizing terminals to their grid cell, sending resize events on layout change

---

## Section 3: Message Bus (Inter-Terminal Communication)

### Raw I/O Channel

Terminal A can write directly into terminal B's input and subscribe to its output stream. Uses the same `TerminalSession.write()` and `onData()` interface, routed through the bus:

```typescript
messageBus.rawWrite(fromId: string, toId: string, data: string)
messageBus.onRawOutput(terminalId: string, callback: (data: string) => void)
```

### Structured Channel

Typed JSON messages between terminals, independent of the visual stream:

```typescript
messageBus.publish(fromId: string, topic: string, payload: any)
messageBus.subscribe(terminalId: string, topic: string, callback: (msg: Message) => void)
```

### Claude Code Integration

Since Claude Code sessions are just terminals, they cannot natively subscribe to the message bus. Integration works through two mechanisms:

1. **File-based bridging** -- the knowledge layer writes messages to files that Claude Code sessions can read
2. **Direct input injection** -- the workflow engine or another terminal can write commands/text directly into a session's input via raw I/O

### Frontend Visibility

The web UI shows a message log panel per terminal, and optionally a global message flow view showing inter-terminal traffic.

---

## Section 4: Knowledge Layer (Shared State)

### File-Based Source of Truth

```
workspace/
  shared/                    # Global shared knowledge
    context.md               # Overall project context, goals
    decisions.md             # Key decisions log
    <custom>.md              # User-defined shared docs
  agents/
    <terminal-name>/
      purpose.md             # This agent's role/instructions (like SOUL.md)
      status.md              # Current status, what it's working on
      inbox.md               # Structured messages from other agents
      outbox.md              # Messages this agent has sent
  workflows/
    <workflow-name>.yaml     # Pipeline definitions
```

### API Layer

- **FileWatcher** -- uses `chokidar` to watch the workspace directory tree. On any change, emits events to the message bus so interested terminals and the frontend are notified in real-time.
- **KnowledgeAPI** -- REST endpoints for reading/writing workspace files, listing agent directories, querying status. The frontend uses this for the knowledge viewer panel.
- **AgentBootstrap** -- when spawning a new terminal, the system creates the `agents/<name>/` directory with a `purpose.md` seeded from user input. Claude Code is launched with instructions to read its purpose file.

### Conflict Handling

File-based means last-write-wins by default. The FileWatcher logs all changes with timestamps. Structured conflict resolution can be added later if needed.

---

## Section 5: Workflow Engine

### Pipeline Model

A workflow is a directed graph of steps. Each step targets a terminal (existing or to-be-spawned) and defines an action (send input, wait for output pattern, read/write knowledge files, conditional branching).

### YAML Definition Format

```yaml
name: code-review-pipeline
description: Automated code review workflow
triggers:
  - manual
  - cron: "*/30 * * * *"

steps:
  - id: architect
    terminal: architect-agent
    spawn: true
    purpose: "Review the codebase architecture"
    action:
      type: send-input
      data: "Review src/ for architectural issues and write findings to shared/review.md"
    wait:
      type: output-match
      pattern: "Done|Complete|Finished"
      timeout: 300s

  - id: reviewer
    terminal: review-agent
    spawn: true
    purpose: "Detailed code review"
    depends_on: [architect]
    action:
      type: send-input
      data: "Read shared/review.md and perform detailed review of flagged files"
    wait:
      type: file-change
      path: "agents/review-agent/outbox.md"
      timeout: 600s

  - id: notify
    depends_on: [reviewer]
    action:
      type: structured-message
      topic: "review-complete"
      payload: { status: "done" }
```

### Engine Components

- **WorkflowParser** -- validates and loads YAML definitions
- **WorkflowExecutor** -- walks the DAG, respects `depends_on`, executes steps, handles timeouts
- **WorkflowState** -- tracks execution state (pending/running/paused/completed/failed per step), supports pause/resume/stop
- **TriggerManager** -- handles manual triggers, cron schedules, and later event-based triggers

### Visual Editor

The frontend provides a node-graph editor (using `reactflow`) that maps 1:1 to the YAML structure. Editing in either place stays in sync -- the YAML is the source of truth, the editor reads/writes it.

---

## Phasing

### Phase 1 -- Terminal Grid (MVP)

- Node.js server with tmux-backed terminal management
- WebSocket multiplexed I/O
- React frontend with xterm.js grid (presets + drag/resize)
- Spawn `claude --dangerously-skip-permissions` sessions
- Attach to existing `caam-*` tmux sessions
- Terminal CRUD (spawn, kill, rename, list)

### Phase 2 -- Agent Communication

- Message bus (raw I/O + structured channels)
- Knowledge layer file structure + FileWatcher
- Agent bootstrap with purpose.md seeding
- Knowledge viewer panel in frontend
- Inter-terminal message log in UI

### Phase 3 -- Workflow Orchestration

- YAML workflow parser + validator
- Workflow executor (DAG walking, timeouts, pause/resume/stop)
- Trigger manager (manual + cron)
- REST API for workflow CRUD
- Visual node editor in frontend (reactflow)
- Bidirectional sync between YAML and visual editor

Each phase is independently useful -- Phase 1 alone is a functional multi-terminal Claude Code manager.

---

## Phase 1 Implementation Notes

Lessons learned and decisions that diverged from or refined the original design.

### Terminal I/O: pipe-pane, not capture-pane

The original design described "PTY pipe to tmux" generically. In practice, `tmux capture-pane` polling (tried first) strips ANSI escape sequences and produces garbage for TUI apps like Claude Code. The working approach uses `tmux pipe-pane -O` to stream raw PTY output through a FIFO (named pipe) created per session at `/tmp/caam-pipe-<id>`. A `cat` child process reads the FIFO and pushes data to WebSocket listeners.

### Deferred Command Launch

Tmux sessions are created with `bash` as the initial command, not the target command. The actual command (e.g., `claude --dangerously-skip-permissions`) is launched via `exec <command>` sent through `tmux send-keys` only after the client reports its terminal dimensions. This prevents the TUI from rendering at default dimensions (120x30) before xterm.js has measured its container.

Sequence: create tmux(bash) -> client sends resize(cols, rows) -> server starts pipe-pane -> server sends `exec <command>\n` -> output streams to client.

### xterm.js Fitting

`@xterm/addon-fit` (FitAddon) consistently returns default 80x24 when the WebGL addon is loaded, regardless of container size. Replaced with manual cell dimension reading from xterm's internal `_renderService.dimensions.css.cell` (or `_charSizeService` fallback). This reads the exact pixel values the renderer uses.

### Reconnection (Page Reload)

On page reload, existing tmux sessions are rediscovered via `tmux list-sessions`. For each, the client sends `terminal:subscribe`. The server forces a SIGWINCH by toggling pane size (+1 row then back), causing the TUI to redraw at the correct dimensions. The client resets the xterm buffer before subscribing for a clean slate.

The SIGWINCH toggle is only done for sessions where `isCommandRunning` is true (reconnect), not for fresh spawns.

### Graceful Exit

The `x` button sends two Ctrl+C (200ms apart) instead of killing the tmux session. This lets Claude Code exit gracefully. A 2-second exit poller detects when the session ends and fires cleanup callbacks.

### CWD Gating

Users must set and validate a working directory before spawning. The server provides `POST /api/validate-path` for validation and `GET /api/list-dirs?prefix=` for autocomplete. The CWD input locks after validation; spawn controls are disabled until a valid CWD is set.

### Default Ports

- Server: 11001
- Frontend: 11000 (Vite dev proxy to server)

### WebSocket Protocol Additions

Beyond the original design, `terminal:subscribe` was added. Clients must explicitly subscribe to a terminal's output stream after spawn or reconnect. This decouples session creation from output delivery and enables clean reconnection.
