# Look and Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Phase 1 UI with a design token system, structured sidebar, hover-reveal pane toolbars, improved empty slots, Inter font, and removal of the layout presets bar.

**Architecture:** A single `theme.css` defines all CSS custom properties; every component CSS file is rewritten to consume those variables. Minor JSX changes handle hover state and structural additions (section labels, status dots, app header). No new runtime dependencies — Inter loads via a Google Fonts `<link>`.

**Tech Stack:** React, plain CSS custom properties, Inter (Google Fonts), xterm.js (untouched)

---

### Task 1: Create theme.css and wire it up

**Files:**
- Create: `packages/web/src/theme.css`
- Modify: `packages/web/src/main.tsx`
- Modify: `packages/web/index.html`

- [ ] **Step 1: Create `packages/web/src/theme.css`**

```css
:root {
  /* Background layers */
  --color-bg: #0f0f0f;
  --color-surface-1: #171717;
  --color-surface-2: #1f1f1f;
  --color-surface-3: #2a2a2a;

  /* Borders */
  --color-border: #2e2e2e;
  --color-border-focus: #525252;

  /* Text */
  --color-text-primary: #e5e5e5;
  --color-text-secondary: #a3a3a3;
  --color-text-muted: #525252;

  /* Semantic */
  --color-success: #4ade80;
  --color-success-bg: rgba(74, 222, 128, 0.1);
  --color-error: #f87171;
  --color-error-bg: rgba(248, 113, 113, 0.1);

  /* Shape */
  --radius-sm: 4px;
  --radius-md: 6px;

  /* Typography */
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}

/* Thin scrollbars for sidebar and dropdowns */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-surface-3); border-radius: 2px; }
```

- [ ] **Step 2: Import theme.css in `packages/web/src/main.tsx`**

Add the import at the top (before the App import):

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Add Inter font link in `packages/web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Agent Auto Manager</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>* { margin: 0; padding: 0; box-sizing: border-box; }</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Verify dev server starts without errors**

Run: `cd packages/web && npm run dev` (or confirm it's already running on :11000)
Expected: no console errors, page loads with same layout as before (tokens not yet applied to components)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/theme.css packages/web/src/main.tsx packages/web/index.html
git commit -m "feat: add design token system and Inter font"
```

---

### Task 2: Remove LayoutPresets bar

**Files:**
- Delete: `packages/web/src/components/grid/LayoutPresets.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Delete `LayoutPresets.tsx`**

```bash
rm packages/web/src/components/grid/LayoutPresets.tsx
```

- [ ] **Step 2: Update `packages/web/src/App.tsx`**

Remove the `LayoutPresets` import and the toolbar `<div>` wrapping it. Also apply token variables to the root shell div and the remaining inner div:

```tsx
import { useEffect, useRef, useState } from 'react';
import { WebSocketClient } from './services/websocket-client';
import { initTerminalStore, useTerminals } from './stores/terminal-store';
import { SplitLayout } from './components/grid/SplitLayout';
import { TerminalManager } from './components/sidebar/TerminalManager';
import { type LayoutNode, createPreset, assignTerminals, splitLeaf, mergePane } from './components/grid/split-tree';

const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;

