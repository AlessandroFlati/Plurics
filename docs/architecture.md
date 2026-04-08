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
| Phase 3: Workflow Orchestration | Planned | YAML workflow parser, DAG executor, visual node editor |
