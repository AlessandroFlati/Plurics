# Phase 1 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the grid layout with Terminator-style split panes, add SQLite workspace persistence, and expand integration test coverage.

**Architecture:** Recursive binary split tree rendered with `allotment`. SQLite via `better-sqlite3` for workspace CRUD. Tests split by category into separate files.

**Tech Stack:** allotment, better-sqlite3, vitest

---

### Task 1: Install Dependencies

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/server/package.json`

- [ ] **Step 1: Remove react-grid-layout, add allotment**

```bash
cd /mnt/c/Users/aless/PycharmProjects/ClaudeAgentAutoManager
npm uninstall react-grid-layout react-resizable @types/react-grid-layout --workspace=packages/web
npm install allotment --workspace=packages/web
```

- [ ] **Step 2: Remove @xterm/addon-fit (no longer used)**

```bash
npm uninstall @xterm/addon-fit --workspace=packages/web
```

- [ ] **Step 3: Add better-sqlite3 to server**

```bash
npm install better-sqlite3 --workspace=packages/server
npm install -D @types/better-sqlite3 --workspace=packages/server
```

- [ ] **Step 4: Verify install**

Run: `npm ls allotment --workspace=packages/web && npm ls better-sqlite3 --workspace=packages/server`
Expected: Both packages listed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/web/package.json packages/server/package.json
git commit -m "chore: replace react-grid-layout with allotment, add better-sqlite3"
```

---

### Task 2: Split Tree Data Model (Pure Functions)

**Files:**
- Create: `packages/web/src/components/grid/split-tree.ts`
- Create: `packages/web/src/components/grid/__tests__/split-tree.test.ts`

- [ ] **Step 1: Write failing tests for split tree operations**

```typescript
// packages/web/src/components/grid/__tests__/split-tree.test.ts

import { describe, it, expect } from 'vitest';
import {
  type LayoutNode,
  createPreset,
  countLeaves,
  findLeaf,
  splitLeaf,
  mergePane,
  assignTerminals,
} from '../split-tree';

describe('split-tree', () => {
  describe('createPreset', () => {
    it('creates a single leaf for 1x1', () => {
      const tree = createPreset(1, 1);
      expect(tree.type).toBe('leaf');
    });

    it('creates a horizontal split for 2x1', () => {
      const tree = createPreset(2, 1);
      expect(tree.type).toBe('split');
      if (tree.type === 'split') {
        expect(tree.direction).toBe('horizontal');
        expect(tree.children[0].type).toBe('leaf');
        expect(tree.children[1].type).toBe('leaf');
      }
    });

    it('creates a 2x2 grid with 4 leaves', () => {
      const tree = createPreset(2, 2);
      expect(countLeaves(tree)).toBe(4);
    });

    it('creates a 3x2 grid with 6 leaves', () => {
      const tree = createPreset(3, 2);
      expect(countLeaves(tree)).toBe(6);
    });

    it('creates a 3x3 grid with 9 leaves', () => {
      const tree = createPreset(3, 3);
      expect(countLeaves(tree)).toBe(9);
    });
  });

  describe('assignTerminals', () => {
    it('assigns terminal IDs to leaves in order', () => {
      const tree = createPreset(2, 2);
      const assigned = assignTerminals(tree, ['t1', 't2', 't3']);
      const leaves: string[] = [];
      function collect(node: LayoutNode) {
        if (node.type === 'leaf') { if (node.terminalId) leaves.push(node.terminalId); }
        else { node.children.forEach(collect); }
      }
      collect(assigned);
      expect(leaves).toEqual(['t1', 't2', 't3']);
    });
  });

  describe('splitLeaf', () => {
    it('splits a leaf horizontally', () => {
      const tree: LayoutNode = { type: 'leaf', terminalId: 't1' };
      const result = splitLeaf(tree, 't1', 'horizontal');
      expect(result.type).toBe('split');
      if (result.type === 'split') {
        expect(result.direction).toBe('horizontal');
        expect(result.children[0]).toEqual({ type: 'leaf', terminalId: 't1' });
        expect(result.children[1]).toEqual({ type: 'leaf', terminalId: null });
      }
    });

    it('splits a leaf vertically', () => {
      const tree: LayoutNode = { type: 'leaf', terminalId: 't1' };
      const result = splitLeaf(tree, 't1', 'vertical');
      if (result.type === 'split') {
        expect(result.direction).toBe('vertical');
      }
    });

    it('splits a nested leaf', () => {
      const tree: LayoutNode = {
        type: 'split', direction: 'horizontal', ratio: 0.5,
        children: [
          { type: 'leaf', terminalId: 't1' },
          { type: 'leaf', terminalId: 't2' },
        ],
      };
      const result = splitLeaf(tree, 't2', 'vertical');
      expect(countLeaves(result)).toBe(3);
    });
  });

  describe('mergePane', () => {
    it('keeps the specified pane and removes sibling', () => {
      const tree: LayoutNode = {
        type: 'split', direction: 'horizontal', ratio: 0.5,
        children: [
          { type: 'leaf', terminalId: 't1' },
          { type: 'leaf', terminalId: 't2' },
        ],
      };
      const result = mergePane(tree, 't1');
      expect(result).toEqual({ type: 'leaf', terminalId: 't1' });
    });

    it('merges in a nested tree', () => {
      const tree: LayoutNode = {
        type: 'split', direction: 'vertical', ratio: 0.5,
        children: [
          { type: 'leaf', terminalId: 't1' },
          {
            type: 'split', direction: 'horizontal', ratio: 0.5,
            children: [
              { type: 'leaf', terminalId: 't2' },
              { type: 'leaf', terminalId: 't3' },
            ],
          },
        ],
      };
      const result = mergePane(tree, 't2');
      expect(countLeaves(result)).toBe(2);
    });
  });

  describe('findLeaf', () => {
    it('returns true for existing terminal', () => {
      const tree = createPreset(2, 2);
      const assigned = assignTerminals(tree, ['t1']);
      expect(findLeaf(assigned, 't1')).toBe(true);
    });

    it('returns false for missing terminal', () => {
      const tree = createPreset(1, 1);
      expect(findLeaf(tree, 'nonexistent')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/aless/PycharmProjects/ClaudeAgentAutoManager && npx vitest run packages/web/src/components/grid/__tests__/split-tree.test.ts`