export function App() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const terminals = useTerminals();
  const [layout, setLayout] = useState<LayoutNode>({ type: 'leaf', terminalId: null });
  const [cwd, setCwd] = useState<string | null>(null);

  useEffect(() => {
    const ws = new WebSocketClient(wsUrl);
    wsRef.current = ws;
    const unsub = initTerminalStore(ws);
    ws.connect();
    return () => {
      unsub();
      ws.disconnect();
    };
  }, []);

  const terminalMap = new Map(terminals.map(t => [t.id, t]));

  function handlePresetSelect(_label: string, cols: number, rows: number) {
    const tree = createPreset(cols, rows);
    const terminalIds = terminals.map(t => t.id);
    setLayout(assignTerminals(tree, terminalIds));
  }

  function handleSpawn(name: string, spawnCwd: string) {
    setCwd(spawnCwd);
    wsRef.current?.send({ type: 'terminal:spawn', name, cwd: spawnCwd });
  }

  function handleSpawnInSlot(_leafPath: string) {
    if (!cwd) return;
    const name = `agent-${terminals.length + 1}`;
    wsRef.current?.send({ type: 'terminal:spawn', name, cwd });
  }

  function handleKill(id: string) {
    wsRef.current?.send({ type: 'terminal:kill', terminalId: id });
  }

  function handleSplitH(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'horizontal'));
  }

  function handleSplitV(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'vertical'));
  }

  function handleMerge(terminalId: string) {
    setLayout(prev => mergePane(prev, terminalId));
  }

  // When a new terminal is created, assign it to the first empty slot
  useEffect(() => {
    setLayout(prev => {
      const assignedIds = new Set<string>();
      function collectAssigned(node: LayoutNode) {
        if (node.type === 'leaf' && node.terminalId) assignedIds.add(node.terminalId);
        if (node.type === 'split') { node.children.forEach(collectAssigned); }
      }
      collectAssigned(prev);

      const unassigned = terminals.filter(t => !assignedIds.has(t.id));
      if (unassigned.length === 0) return prev;

      let tree = prev;
      for (const t of unassigned) {
        let placed = false;
        function placeInEmpty(node: LayoutNode): LayoutNode {
          if (placed) return node;
          if (node.type === 'leaf' && node.terminalId === null) {
            placed = true;
            return { type: 'leaf', terminalId: t.id };
          }
          if (node.type === 'split') {
            return {
              type: 'split', direction: node.direction, ratio: node.ratio,
              children: [placeInEmpty(node.children[0]), placeInEmpty(node.children[1])],
            };
          }
          return node;
        }
        tree = placeInEmpty(tree);
        if (!placed) {
          function findLastTerminalId(node: LayoutNode): string | null {
            if (node.type === 'leaf') return node.terminalId;
            return findLastTerminalId(node.children[1]) ?? findLastTerminalId(node.children[0]);
          }
          const lastId = findLastTerminalId(tree);
          if (lastId) {
            tree = splitLeaf(tree, lastId, 'horizontal');
            placed = false;
            tree = placeInEmpty(tree);
          }
        }
      }
      return tree;
    });
  }, [terminals]);

  // Remove exited terminals from layout
  useEffect(() => {
    const activeIds = new Set(terminals.map(t => t.id));
    setLayout(prev => {
      function clean(node: LayoutNode): LayoutNode {
        if (node.type === 'leaf') {
          if (node.terminalId && !activeIds.has(node.terminalId)) {
            return { type: 'leaf', terminalId: null };
          }
          return node;
        }
        return {
          type: 'split', direction: node.direction, ratio: node.ratio,
          children: [clean(node.children[0]), clean(node.children[1])],
        };
      }
      return clean(prev);
    });
  }, [terminals]);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-ui)' }}>
      <TerminalManager
        terminals={terminals}
        onSpawn={handleSpawn}
        onKill={handleKill}
        onPresetSelect={handlePresetSelect}
      />
      <SplitLayout
        layout={layout}
        terminals={terminalMap}
        ws={wsRef.current}
        onSpawnInSlot={handleSpawnInSlot}
        onSplitH={handleSplitH}
        onSplitV={handleSplitV}
        onMerge={handleMerge}
      />
    </div>
  );
}
```

Note: `onPresetSelect` is passed to `TerminalManager` so layout presets can move to the sidebar (Task 4). The `activePreset` state is removed since the presets bar is gone.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: errors only about `onPresetSelect` prop not existing on `TerminalManager` yet — that's fine, will be fixed in Task 4.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/App.tsx
git rm packages/web/src/components/grid/LayoutPresets.tsx
git commit -m "feat: remove layout presets bar, apply token vars to app shell"
```

---

### Task 3: Restyle TerminalPane (header, status dot, hover toolbar)

**Files:**
- Modify: `packages/web/src/components/terminal/TerminalPane.css`
- Modify: `packages/web/src/components/terminal/TerminalPane.tsx`

