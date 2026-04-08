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

  function spawnNewTerminal() {
    if (!cwd) return;
    const name = `agent-${Date.now().toString(36)}`;
    wsRef.current?.send({ type: 'terminal:spawn', name, cwd });
  }

  function handleSpawnInSlot(_leafPath: string) {
    spawnNewTerminal();
  }

  function handleKill(id: string) {
    wsRef.current?.send({ type: 'terminal:kill', terminalId: id });
  }

  function handleSplitH(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'horizontal'));
    // The new empty slot will be filled by the useEffect that assigns unassigned terminals
    spawnNewTerminal();
  }

  function handleSplitV(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'vertical'));
    spawnNewTerminal();
  }

  function handleMerge(terminalId: string) {
    // Kill the terminal process on the server
    wsRef.current?.send({ type: 'terminal:kill', terminalId });
    // Remove this pane from the layout immediately
    setLayout(prev => mergePane(prev, terminalId));
  }

  // Sync layout with terminal state: collapse exited panes, assign new terminals
  useEffect(() => {
    const activeIds = new Set(terminals.map(t => t.id));

    setLayout(prev => {
      let tree = prev;

      // 1) Collapse panes whose terminal has exited (mergePane removes + collapses)
      //    Then null out any remaining stale IDs (e.g. root leaf that can't be merged)
      function findExited(node: LayoutNode): string[] {
        if (node.type === 'leaf') {
          return node.terminalId && !activeIds.has(node.terminalId) ? [node.terminalId] : [];
        }
        return [...findExited(node.children[0]), ...findExited(node.children[1])];
      }
      for (const id of findExited(tree)) {
        tree = mergePane(tree, id);
      }
      function clearStale(node: LayoutNode): LayoutNode {
        if (node.type === 'leaf') {
          if (node.terminalId && !activeIds.has(node.terminalId)) {
            return { type: 'leaf', terminalId: null };
          }
          return node;
        }
        return {
          type: 'split', direction: node.direction, ratio: node.ratio,
          children: [clearStale(node.children[0]), clearStale(node.children[1])],
        };
      }
      tree = clearStale(tree);

      // 2) Assign unassigned terminals to empty slots
      const assignedIds = new Set<string>();
      function collectAssigned(node: LayoutNode) {
        if (node.type === 'leaf' && node.terminalId) assignedIds.add(node.terminalId);
        if (node.type === 'split') node.children.forEach(collectAssigned);
      }
      collectAssigned(tree);

      const unassigned = terminals.filter(t => !assignedIds.has(t.id));
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
      }

      return tree;
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