Expected: FAIL -- cannot find module `../split-tree`

- [ ] **Step 3: Implement split tree module**

```typescript
// packages/web/src/components/grid/split-tree.ts

export type SplitDirection = 'horizontal' | 'vertical';

export type LayoutNode =
  | { type: 'leaf'; terminalId: string | null }
  | { type: 'split'; direction: SplitDirection; ratio: number; children: [LayoutNode, LayoutNode] };

export function createPreset(cols: number, rows: number): LayoutNode {
  if (cols === 1 && rows === 1) {
    return { type: 'leaf', terminalId: null };
  }

  if (rows === 1) {
    return splitN(cols, 'horizontal');
  }

  if (cols === 1) {
    return splitN(rows, 'vertical');
  }

  // Multi-row: vertical split of rows, each row is a horizontal split of cols
  const rowNodes: LayoutNode[] = [];
  for (let r = 0; r < rows; r++) {
    rowNodes.push(splitN(cols, 'horizontal'));
  }
  return buildBalancedTree(rowNodes, 'vertical');
}

function splitN(count: number, direction: SplitDirection): LayoutNode {
  if (count === 1) return { type: 'leaf', terminalId: null };
  const nodes: LayoutNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({ type: 'leaf', terminalId: null });
  }
  return buildBalancedTree(nodes, direction);
}

function buildBalancedTree(nodes: LayoutNode[], direction: SplitDirection): LayoutNode {
  if (nodes.length === 1) return nodes[0];
  if (nodes.length === 2) {
    return { type: 'split', direction, ratio: 0.5, children: [nodes[0], nodes[1]] };
  }
  const mid = Math.ceil(nodes.length / 2);
  const left = buildBalancedTree(nodes.slice(0, mid), direction);
  const right = buildBalancedTree(nodes.slice(mid), direction);
  return { type: 'split', direction, ratio: mid / nodes.length, children: [left, right] };
}

export function countLeaves(node: LayoutNode): number {
  if (node.type === 'leaf') return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

export function findLeaf(node: LayoutNode, terminalId: string): boolean {
  if (node.type === 'leaf') return node.terminalId === terminalId;
  return findLeaf(node.children[0], terminalId) || findLeaf(node.children[1], terminalId);
}

export function assignTerminals(node: LayoutNode, terminalIds: string[]): LayoutNode {
  let idx = 0;
  function assign(n: LayoutNode): LayoutNode {
    if (n.type === 'leaf') {
      const id = idx < terminalIds.length ? terminalIds[idx++] : null;
      return { type: 'leaf', terminalId: id };
    }
    return {
      type: 'split',
      direction: n.direction,
      ratio: n.ratio,
      children: [assign(n.children[0]), assign(n.children[1])],
    };
  }
  return assign(node);
}

export function splitLeaf(
  node: LayoutNode,
  terminalId: string,
  direction: SplitDirection,
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.terminalId === terminalId) {
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        children: [
          { type: 'leaf', terminalId },
          { type: 'leaf', terminalId: null },
        ],
      };
    }
    return node;
  }
  return {
    type: 'split',
    direction: node.direction,
    ratio: node.ratio,
    children: [
      splitLeaf(node.children[0], terminalId, direction),
      splitLeaf(node.children[1], terminalId, direction),
    ],
  };
}

export function mergePane(node: LayoutNode, keepTerminalId: string): LayoutNode {
  if (node.type === 'leaf') return node;

  // Check if one of our direct children contains the terminal to keep
  const leftHas = findLeaf(node.children[0], keepTerminalId);
  const rightHas = findLeaf(node.children[1], keepTerminalId);

  if (leftHas && !rightHas) {
    // If the left child IS the leaf we want to keep, remove the split
    if (node.children[0].type === 'leaf' && node.children[0].terminalId === keepTerminalId) {
      return node.children[0];
    }
    // Otherwise recurse into the left subtree
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      children: [mergePane(node.children[0], keepTerminalId), node.children[1]],
    };
  }

  if (rightHas && !leftHas) {
    if (node.children[1].type === 'leaf' && node.children[1].terminalId === keepTerminalId) {
      return node.children[1];
    }
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      children: [node.children[0], mergePane(node.children[1], keepTerminalId)],
    };
  }

  // Both have it (shouldn't happen) or neither -- return as-is
  return node;
}
```

- [ ] **Step 4: Add vitest config for web package**

The web package needs vitest for frontend unit tests. Add to `packages/web/package.json` scripts and install:

```bash
npm install -D vitest --workspace=packages/web
```

Add to `packages/web/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/web/src/components/grid/__tests__/split-tree.test.ts`
Expected: All 10 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/
git commit -m "feat: add split tree data model with preset, split, merge operations"
```

---

### Task 3: SplitLayout Component

**Files:**
- Create: `packages/web/src/components/grid/SplitLayout.tsx`
- Create: `packages/web/src/components/grid/SplitLayout.css`
- Create: `packages/web/src/components/grid/EmptySlot.tsx`

- [ ] **Step 1: Create EmptySlot component**

```tsx
// packages/web/src/components/grid/EmptySlot.tsx

import type { WebSocketClient } from '../../services/websocket-client';

interface EmptySlotProps {
  onSpawn: () => void;
}