- [ ] **Step 1: Rewrite `packages/web/src/components/terminal/TerminalPane.css`**

```css
.terminal-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.terminal-pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  height: 32px;
  background: var(--color-surface-1);
  border-bottom: 1px solid var(--color-border);
  font-family: var(--font-ui);
  font-size: 12px;
  user-select: none;
  flex-shrink: 0;
}

.terminal-pane-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.terminal-pane-status-dot--running {
  background: var(--color-success);
}

.terminal-pane-status-dot--exited {
  background: var(--color-error);
}

.terminal-pane-name {
  flex: 1;
  font-weight: 500;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-pane-toolbar-wrapper {
  opacity: 0;
  transition: opacity 120ms ease;
}

.terminal-pane-header:hover .terminal-pane-toolbar-wrapper {
  opacity: 1;
}

.terminal-pane-body {
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  background: #1e1e1e;
}

.terminal-pane-body .xterm {
  height: 100%;
}
```

- [ ] **Step 2: Update `packages/web/src/components/terminal/TerminalPane.tsx`**

Replace the status badge `<span>` with a status dot `<div>`, and wrap `PaneToolbar` in the hover wrapper:

```tsx
  return (
    <div className="terminal-pane">
      <div className="terminal-pane-header">
        <div className={`terminal-pane-status-dot terminal-pane-status-dot--${terminal.status}`} />
        <span className="terminal-pane-name">{terminal.name}</span>
        {onSplitH && onSplitV && (
          <div className="terminal-pane-toolbar-wrapper">
            <PaneToolbar
              terminalId={terminal.id}
              onSplitH={onSplitH}
              onSplitV={onSplitV}
              onMerge={onMerge ?? (() => {})}
              canMerge={canMerge ?? false}
            />
          </div>
        )}
      </div>
      <div className="terminal-pane-body" ref={containerRef} />
    </div>
  );
```

- [ ] **Step 3: Verify visually in browser**

Open http://localhost:11000. Spawn a terminal. Expected: 32px header with green dot, terminal name in muted style, toolbar appears on header hover and disappears when mouse leaves.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/terminal/TerminalPane.css packages/web/src/components/terminal/TerminalPane.tsx
git commit -m "feat: restyle terminal pane header with status dot and hover toolbar"
```

---

### Task 4: Restyle PaneToolbar buttons

**Files:**
- Modify: `packages/web/src/components/grid/PaneToolbar.css`
- Modify: `packages/web/src/components/grid/PaneToolbar.tsx`

- [ ] **Step 1: Rewrite `packages/web/src/components/grid/PaneToolbar.css`**

```css
.pane-toolbar {
  display: flex;
  gap: 2px;
}

.pane-toolbar-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--color-text-muted);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
}

.pane-toolbar-btn:hover {
  background: var(--color-surface-3);
  color: var(--color-text-primary);
}

.pane-toolbar-btn--merge:hover {
  color: var(--color-error);
  background: var(--color-surface-3);
}
```

- [ ] **Step 2: Update `packages/web/src/components/grid/PaneToolbar.tsx`** to use SVG-style Unicode glyphs

```tsx
import './PaneToolbar.css';

interface PaneToolbarProps {
  terminalId: string;
  onSplitH: () => void;
  onSplitV: () => void;
  onMerge: () => void;
  canMerge: boolean;
}

