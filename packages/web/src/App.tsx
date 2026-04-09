import { useEffect, useRef, useState } from 'react';
import { WebSocketClient } from './services/websocket-client';
import { initTerminalStore, useTerminals } from './stores/terminal-store';
import { SplitLayout } from './components/grid/SplitLayout';
import { TerminalManager } from './components/sidebar/TerminalManager';
import { SpawnModal } from './components/sidebar/SpawnModal';
import { DagVisualization } from './components/workflow/DagVisualization';
import { FindingsPanel } from './components/workflow/FindingsPanel';
import { useWorkflowState } from './components/workflow/WorkflowPanel';
import { type LayoutNode, createPreset, assignTerminals, splitLeaf, mergePane } from './components/grid/split-tree';

const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;

export function App() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const terminals = useTerminals();
  const [layout, setLayout] = useState<LayoutNode>({ type: 'leaf', terminalId: null });
  const [cwd, setCwd] = useState<string | null>(null);
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [wfState, updateWfState] = useWorkflowState(wsReady ? wsRef.current : null);

  useEffect(() => {
    const ws = new WebSocketClient(wsUrl);
    wsRef.current = ws;
    setWsReady(true);
    const unsub = initTerminalStore(ws);
    ws.connect();
    return () => {
      unsub();
      ws.disconnect();
      setWsReady(false);
    };
  }, []);

  const terminalMap = new Map(terminals.map(t => [t.id, t]));

  function handlePresetSelect(_label: string, cols: number, rows: number) {
    const tree = createPreset(cols, rows);
    const terminalIds = terminals.map(t => t.id);
    setLayout(assignTerminals(tree, terminalIds));
  }

  function handleSpawn(_name: string, spawnCwd: string) {
    setCwd(spawnCwd);
  }

  function openSpawnModal() {
    if (!cwd) return;
    setShowSpawnModal(true);
  }

  function handleModalSpawn(name: string, purpose: string, presetId?: number) {
    if (!cwd) return;
    setShowSpawnModal(false);
    wsRef.current?.send({ type: 'terminal:spawn', name, cwd, purpose: purpose || undefined, presetId });
  }

  function handleSpawnInSlot(_leafPath: string) {
    openSpawnModal();
  }

  function handleKill(id: string) {
    wsRef.current?.send({ type: 'terminal:kill', terminalId: id });
  }

  function handleSplitH(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'horizontal'));
    openSpawnModal();
  }

  function handleSplitV(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'vertical'));
    openSpawnModal();
  }

  function handleMerge(terminalId: string) {
    wsRef.current?.send({ type: 'terminal:kill', terminalId });
    setLayout(prev => mergePane(prev, terminalId));
  }

  // Sync layout with terminal state: collapse exited panes, assign new terminals
  useEffect(() => {
    const activeIds = new Set(terminals.map(t => t.id));

    setLayout(prev => {
      let tree = prev;

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

  const showDag = wfState.nodes.length > 0;
  const showFindings = wfState.findings.length > 0;
  const [bottomTab, setBottomTab] = useState<'dag' | 'findings'>('dag');

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-ui)' }}>
      <TerminalManager
        terminals={terminals}
        ws={wsRef.current}
        workflowState={wfState}
        onWorkflowStateChange={updateWfState}
        onSpawn={handleSpawn}
        onOpenSpawnModal={openSpawnModal}
        onKill={handleKill}
        onPresetSelect={handlePresetSelect}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ flex: 1, minHeight: 0 }}>
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
        {(showDag || showFindings) && (
          <div style={{ height: 220, flexShrink: 0, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
            {(showDag && showFindings) && (
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border, #333)', flexShrink: 0 }}>
                <button
                  onClick={() => setBottomTab('dag')}
                  style={{
                    padding: '4px 16px',
                    fontSize: 11,
                    fontWeight: bottomTab === 'dag' ? 600 : 400,
                    background: bottomTab === 'dag' ? 'var(--color-bg, #181818)' : 'transparent',
                    color: bottomTab === 'dag' ? 'var(--color-text-primary)' : 'var(--color-text-secondary, #888)',
                    border: 'none',
                    borderBottom: bottomTab === 'dag' ? '2px solid var(--color-accent, #569cd6)' : '2px solid transparent',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  DAG
                </button>
                <button
                  onClick={() => setBottomTab('findings')}
                  style={{
                    padding: '4px 16px',
                    fontSize: 11,
                    fontWeight: bottomTab === 'findings' ? 600 : 400,
                    background: bottomTab === 'findings' ? 'var(--color-bg, #181818)' : 'transparent',
                    color: bottomTab === 'findings' ? 'var(--color-text-primary)' : 'var(--color-text-secondary, #888)',
                    border: 'none',
                    borderBottom: bottomTab === 'findings' ? '2px solid var(--color-accent, #569cd6)' : '2px solid transparent',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  Findings ({wfState.findings.length})
                </button>
              </div>
            )}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {(bottomTab === 'dag' || !showFindings) && showDag && (
                <DagVisualization nodes={wfState.nodes} yamlContent={wfState.yaml} />
              )}
              {bottomTab === 'findings' && showFindings && (
                <FindingsPanel findings={wfState.findings} />
              )}
            </div>
          </div>
        )}
      </div>
      {showSpawnModal && (
        <SpawnModal
          onSpawn={handleModalSpawn}
          onClose={() => setShowSpawnModal(false)}
        />
      )}
    </div>
  );
}