export function EmptySlot({ onSpawn }: EmptySlotProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: '#1a1a1a',
      border: '1px dashed #444',
      borderRadius: 4,
    }}>
      <button
        onClick={onSpawn}
        style={{
          padding: '8px 16px',
          background: '#0e639c',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Spawn here
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create SplitLayout component**

```tsx
// packages/web/src/components/grid/SplitLayout.tsx

import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TerminalPane } from '../terminal/TerminalPane';
import { EmptySlot } from './EmptySlot';
import type { LayoutNode } from './split-tree';
import type { TerminalInfo } from '../../types';
import type { WebSocketClient } from '../../services/websocket-client';
import './SplitLayout.css';

interface SplitLayoutProps {
  layout: LayoutNode;
  terminals: Map<string, TerminalInfo>;
  ws: WebSocketClient | null;
  onSpawnInSlot: (leafPath: string) => void;
}

export function SplitLayout({ layout, terminals, ws, onSpawnInSlot }: SplitLayoutProps) {
  return (
    <div className="split-layout">
      <RenderNode node={layout} terminals={terminals} ws={ws} onSpawnInSlot={onSpawnInSlot} path="root" />
    </div>
  );
}

interface RenderNodeProps {
  node: LayoutNode;
  terminals: Map<string, TerminalInfo>;
  ws: WebSocketClient | null;
  onSpawnInSlot: (leafPath: string) => void;
  path: string;
}

function RenderNode({ node, terminals, ws, onSpawnInSlot, path }: RenderNodeProps) {
  if (node.type === 'leaf') {
    if (node.terminalId && terminals.has(node.terminalId)) {
      return <TerminalPane terminal={terminals.get(node.terminalId)!} ws={ws} />;
    }
    return <EmptySlot onSpawn={() => onSpawnInSlot(path)} />;
  }

  const isVertical = node.direction === 'vertical';

  return (
    <Allotment vertical={isVertical} defaultSizes={[node.ratio * 100, (1 - node.ratio) * 100]}>
      <Allotment.Pane minSize={isVertical ? 100 : 200}>
        <RenderNode node={node.children[0]} terminals={terminals} ws={ws} onSpawnInSlot={onSpawnInSlot} path={`${path}.0`} />
      </Allotment.Pane>
      <Allotment.Pane minSize={isVertical ? 100 : 200}>
        <RenderNode node={node.children[1]} terminals={terminals} ws={ws} onSpawnInSlot={onSpawnInSlot} path={`${path}.1`} />
      </Allotment.Pane>
    </Allotment>
  );
}
```

- [ ] **Step 3: Create SplitLayout.css**

```css
/* packages/web/src/components/grid/SplitLayout.css */

.split-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.split-layout .split-view-view {
  overflow: hidden;
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=packages/web`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/grid/
git commit -m "feat: add SplitLayout component with allotment recursive rendering"
```

---

### Task 4: PaneToolbar (Split/Merge Buttons)

**Files:**
- Create: `packages/web/src/components/grid/PaneToolbar.tsx`
- Create: `packages/web/src/components/grid/PaneToolbar.css`

- [ ] **Step 1: Create PaneToolbar component**

```tsx
// packages/web/src/components/grid/PaneToolbar.tsx

import './PaneToolbar.css';

interface PaneToolbarProps {
  terminalId: string;
  onSplitH: () => void;
  onSplitV: () => void;
  onMerge: () => void;
  canMerge: boolean;
}

export function PaneToolbar({ terminalId, onSplitH, onSplitV, onMerge, canMerge }: PaneToolbarProps) {
  return (
    <div className="pane-toolbar">
      <button className="pane-toolbar-btn" onClick={onSplitH} title="Split horizontal">
        H
      </button>
      <button className="pane-toolbar-btn" onClick={onSplitV} title="Split vertical">
        V
      </button>
      {canMerge && (
        <button className="pane-toolbar-btn pane-toolbar-btn--merge" onClick={onMerge} title="Merge (keep this pane)">
          M
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create PaneToolbar.css**

```css
/* packages/web/src/components/grid/PaneToolbar.css */

.pane-toolbar {
  display: flex;
  gap: 2px;
  margin-left: auto;
}

.pane-toolbar-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #3c3c3c;
  color: #999;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  padding: 0;
}

.pane-toolbar-btn:hover {
  background: #505050;
  color: #fff;
}

.pane-toolbar-btn--merge:hover {
  background: #dc2626;
}
```

- [ ] **Step 3: Integrate PaneToolbar into TerminalPane header**

Modify `packages/web/src/components/terminal/TerminalPane.tsx` to accept optional toolbar props and render PaneToolbar in the header:

Add to the TerminalPaneProps interface:
```typescript
  onSplitH?: () => void;
  onSplitV?: () => void;
  onMerge?: () => void;
  canMerge?: boolean;
```

Add PaneToolbar import and render it in the header div, after the status span:
```tsx
import { PaneToolbar } from '../grid/PaneToolbar';

// In the header div, after the status span:
{onSplitH && onSplitV && (
  <PaneToolbar
    terminalId={terminal.id}
    onSplitH={onSplitH}
    onSplitV={onSplitV}
    onMerge={onMerge ?? (() => {})}
    canMerge={canMerge ?? false}
  />
)}
```

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=packages/web`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/grid/PaneToolbar.tsx packages/web/src/components/grid/PaneToolbar.css packages/web/src/components/terminal/TerminalPane.tsx
git commit -m "feat: add PaneToolbar with split H/V and merge buttons"
```

---

### Task 5: Wire Up SplitLayout in App + Update LayoutPresets

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/grid/LayoutPresets.tsx`
- Delete: `packages/web/src/components/grid/TerminalGrid.tsx`
- Delete: `packages/web/src/components/grid/TerminalGrid.css`

- [ ] **Step 1: Update LayoutPresets to emit preset labels**

```tsx
// packages/web/src/components/grid/LayoutPresets.tsx

interface LayoutPresetsProps {
  activePreset: string | null;
  onSelect: (label: string, cols: number, rows: number) => void;
}

const PRESETS = [
  { label: '1x1', cols: 1, rows: 1 },
  { label: '2x1', cols: 2, rows: 1 },
  { label: '2x2', cols: 2, rows: 2 },
  { label: '3x2', cols: 3, rows: 2 },
  { label: '3x3', cols: 3, rows: 3 },
];

export function LayoutPresets({ activePreset, onSelect }: LayoutPresetsProps) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {PRESETS.map((p) => {
        const isActive = p.label === activePreset;
        return (
          <button
            key={p.label}
            onClick={() => onSelect(p.label, p.cols, p.rows)}
            style={{
              padding: '4px 8px',
              background: isActive ? '#0e639c' : '#3c3c3c',
              color: isActive ? '#fff' : '#ccc',
              border: isActive ? '1px solid #0e639c' : '1px solid #555',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite App.tsx to use SplitLayout**

```tsx
// packages/web/src/App.tsx

import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketClient } from './services/websocket-client';
import { initTerminalStore, useTerminals } from './stores/terminal-store';
import { SplitLayout } from './components/grid/SplitLayout';
import { LayoutPresets } from './components/grid/LayoutPresets';
import { TerminalManager } from './components/sidebar/TerminalManager';
import { type LayoutNode, createPreset, assignTerminals, splitLeaf, mergePane } from './components/grid/split-tree';

const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;

export function App() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const terminals = useTerminals();
  const [layout, setLayout] = useState<LayoutNode>({ type: 'leaf', terminalId: null });
  const [activePreset, setActivePreset] = useState<string | null>('1x1');
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

  // Build a terminal map for quick lookup
  const terminalMap = new Map(terminals.map(t => [t.id, t]));

  function handlePresetSelect(label: string, cols: number, rows: number) {
    const tree = createPreset(cols, rows);
    const terminalIds = terminals.map(t => t.id);
    setLayout(assignTerminals(tree, terminalIds));
    setActivePreset(label);
  }

  function handleSpawn(name: string, spawnCwd: string) {
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
    setActivePreset(null);
  }

  function handleSplitV(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'vertical'));
    setActivePreset(null);
  }

  function handleMerge(terminalId: string) {
    setLayout(prev => mergePane(prev, terminalId));
    setActivePreset(null);
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
        // If no empty slot, split the last leaf
        if (!placed) {
          function findLastTerminalId(node: LayoutNode): string | null {
            if (node.type === 'leaf') return node.terminalId;
            return findLastTerminalId(node.children[1]) ?? findLastTerminalId(node.children[0]);
          }
          const lastId = findLastTerminalId(tree);
          if (lastId) {
            tree = splitLeaf(tree, lastId, 'horizontal');
            // Now place in the new empty slot
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
    <div style={{ display: 'flex', height: '100vh', background: '#1e1e1e', color: '#fff' }}>
      <TerminalManager
        terminals={terminals}
        onSpawn={(name: string, spawnCwd: string) => { setCwd(spawnCwd); handleSpawn(name, spawnCwd); }}
        onKill={handleKill}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '6px 8px', background: '#252525', borderBottom: '1px solid #333' }}>
          <LayoutPresets activePreset={activePreset} onSelect={handlePresetSelect} />
        </div>
        <SplitLayout
          layout={layout}
          terminals={terminalMap}
          ws={wsRef.current}
          onSpawnInSlot={handleSpawnInSlot}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update SplitLayout to pass toolbar callbacks through**

Update `RenderNode` in `SplitLayout.tsx` to accept and pass split/merge callbacks:

Add to SplitLayoutProps:
```typescript
  onSplitH: (terminalId: string) => void;
  onSplitV: (terminalId: string) => void;
  onMerge: (terminalId: string) => void;
```

Pass these through to RenderNodeProps and into TerminalPane:
```tsx
// In the leaf rendering:
if (node.terminalId && terminals.has(node.terminalId)) {
  const t = terminals.get(node.terminalId)!;
  return (
    <TerminalPane
      terminal={t}
      ws={ws}
      onSplitH={() => onSplitH(t.id)}
      onSplitV={() => onSplitV(t.id)}
      onMerge={() => onMerge(t.id)}
      canMerge={path !== 'root'}
    />
  );
}
```

And update the App.tsx SplitLayout call to pass the handlers:
```tsx
<SplitLayout
  layout={layout}
  terminals={terminalMap}
  ws={wsRef.current}
  onSpawnInSlot={handleSpawnInSlot}
  onSplitH={handleSplitH}
  onSplitV={handleSplitV}
  onMerge={handleMerge}
/>
```

- [ ] **Step 4: Delete old grid files**

```bash
rm packages/web/src/components/grid/TerminalGrid.tsx packages/web/src/components/grid/TerminalGrid.css
```

- [ ] **Step 5: Verify build**

Run: `npm run build --workspace=packages/web`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: replace react-grid-layout with allotment split panes"
```

---

### Task 6: SQLite Database Setup

**Files:**
- Create: `packages/server/src/db/database.ts`

- [ ] **Step 1: Create database module**

```typescript
// packages/server/src/db/database.ts

import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DB_DIR = path.join(os.homedir(), '.caam');
const DB_PATH = path.join(DB_DIR, 'caam.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      label TEXT,
      default_layout TEXT,
      default_terminal_count INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      use_count INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS workspace_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      purpose TEXT,
      sort_order INTEGER DEFAULT 0
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /mnt/c/Users/aless/PycharmProjects/ClaudeAgentAutoManager/packages/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/
git commit -m "feat: add SQLite database initialization with workspace schema"
```

---

### Task 7: Workspace Repository

**Files:**
- Create: `packages/server/src/db/workspace-repository.ts`
- Create: `packages/server/src/db/__tests__/workspace-repository.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/server/src/db/__tests__/workspace-repository.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorkspaceRepository, type Workspace, type WorkspaceAgent } from '../workspace-repository.js';

let db: Database.Database;
let repo: WorkspaceRepository;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      label TEXT,
      default_layout TEXT,
      default_terminal_count INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      use_count INTEGER DEFAULT 1
    );
    CREATE TABLE workspace_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      purpose TEXT,
      sort_order INTEGER DEFAULT 0
    );
  `);
  repo = new WorkspaceRepository(db);
});

afterEach(() => {
  db.close();
});

describe('WorkspaceRepository', () => {
  it('creates and lists workspaces', () => {
    repo.create({ path: '/tmp/test1', label: 'Test 1' });
    repo.create({ path: '/tmp/test2', label: 'Test 2' });
    const all = repo.list();
    expect(all).toHaveLength(2);
    expect(all[0].path).toBe('/tmp/test2'); // most recent first
  });

  it('rejects duplicate paths', () => {
    repo.create({ path: '/tmp/dup' });
    expect(() => repo.create({ path: '/tmp/dup' })).toThrow();
  });

  it('selects workspace and bumps usage', () => {
    const ws = repo.create({ path: '/tmp/sel' });
    const before = repo.list()[0];
    expect(before.use_count).toBe(1);

    repo.select(ws.id);
    const after = repo.list()[0];
    expect(after.use_count).toBe(2);
    expect(after.last_used_at).toBeGreaterThanOrEqual(before.last_used_at);
  });

  it('updates workspace label', () => {
    const ws = repo.create({ path: '/tmp/upd' });
    repo.update(ws.id, { label: 'Updated' });
    const updated = repo.list().find(w => w.id === ws.id)!;
    expect(updated.label).toBe('Updated');
  });

  it('deletes workspace and cascades agents', () => {
    const ws = repo.create({ path: '/tmp/del' });
    repo.addAgent(ws.id, { name: 'agent1', purpose: 'test' });
    repo.remove(ws.id);
    expect(repo.list()).toHaveLength(0);
  });

  it('creates workspace with agents', () => {
    const ws = repo.create({
      path: '/tmp/agents',
      agents: [
        { name: 'coder', purpose: 'Write code' },
        { name: 'reviewer', purpose: 'Review code' },
      ],
    });
    const agents = repo.getAgents(ws.id);
    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe('coder');
    expect(agents[1].name).toBe('reviewer');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=packages/server`
Expected: FAIL -- cannot find module `../workspace-repository.js`

- [ ] **Step 3: Implement WorkspaceRepository**

```typescript
// packages/server/src/db/workspace-repository.ts

import type Database from 'better-sqlite3';

export interface Workspace {
  id: number;
  path: string;
  label: string | null;
  default_layout: string | null;
  default_terminal_count: number;
  created_at: number;
  last_used_at: number;
  use_count: number;
}

export interface WorkspaceAgent {
  id: number;
  workspace_id: number;
  name: string;
  purpose: string | null;
  sort_order: number;
}

export interface CreateWorkspaceInput {
  path: string;
  label?: string;
  default_layout?: string;
  default_terminal_count?: number;
  agents?: Array<{ name: string; purpose?: string }>;
}

export interface UpdateWorkspaceInput {
  label?: string;
  default_layout?: string;
  default_terminal_count?: number;
}

export class WorkspaceRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateWorkspaceInput): Workspace {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO workspaces (path, label, default_layout, default_terminal_count, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.path,
      input.label ?? null,
      input.default_layout ?? null,
      input.default_terminal_count ?? 1,
      now,
      now,
    );
    const id = result.lastInsertRowid as number;

    if (input.agents) {
      for (let i = 0; i < input.agents.length; i++) {
        this.addAgent(id, { ...input.agents[i], sort_order: i });
      }
    }

    return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace;
  }

  list(): Workspace[] {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY last_used_at DESC').all() as Workspace[];
  }

  select(id: number): void {
    this.db.prepare('UPDATE workspaces SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?')
      .run(Date.now(), id);
  }

  update(id: number, input: UpdateWorkspaceInput): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.label !== undefined) { fields.push('label = ?'); values.push(input.label); }
    if (input.default_layout !== undefined) { fields.push('default_layout = ?'); values.push(input.default_layout); }
    if (input.default_terminal_count !== undefined) { fields.push('default_terminal_count = ?'); values.push(input.default_terminal_count); }

    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }

  addAgent(workspaceId: number, agent: { name: string; purpose?: string; sort_order?: number }): WorkspaceAgent {
    const result = this.db.prepare(
      'INSERT INTO workspace_agents (workspace_id, name, purpose, sort_order) VALUES (?, ?, ?, ?)'
    ).run(workspaceId, agent.name, agent.purpose ?? null, agent.sort_order ?? 0);
    return this.db.prepare('SELECT * FROM workspace_agents WHERE id = ?').get(result.lastInsertRowid) as WorkspaceAgent;
  }

  getAgents(workspaceId: number): WorkspaceAgent[] {
    return this.db.prepare('SELECT * FROM workspace_agents WHERE workspace_id = ? ORDER BY sort_order')
      .all(workspaceId) as WorkspaceAgent[];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/server`
Expected: All tests pass (existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/
git commit -m "feat: implement WorkspaceRepository with CRUD operations and agents"
```

---

### Task 8: Workspace API Routes

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Add workspace routes to app.ts**

Add after the existing `/api/list-dirs` route, before `createWebSocketServer`:

```typescript
import { getDb } from './db/database.js';
import { WorkspaceRepository } from './db/workspace-repository.js';

const workspaceRepo = new WorkspaceRepository(getDb());

app.get('/api/workspaces', (_req, res) => {
  const workspaces = workspaceRepo.list();
  res.json(workspaces.map(w => ({
    ...w,
    agents: workspaceRepo.getAgents(w.id),
  })));
});

app.post('/api/workspaces', (req, res) => {
  try {
    const ws = workspaceRepo.create(req.body);
    res.json({ ...ws, agents: workspaceRepo.getAgents(ws.id) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create workspace' });
  }
});

app.put('/api/workspaces/:id', (req, res) => {
  workspaceRepo.update(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/workspaces/:id', (req, res) => {
  workspaceRepo.remove(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/workspaces/:id/select', (req, res) => {
  workspaceRepo.select(Number(req.params.id));
  res.json({ ok: true });
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat: add workspace CRUD REST API routes"
```

---

### Task 9: WorkspaceSelector Component

**Files:**
- Create: `packages/web/src/components/sidebar/WorkspaceSelector.tsx`
- Create: `packages/web/src/components/sidebar/WorkspaceSelector.css`
- Modify: `packages/web/src/components/sidebar/TerminalManager.tsx`

- [ ] **Step 1: Create WorkspaceSelector**

```tsx
// packages/web/src/components/sidebar/WorkspaceSelector.tsx

import { useState, useEffect, useRef, useCallback } from 'react';
import './WorkspaceSelector.css';

interface WorkspaceInfo {
  id: number;
  path: string;
  label: string | null;
  use_count: number;
  agents: Array<{ name: string; purpose: string | null }>;
}

interface WorkspaceSelectorProps {
  onSelect: (workspace: WorkspaceInfo) => void;
  onNewPath: (path: string) => void;
  locked: boolean;
  onUnlock: () => void;
}

export function WorkspaceSelector({ onSelect, onNewPath, locked, onUnlock }: WorkspaceSelectorProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/workspaces').then(r => r.json()).then(setWorkspaces).catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const fetchDirSuggestions = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/list-dirs?prefix=${encodeURIComponent(value)}`);
        const dirs: string[] = await res.json();
        setSuggestions(dirs);
        setShowSuggestions(dirs.length > 0);
        setSelectedIdx(-1);
      } catch { setSuggestions([]); setShowSuggestions(false); }
    }, 150);
  }, []);

  function handleInputChange(value: string) {
    setInput(value);
    setError('');
    fetchDirSuggestions(value);
  }

  function selectDir(dir: string) {
    const withSlash = dir.endsWith('/') ? dir : dir + '/';
    setInput(withSlash);
    setShowSuggestions(false);
    setSelectedIdx(-1);
    fetchDirSuggestions(withSlash);
  }

  async function handleSet() {
    const pathValue = input.trim().replace(/\/+$/, '');
    if (!pathValue) { setError('Enter a path'); return; }
    setValidating(true);
    setError('');
    setShowSuggestions(false);
    try {
      const res = await fetch('/api/validate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathValue }),
      });
      const data = await res.json();
      if (!data.valid) { setError(data.error || 'Invalid path'); return; }

      // Check if workspace exists or create new
      const existing = workspaces.find(w => w.path === pathValue);
      if (existing) {
        await fetch(`/api/workspaces/${existing.id}/select`, { method: 'POST' });
        onSelect(existing);
      } else {
        const createRes = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: pathValue }),
        });
        const newWs = await createRes.json();
        setWorkspaces(prev => [newWs, ...prev]);
        onSelect(newWs);
      }
    } catch {
      setError('Failed to validate path');
    } finally {
      setValidating(false);
    }
  }

  function handleSelectExisting(ws: WorkspaceInfo) {
    setInput(ws.path);
    fetch(`/api/workspaces/${ws.id}/select`, { method: 'POST' });
    onSelect(ws);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(prev => Math.min(prev + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(prev => Math.max(prev - 1, -1)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && selectedIdx >= 0)) {
        e.preventDefault();
        selectDir(suggestions[selectedIdx >= 0 ? selectedIdx : 0]);
        return;
      }
      if (e.key === 'Escape') { setShowSuggestions(false); return; }
    }
    if (e.key === 'Enter') handleSet();
  }

  return (
    <div className="workspace-selector" ref={wrapperRef}>
      <label className="workspace-selector-label">Workspace</label>

      {workspaces.length > 0 && !locked && (
        <div className="workspace-selector-recent">
          {workspaces.slice(0, 5).map(ws => (
            <button
              key={ws.id}
              className="workspace-selector-recent-item"
              onClick={() => handleSelectExisting(ws)}
              title={ws.path}
            >
              {ws.label || ws.path.split('/').filter(Boolean).pop() || ws.path}
            </button>
          ))}
        </div>
      )}

      <div className="workspace-selector-row">
        <div className="workspace-selector-autocomplete">
          <input
            type="text"
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder="/path/to/project"
            className={'workspace-selector-input' + (error ? ' workspace-selector-input--error' : '')}
            disabled={locked || validating}
          />
          {showSuggestions && (
            <ul className="workspace-selector-suggestions">
              {suggestions.map((dir, i) => (
                <li
                  key={dir}
                  className={'workspace-selector-suggestion' + (i === selectedIdx ? ' workspace-selector-suggestion--selected' : '')}
                  onMouseDown={() => selectDir(dir)}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  {dir.split('/').filter(Boolean).pop() ?? dir}/
                </li>
              ))}
            </ul>
          )}
        </div>
        {locked ? (
          <button onClick={onUnlock} className="workspace-selector-btn workspace-selector-btn--secondary">Change</button>
        ) : (
          <button onClick={handleSet} className="workspace-selector-btn" disabled={validating}>
            {validating ? '...' : 'Set'}
          </button>
        )}
      </div>
      {error && <div className="workspace-selector-error">{error}</div>}
      {locked && <div className="workspace-selector-success">Workspace active</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create WorkspaceSelector.css**

```css
/* packages/web/src/components/sidebar/WorkspaceSelector.css */

.workspace-selector {
  margin-bottom: 12px;
}

.workspace-selector-label {
  font-size: 11px;
  color: #7d8590;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.workspace-selector-recent {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 6px 0;
}

.workspace-selector-recent-item {
  text-align: left;
  padding: 4px 6px;
  background: #1e1e1e;
  color: #ccc;
  border: 1px solid #333;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-selector-recent-item:hover {
  border-color: #0e639c;
  color: #fff;
}

.workspace-selector-row {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.workspace-selector-autocomplete {
  flex: 1;
  position: relative;
  min-width: 0;
}

.workspace-selector-input {
  width: 100%;
  padding: 4px 6px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 3px;
  color: #ccc;
  font-size: 12px;
}

.workspace-selector-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.workspace-selector-input--error {
  border-color: #f85149;
}

.workspace-selector-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  list-style: none;
  padding: 0;
  margin: 2px 0 0 0;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 3px;
  max-height: 200px;
  overflow-y: auto;
}

.workspace-selector-suggestion {
  padding: 4px 6px;
  font-size: 12px;
  color: #ccc;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-selector-suggestion:hover,
.workspace-selector-suggestion--selected {
  background: #0e639c;
  color: #fff;
}

.workspace-selector-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  background: #0e639c;
  color: #fff;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.workspace-selector-btn:hover:not(:disabled) {
  background: #1177bb;
}

.workspace-selector-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.workspace-selector-btn--secondary {
  background: #3c3c3c;
}

.workspace-selector-btn--secondary:hover:not(:disabled) {
  background: #505050;
}

.workspace-selector-error {
  font-size: 11px;
  color: #f85149;
  margin-top: 4px;
}

.workspace-selector-success {
  font-size: 11px;
  color: #4ade80;
  margin-top: 4px;
}
```

- [ ] **Step 3: Simplify TerminalManager to use WorkspaceSelector**

Replace the CWD section in `TerminalManager.tsx` with `<WorkspaceSelector>`. Remove all CWD-related state and the autocomplete logic. The TerminalManager becomes simpler -- it just has the workspace selector, spawn controls, and terminal list.

Update TerminalManagerProps:
```typescript
interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name: string, cwd: string) => void;
  onKill: (id: string) => void;
}
```

Replace the CWD div with:
```tsx
<WorkspaceSelector
  onSelect={(ws) => { setActiveCwd(ws.path); }}
  onNewPath={(p) => { setActiveCwd(p); }}
  locked={!!activeCwd}
  onUnlock={() => setActiveCwd(null)}
/>
```

Where `activeCwd` is `useState<string | null>(null)` and spawn uses it:
```typescript
function handleSpawn() {
  if (!activeCwd) return;
  const name = newName.trim() || `agent-${terminals.length + 1}`;
  onSpawn(name, activeCwd);
  setNewName('');
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=packages/web`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/sidebar/
git commit -m "feat: add WorkspaceSelector with recent workspaces and path autocomplete"
```

---

### Task 10: Terminal Lifecycle Tests

**Files:**
- Create: `packages/server/src/modules/terminal/__tests__/lifecycle.test.ts`

- [ ] **Step 1: Write lifecycle tests**

```typescript
// packages/server/src/modules/terminal/__tests__/lifecycle.test.ts

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import express from 'express';
import { TmuxManager } from '../tmux-manager.js';
import { TerminalRegistry } from '../terminal-registry.js';
import { createWebSocketServer } from '../../../transport/websocket.js';
import type { ServerMessage, ClientMessage } from '../../../transport/protocol.js';

let httpServer: http.Server;
let registry: TerminalRegistry;
let port: number;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws: WebSocket, msg: ClientMessage) {
  ws.send(JSON.stringify(msg));
}

function collect(ws: WebSocket): ServerMessage[] {
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  return msgs;
}

function waitUntil(msgs: ServerMessage[], pred: (m: ServerMessage) => boolean, ms = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('waitUntil timeout')), ms);
    const check = setInterval(() => {
      const found = msgs.find(pred);
      if (found) { clearInterval(check); clearTimeout(timeout); resolve(found); }
    }, 50);
  });
}