export function PaneToolbar({ terminalId: _terminalId, onSplitH, onSplitV, onMerge, canMerge }: PaneToolbarProps) {
  return (
    <div className="pane-toolbar">
      <button className="pane-toolbar-btn" onClick={onSplitH} title="Split horizontally">
        ⊟
      </button>
      <button className="pane-toolbar-btn" onClick={onSplitV} title="Split vertically">
        ⊞
      </button>
      {canMerge && (
        <button className="pane-toolbar-btn pane-toolbar-btn--merge" onClick={onMerge} title="Close pane (keep this one)">
          ✕
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify visually**

Hover a terminal pane header. Expected: toolbar fades in with three icon buttons (⊟ ⊞ ✕), ✕ turns red on hover.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/grid/PaneToolbar.css packages/web/src/components/grid/PaneToolbar.tsx
git commit -m "feat: restyle pane toolbar with icon buttons and hover reveal"
```

---

### Task 5: Restyle EmptySlot

**Files:**
- Modify: `packages/web/src/components/grid/EmptySlot.tsx`

- [ ] **Step 1: Rewrite `packages/web/src/components/grid/EmptySlot.tsx`**

The inline styles are replaced with a CSS class approach. Since EmptySlot has no existing CSS file, add a small `EmptySlot.css`:

Create `packages/web/src/components/grid/EmptySlot.css`:

```css
.empty-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--color-surface-1);
  border: 1px dashed var(--color-border);
  cursor: pointer;
  gap: 6px;
  transition: border-color 120ms ease;
}

.empty-slot:hover {
  border-color: var(--color-border-focus);
}

.empty-slot:hover .empty-slot-icon,
.empty-slot:hover .empty-slot-label {
  color: var(--color-text-secondary);
}

.empty-slot-icon {
  font-size: 24px;
  color: var(--color-text-muted);
  line-height: 1;
}

.empty-slot-label {
  font-size: 12px;
  font-family: var(--font-ui);
  color: var(--color-text-muted);
}
```

Rewrite `packages/web/src/components/grid/EmptySlot.tsx`:

```tsx
import './EmptySlot.css';

interface EmptySlotProps {
  onSpawn: () => void;
}

export function EmptySlot({ onSpawn }: EmptySlotProps) {
  return (
    <div className="empty-slot" onClick={onSpawn} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSpawn(); }}>
      <span className="empty-slot-icon">+</span>
      <span className="empty-slot-label">Spawn terminal</span>
    </div>
  );
}
```

- [ ] **Step 2: Verify visually**

Spawn zero terminals on a 2x2 preset (via handlePresetSelect in console or by calling the function). Expected: empty slots show `+` icon and "Spawn terminal" label centered, dashed border brightens on hover.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/grid/EmptySlot.tsx packages/web/src/components/grid/EmptySlot.css
git commit -m "feat: restyle empty slot with icon+label and hover effect"
```

---

### Task 6: Restyle splitter (allotment)

**Files:**
- Modify: `packages/web/src/components/grid/SplitLayout.css`

- [ ] **Step 1: Rewrite `packages/web/src/components/grid/SplitLayout.css`**

```css
.split-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.split-layout .split-view-view {
  overflow: hidden;
}

/* Allotment sash (drag handle) */
.split-layout .sash {
  background: var(--color-border) !important;
  transition: background 120ms ease;
}

.split-layout .sash:hover,
.split-layout .sash.active {
  background: var(--color-border-focus) !important;
}
```

- [ ] **Step 2: Check allotment's actual sash class name**

Open browser devtools, inspect the drag handle between two panes. Note the actual class name (may be `.sash`, `.allotment-sash`, or similar). If different from `.sash`, update the selectors in `SplitLayout.css` accordingly.

- [ ] **Step 3: Verify visually**

Drag the splitter between two panes. Expected: the handle is a subtle `--color-border` line that brightens to `--color-border-focus` on hover/drag.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/grid/SplitLayout.css
git commit -m "feat: style allotment splitter with design tokens"
```

---

### Task 7: Restyle TerminalManager sidebar

**Files:**
- Modify: `packages/web/src/components/sidebar/TerminalManager.css`
- Modify: `packages/web/src/components/sidebar/TerminalManager.tsx`

- [ ] **Step 1: Rewrite `packages/web/src/components/sidebar/TerminalManager.css`**

```css
.terminal-manager {
  width: 240px;
  flex-shrink: 0;
  background: var(--color-surface-1);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--font-ui);
}

.terminal-manager-app-header {
  padding: 14px 12px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}

.terminal-manager-section {
  padding: 12px 12px 0;
}

.terminal-manager-section-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.terminal-manager-divider {
  height: 1px;
  background: var(--color-border);
  margin: 0;
}

