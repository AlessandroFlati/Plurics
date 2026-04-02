# Phase 1 Polish -- Design Specification

> Created: 2026-04-02 15:34 UTC

## Overview

Improvements to the Phase 1 Terminal Grid MVP: replace grid layout with splitter-based split panes, add workspace persistence with SQLite, comprehensive integration tests, and proper resize handling.

## 1. Split Tree Data Model

The layout is a binary tree. Each node is either a **leaf** (holds a terminal ID or is empty) or a **split** (horizontal or vertical, containing two children with a ratio).

```typescript
type SplitDirection = 'horizontal' | 'vertical';

type LayoutNode =
  | { type: 'leaf'; terminalId: string | null }
  | { type: 'split'; direction: SplitDirection; ratio: number; children: [LayoutNode, LayoutNode] };
```

### Operations

- **Preset (e.g., 2x2)**: Generates a balanced tree -- vertical split at root, each child is a horizontal split, each leaf holds a terminal ID or null (empty).
- **Split pane**: Replace a leaf with a split node containing the original terminal and a new empty slot (or auto-spawn a new terminal).
- **Merge**: The merge button on a pane keeps that pane and removes its sibling. The parent split node is replaced by the kept pane's subtree.
- **Drag splitter**: Updates the `ratio` on the parent split node.

### Empty slots

When a preset creates more slots than terminals, or when a terminal exits, the slot shows a placeholder with a "Spawn here" button.

## 2. Splitter UI with Allotment

Replace `react-grid-layout` entirely with `allotment`.

### Component structure

- **SplitLayout** -- top-level component that recursively renders the tree. Each `split` node becomes `<Allotment vertical={direction === 'vertical'}>` with two children. Each `leaf` becomes `<Allotment.Pane>` wrapping a `<TerminalPane>` or empty slot placeholder.
- **PaneToolbar** -- small toolbar rendered at the top-right of each pane (overlaid on the header). Buttons: split horizontal, split vertical, merge (only if pane has a sibling).
- **LayoutPresets** -- same bar as now but generates a split tree instead of grid params and replaces the current layout.

### Resize behavior

- Allotment handles splitter drag natively with proper min/max sizes.
- On splitter drag end, the ResizeObserver on `.terminal-pane-body` fires, which runs `fitTerminal()`, which sends `terminal:resize` to the server.
- Tmux gets resized, TUI redraws at new dimensions.

### Min pane size

200px width, 100px height -- prevents making a terminal too small to be usable.

## 3. SQLite Workspace Persistence

### Schema

```sql
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  label TEXT,
  default_layout TEXT,          -- JSON of the split tree preset (e.g., "2x2")
  default_terminal_count INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  use_count INTEGER DEFAULT 1
);

CREATE TABLE workspace_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT,                  -- default purpose.md content for this agent
  sort_order INTEGER DEFAULT 0
);
```

### API endpoints

- `GET /api/workspaces` -- list all workspaces, ordered by `last_used_at` desc
- `POST /api/workspaces` -- create workspace (path, label, defaults)
- `PUT /api/workspaces/:id` -- update label, defaults
- `DELETE /api/workspaces/:id` -- delete workspace
- `POST /api/workspaces/:id/select` -- set as active workspace, bumps `last_used_at` and `use_count`

### Library

`better-sqlite3` -- synchronous, no async overhead, embedded, well-maintained.

### DB location

`~/.caam/caam.db` (created on first server start).

### Frontend flow change

The sidebar's CWD section becomes a workspace selector:

1. On load, fetch `GET /api/workspaces` and show a dropdown of recent workspaces.
2. User can select an existing workspace (auto-fills CWD, skips validation) or type a new path.
3. When setting a new CWD, it auto-creates a workspace record.
4. Once a workspace is selected/created, the spawn controls enable (same gating as now).
5. If the workspace has saved agents, offer to auto-spawn them.

## 4. Integration Tests

Targeting ~25 tests across 5 categories.

### Terminal lifecycle (6 tests)

- Spawn terminal, receive `terminal:created`
- Resize triggers pipe-pane + deferred command
- Subscribe receives output after resize
- Kill sends Ctrl+C, exit poller detects session gone, `terminal:exited` received
- Terminal exits on its own (command ends), `terminal:exited` received
- Spawn with custom command (not default Claude)

### Reconnection (4 tests)

- Page reload: list returns existing terminals
- Subscribe to existing terminal receives SIGWINCH redraw output
- Resize existing terminal on reconnect updates tmux dimensions
- Multiple clients subscribe to same terminal, both receive output

### Error handling (5 tests)

- Input to non-existent terminal returns error
- Kill non-existent terminal returns error
- Resize non-existent terminal returns error
- Subscribe to non-existent terminal returns error
- Invalid JSON message returns error

### Workspace API (6 tests)

- Create workspace, list returns it
- Select workspace bumps last_used_at and use_count
- Update workspace label
- Delete workspace removes it and associated agents
- Create workspace with agents, agents returned on list
- Duplicate path rejected

### Layout operations (4 tests)

Frontend unit tests (vitest + jsdom) testing the split tree manipulation functions:

- Spawn into split tree, all terminals get unique IDs
- Split pane produces valid tree structure
- Merge pane removes split node
- Preset generates correct tree shape (e.g., 2x2 = 4 leaves)

## 5. File Changes

### New files

- `packages/server/src/db/database.ts` -- SQLite initialization, migrations
- `packages/server/src/db/workspace-repository.ts` -- workspace CRUD operations
- `packages/web/src/components/grid/SplitLayout.tsx` -- recursive allotment renderer
- `packages/web/src/components/grid/SplitLayout.css`
- `packages/web/src/components/grid/PaneToolbar.tsx` -- split/merge buttons per pane
- `packages/web/src/components/grid/PaneToolbar.css`
- `packages/web/src/components/grid/split-tree.ts` -- tree data model, preset generators, split/merge operations (pure functions)
- `packages/web/src/components/grid/EmptySlot.tsx` -- placeholder for empty pane slots
- `packages/web/src/components/sidebar/WorkspaceSelector.tsx` -- dropdown + new path input
- `packages/web/src/components/sidebar/WorkspaceSelector.css`
- `packages/server/src/modules/terminal/__tests__/lifecycle.test.ts`
- `packages/server/src/modules/terminal/__tests__/reconnection.test.ts`
- `packages/server/src/modules/terminal/__tests__/error-handling.test.ts`
- `packages/server/src/db/__tests__/workspace-repository.test.ts`
- `packages/web/src/components/grid/__tests__/split-tree.test.ts`

### Modified files

- `packages/server/package.json` -- add `better-sqlite3`
- `packages/server/src/app.ts` -- add workspace API routes, init DB
- `packages/web/package.json` -- add `allotment`, remove `react-grid-layout`, `react-resizable`
- `packages/web/src/App.tsx` -- use SplitLayout, WorkspaceSelector
- `packages/web/src/components/grid/LayoutPresets.tsx` -- generate trees instead of grid params
- `packages/web/src/components/sidebar/TerminalManager.tsx` -- replace CWD input with WorkspaceSelector

### Deleted files

- `packages/web/src/components/grid/TerminalGrid.tsx`
- `packages/web/src/components/grid/TerminalGrid.css`