beforeEach(async () => {
  registry = new TerminalRegistry(new TmuxManager());
  const app = express();
  httpServer = http.createServer(app);
  createWebSocketServer(httpServer, registry);
  await new Promise<void>(r => httpServer.listen(0, r));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  await registry.destroyAll();
  await new Promise<void>(r => httpServer.close(() => r()));
});

describe('Terminal lifecycle', () => {
  it('spawn returns terminal:created', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc1', command: 'bash' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    expect(created.type).toBe('terminal:created');
    ws.close();
  });

  it('resize triggers pipe-pane and deferred command', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc2', command: 'bash' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    // After resize, pipe-pane starts -- subscribe should work
    await new Promise(r => setTimeout(r, 500));
    send(ws, { type: 'terminal:subscribe', terminalId: created.terminalId });
    const output = await waitUntil(msgs, m => m.type === 'terminal:output');
    expect(output.type).toBe('terminal:output');
    ws.close();
  });

  it('subscribe receives output', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc3', command: 'bash' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    send(ws, { type: 'terminal:subscribe', terminalId: created.terminalId });
    await new Promise(r => setTimeout(r, 300));
    send(ws, { type: 'terminal:input', terminalId: created.terminalId, data: 'echo TEST_OUT\n' });
    const output = await waitUntil(msgs, m => m.type === 'terminal:output' && 'data' in m && m.data.includes('TEST_OUT'));
    expect(output.type).toBe('terminal:output');
    ws.close();
  });

  it('kill sends Ctrl+C and session exits', { timeout: 15000 }, async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc4', command: 'bash' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    send(ws, { type: 'terminal:subscribe', terminalId: created.terminalId });
    send(ws, { type: 'terminal:kill', terminalId: created.terminalId });
    const exited = await waitUntil(msgs, m => m.type === 'terminal:exited', 10000);
    expect(exited.type).toBe('terminal:exited');
    ws.close();
  });

  it('terminal exits on its own when command ends', { timeout: 15000 }, async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc5', command: 'echo done' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    send(ws, { type: 'terminal:subscribe', terminalId: created.terminalId });
    const exited = await waitUntil(msgs, m => m.type === 'terminal:exited', 10000);
    expect(exited.type).toBe('terminal:exited');
    ws.close();
  });

  it('spawn with custom command', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:spawn', name: 'lc6', command: 'echo hello' });
    const created = await waitUntil(msgs, m => m.type === 'terminal:created');
    expect(created.type).toBe('terminal:created');
    ws.close();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test --workspace=packages/server`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/terminal/__tests__/lifecycle.test.ts
git commit -m "test: add terminal lifecycle integration tests"
```

---

### Task 11: Reconnection Tests

**Files:**
- Create: `packages/server/src/modules/terminal/__tests__/reconnection.test.ts`

- [ ] **Step 1: Write reconnection tests**

```typescript
// packages/server/src/modules/terminal/__tests__/reconnection.test.ts

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import express from 'express';
import { TmuxManager } from '../tmux-manager.js';
import { TerminalRegistry } from '../terminal-registry.js';
import { createWebSocketServer } from '../../../transport/websocket.js';
import type { ServerMessage, ClientMessage } from '../../../transport/protocol.js';

let httpServer: http.Server;
let registry: TerminalRegistry;
let port: number;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws: WebSocket, msg: ClientMessage) {
  ws.send(JSON.stringify(msg));
}

function collect(ws: WebSocket): ServerMessage[] {
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  return msgs;
}

function waitUntil(msgs: ServerMessage[], pred: (m: ServerMessage) => boolean, ms = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('waitUntil timeout')), ms);
    const check = setInterval(() => {
      const found = msgs.find(pred);
      if (found) { clearInterval(check); clearTimeout(timeout); resolve(found); }
    }, 50);
  });
}

beforeEach(async () => {
  registry = new TerminalRegistry(new TmuxManager());
  const app = express();
  httpServer = http.createServer(app);
  createWebSocketServer(httpServer, registry);
  await new Promise<void>(r => httpServer.listen(0, r));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  await registry.destroyAll();
  await new Promise<void>(r => httpServer.close(() => r()));
});

describe('Reconnection', () => {
  it('list returns existing terminals after reconnect', async () => {
    const ws1 = await connect();
    const msgs1 = collect(ws1);
    send(ws1, { type: 'terminal:spawn', name: 'rc1', command: 'bash' });
    await waitUntil(msgs1, m => m.type === 'terminal:created');
    send(ws1, { type: 'terminal:resize', terminalId: (msgs1.find(m => m.type === 'terminal:created') as any).terminalId, cols: 80, rows: 24 });
    ws1.close();

    // Reconnect
    const ws2 = await connect();
    const msgs2 = collect(ws2);
    send(ws2, { type: 'terminal:list' });
    const list = await waitUntil(msgs2, m => m.type === 'terminal:list');
    if (list.type !== 'terminal:list') throw new Error('');
    expect(list.terminals.length).toBeGreaterThanOrEqual(1);
    ws2.close();
  });

  it('subscribe to existing terminal receives output via SIGWINCH', { timeout: 10000 }, async () => {
    const ws1 = await connect();
    const msgs1 = collect(ws1);
    send(ws1, { type: 'terminal:spawn', name: 'rc2', command: 'bash' });
    const created = await waitUntil(msgs1, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws1, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    ws1.close();

    // Reconnect and subscribe
    const ws2 = await connect();
    const msgs2 = collect(ws2);
    send(ws2, { type: 'terminal:subscribe', terminalId: created.terminalId });
    const output = await waitUntil(msgs2, m => m.type === 'terminal:output', 8000);
    expect(output.type).toBe('terminal:output');
    ws2.close();
  });

  it('resize existing terminal on reconnect', { timeout: 10000 }, async () => {
    const ws1 = await connect();
    const msgs1 = collect(ws1);
    send(ws1, { type: 'terminal:spawn', name: 'rc3', command: 'bash' });
    const created = await waitUntil(msgs1, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws1, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    ws1.close();

    const ws2 = await connect();
    const msgs2 = collect(ws2);
    // Resize to different dimensions
    send(ws2, { type: 'terminal:resize', terminalId: created.terminalId, cols: 100, rows: 30 });
    send(ws2, { type: 'terminal:subscribe', terminalId: created.terminalId });
    const output = await waitUntil(msgs2, m => m.type === 'terminal:output', 8000);
    expect(output.type).toBe('terminal:output');
    ws2.close();
  });

  it('multiple clients subscribe to same terminal', { timeout: 10000 }, async () => {
    const ws1 = await connect();
    const msgs1 = collect(ws1);
    send(ws1, { type: 'terminal:spawn', name: 'rc4', command: 'bash' });
    const created = await waitUntil(msgs1, m => m.type === 'terminal:created');
    if (created.type !== 'terminal:created') throw new Error('');
    send(ws1, { type: 'terminal:resize', terminalId: created.terminalId, cols: 80, rows: 24 });
    await new Promise(r => setTimeout(r, 500));
    send(ws1, { type: 'terminal:subscribe', terminalId: created.terminalId });

    const ws2 = await connect();
    const msgs2 = collect(ws2);
    send(ws2, { type: 'terminal:subscribe', terminalId: created.terminalId });

    await new Promise(r => setTimeout(r, 500));
    send(ws1, { type: 'terminal:input', terminalId: created.terminalId, data: 'echo MULTI\n' });

    const out1 = await waitUntil(msgs1, m => m.type === 'terminal:output' && 'data' in m && m.data.includes('MULTI'), 8000);
    const out2 = await waitUntil(msgs2, m => m.type === 'terminal:output' && 'data' in m && m.data.includes('MULTI'), 8000);
    expect(out1.type).toBe('terminal:output');
    expect(out2.type).toBe('terminal:output');
    ws1.close();
    ws2.close();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test --workspace=packages/server`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/terminal/__tests__/reconnection.test.ts
git commit -m "test: add terminal reconnection integration tests"
```

---

### Task 12: Error Handling Tests

**Files:**
- Create: `packages/server/src/modules/terminal/__tests__/error-handling.test.ts`

- [ ] **Step 1: Write error handling tests**

```typescript
// packages/server/src/modules/terminal/__tests__/error-handling.test.ts

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import express from 'express';
import { TmuxManager } from '../tmux-manager.js';
import { TerminalRegistry } from '../terminal-registry.js';
import { createWebSocketServer } from '../../../transport/websocket.js';
import type { ServerMessage, ClientMessage } from '../../../transport/protocol.js';

let httpServer: http.Server;
let registry: TerminalRegistry;
let port: number;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws: WebSocket, msg: ClientMessage) {
  ws.send(JSON.stringify(msg));
}