.terminal-manager-spawn {
  display: flex;
  gap: 4px;
  padding: 8px 12px 12px;
}

.terminal-manager-spawn--disabled {
  opacity: 0.4;
  pointer-events: none;
}

.terminal-manager-input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: var(--font-ui);
  outline: none;
}

.terminal-manager-input:focus {
  border-color: var(--color-border-focus);
}

.terminal-manager-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.terminal-manager-btn {
  flex-shrink: 0;
  padding: 5px 10px;
  background: var(--color-surface-3);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-ui);
  white-space: nowrap;
}

.terminal-manager-btn:hover:not(:disabled) {
  background: var(--color-border);
  color: var(--color-text-primary);
}

.terminal-manager-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.terminal-manager-list {
  list-style: none;
  padding: 4px 8px;
  margin: 0;
  flex: 1;
  overflow-y: auto;
}

.terminal-manager-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  height: 36px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: default;
}

.terminal-manager-item:hover {
  background: var(--color-surface-2);
}

.terminal-manager-item-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.terminal-manager-item-dot--running {
  background: var(--color-success);
}

.terminal-manager-item-dot--exited {
  background: var(--color-error);
}

.terminal-manager-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.terminal-manager-item-kill {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 80ms ease, color 80ms ease;
  line-height: 1;
}

.terminal-manager-item:hover .terminal-manager-item-kill {
  opacity: 1;
}

.terminal-manager-item-kill:hover {
  color: var(--color-error);
}

.terminal-manager-empty {
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 8px 4px;
}
```

- [ ] **Step 2: Update `packages/web/src/components/sidebar/TerminalManager.tsx`**

Add app header, section labels, dividers, status dots. Also add the `onPresetSelect` prop (used by App.tsx for the 2x2 preset that will now live in the sidebar):

```tsx
import { useState } from 'react';
import type { TerminalInfo } from '../../types';
import './TerminalManager.css';
import { WorkspaceSelector } from './WorkspaceSelector';

interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name: string, cwd: string) => void;
  onKill: (id: string) => void;
  onPresetSelect: (label: string, cols: number, rows: number) => void;
}

export function TerminalManager({ terminals, onSpawn, onKill, onPresetSelect: _onPresetSelect }: TerminalManagerProps) {
  const [newName, setNewName] = useState('');
  const [activeCwd, setActiveCwd] = useState<string | null>(null);

  function handleSpawn() {
    if (!activeCwd) return;
    const name = newName.trim() || `agent-${terminals.length + 1}`;
    onSpawn(name, activeCwd);
    setNewName('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSpawn();
  }

  return (
    <div className="terminal-manager">
      <div className="terminal-manager-app-header">CAAM</div>

      <div className="terminal-manager-section">
        <div className="terminal-manager-section-label">Workspace</div>
        <WorkspaceSelector
          onSelect={(ws) => { setActiveCwd(ws.path); }}
          onNewPath={(p) => { setActiveCwd(p); }}
          locked={!!activeCwd}
          onUnlock={() => setActiveCwd(null)}
        />
      </div>

      <div className="terminal-manager-divider" />

      <div className="terminal-manager-section">
        <div className="terminal-manager-section-label">Terminals</div>
      </div>
      <div className={'terminal-manager-spawn' + (activeCwd ? '' : ' terminal-manager-spawn--disabled')}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Terminal name..."
          className="terminal-manager-input"
          disabled={!activeCwd}
        />
        <button onClick={handleSpawn} className="terminal-manager-btn" disabled={!activeCwd}>
          Spawn
        </button>
      </div>

      <ul className="terminal-manager-list">
        {terminals.map((t) => (
          <li key={t.id} className="terminal-manager-item">
            <div className={`terminal-manager-item-dot terminal-manager-item-dot--${t.status}`} />
            <span className="terminal-manager-item-name">{t.name}</span>
            <button
              className="terminal-manager-item-kill"
              onClick={() => onKill(t.id)}
              title="Kill terminal"
            >
              ✕
            </button>
          </li>
        ))}
        {terminals.length === 0 && (
          <li className="terminal-manager-empty">No terminals running</li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Verify visually**

Open http://localhost:11000. Expected: sidebar is 240px wide with "CAAM" header in small caps at top, "Workspace" section label, divider, "Terminals" section label, spawn row, terminal list with status dots and hover-reveal kill button.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/sidebar/TerminalManager.css packages/web/src/components/sidebar/TerminalManager.tsx
git commit -m "feat: restyle sidebar with structured IDE panel layout"
```

---

### Task 8: Restyle WorkspaceSelector

**Files:**
- Modify: `packages/web/src/components/sidebar/WorkspaceSelector.css`

- [ ] **Step 1: Rewrite `packages/web/src/components/sidebar/WorkspaceSelector.css`**

```css
.workspace-selector {
  margin-bottom: 12px;
}

.workspace-selector-recent {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 6px;
}

.workspace-selector-recent-item {
  text-align: left;
  padding: 5px 8px;
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-selector-recent-item:hover {
  border-color: var(--color-border-focus);
  color: var(--color-text-primary);
}

.workspace-selector-row {
  display: flex;
  gap: 4px;
}

.workspace-selector-autocomplete {
  flex: 1;
  position: relative;
  min-width: 0;
}

.workspace-selector-input {
  width: 100%;
  padding: 5px 8px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: var(--font-mono);
  outline: none;
}

.workspace-selector-input:focus {
  border-color: var(--color-border-focus);
}

.workspace-selector-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.workspace-selector-input--error {
  border-color: var(--color-error);
}

.workspace-selector-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  list-style: none;
  padding: 4px 0;
  margin: 2px 0 0 0;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.workspace-selector-suggestion {
  padding: 5px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-selector-suggestion:hover,
.workspace-selector-suggestion--selected {
  background: var(--color-surface-3);
  color: var(--color-text-primary);
}

.workspace-selector-btn {
  flex-shrink: 0;
  padding: 5px 10px;
  background: var(--color-surface-3);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-ui);
  white-space: nowrap;
}

.workspace-selector-btn:hover:not(:disabled) {
  background: var(--color-border);
}

.workspace-selector-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.workspace-selector-btn--secondary {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text-muted);
}

.workspace-selector-btn--secondary:hover:not(:disabled) {
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
}

.workspace-selector-error {
  font-size: 11px;
  color: var(--color-error);
  margin-top: 4px;
  font-family: var(--font-ui);
}

.workspace-selector-success {
  font-size: 11px;
  color: var(--color-success);
  margin-top: 4px;
  font-family: var(--font-ui);
}
```

- [ ] **Step 2: Verify visually**

Click the path input. Expected: mono font for path display, dropdown has box-shadow, suggestion highlight uses `--color-surface-3` instead of blue.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/sidebar/WorkspaceSelector.css
git commit -m "feat: restyle workspace selector with design tokens"
```

---

### Task 9: Final integration check

- [ ] **Step 1: Run full TypeScript check**

```bash
cd packages/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 2: Run existing frontend tests**

```bash
cd packages/web && npx vitest run
```
Expected: all tests pass (split-tree tests are unaffected by CSS changes)

- [ ] **Step 3: Run backend tests**

```bash
cd packages/server && npm test
```
Expected: all tests pass

- [ ] **Step 4: Visual smoke test in browser**

Open http://localhost:11000. Check:
- Inter font loaded (inspect `font-family` on sidebar text)
- Sidebar: 240px wide, "CAAM" header, section labels with divider
- No layout presets bar visible
- Spawn a terminal: status dot appears (green), pane header is 32px with muted name
- Hover pane header: toolbar fades in with ⊟ ⊞ ✕ icons
- Split H, split V: splitter drag handle is subtle, brightens on hover
- Kill terminal: dot turns red, slot shows `+` icon placeholder
- WorkspaceSelector: mono font for paths, no blue highlights

- [ ] **Step 5: Commit if any last fixes were needed, then push**

```bash
git push origin feat/phase1-terminal-grid
```