function collect(ws: WebSocket): ServerMessage[] {
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  return msgs;
}

function waitUntil(msgs: ServerMessage[], pred: (m: ServerMessage) => boolean, ms = 3000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('waitUntil timeout')), ms);
    const check = setInterval(() => {
      const found = msgs.find(pred);
      if (found) { clearInterval(check); clearTimeout(timeout); resolve(found); }
    }, 50);
  });
}

beforeEach(async () => {
  registry = new TerminalRegistry(new TmuxManager());
  const app = express();
  httpServer = http.createServer(app);
  createWebSocketServer(httpServer, registry);
  await new Promise<void>(r => httpServer.listen(0, r));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  await registry.destroyAll();
  await new Promise<void>(r => httpServer.close(() => r()));
});

describe('Error handling', () => {
  it('input to non-existent terminal returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:input', terminalId: 'nonexistent', data: 'test' });
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });

  it('kill non-existent terminal returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:kill', terminalId: 'nonexistent' });
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });

  it('resize non-existent terminal returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:resize', terminalId: 'nonexistent', cols: 80, rows: 24 });
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });

  it('subscribe to non-existent terminal returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    send(ws, { type: 'terminal:subscribe', terminalId: 'nonexistent' });
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });

  it('invalid JSON returns error', async () => {
    const ws = await connect();
    const msgs = collect(ws);
    ws.send('not json');
    const err = await waitUntil(msgs, m => m.type === 'error');
    expect(err.type).toBe('error');
    ws.close();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test --workspace=packages/server`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/terminal/__tests__/error-handling.test.ts
git commit -m "test: add error handling integration tests"
```

---

### Task 13: Clean Up Old Integration Test + Final Verification

**Files:**
- Delete: `packages/server/src/modules/terminal/__tests__/integration.test.ts`

- [ ] **Step 1: Remove old integration test (replaced by lifecycle/reconnection/error tests)**

```bash
rm packages/server/src/modules/terminal/__tests__/integration.test.ts
```

- [ ] **Step 2: Run all server tests**

Run: `npm run test --workspace=packages/server`
Expected: All pass. Should be ~40+ tests across tmux-manager, terminal-session, terminal-registry, websocket, workspace-repository, lifecycle, reconnection, error-handling.

- [ ] **Step 3: Run web tests**

Run: `npm run test --workspace=packages/web`
Expected: All split-tree tests pass.

- [ ] **Step 4: Build both packages**

Run: `npm run build --workspaces`
Expected: Both server and web build successfully.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old integration test, verify all tests pass"
```
