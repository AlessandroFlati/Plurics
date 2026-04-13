import { useState, useEffect } from 'react';
import type { NodeState } from '../../types';
import { getRunNode } from '../../services/api';
import { NodeErrorView } from './NodeErrorView';
import { ReasoningNodeView } from './ReasoningNodeView';
import { ToolNodeView } from './ToolNodeView';

interface NodeDetailTabProps {
  runId: string;
  selectedNode: string | null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '\u2014';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

const STATE_COLORS: Record<string, string> = {
  completed: '#4ade80',
  failed: '#f87171',
  running: '#facc15',
  skipped: '#888',
  pending: '#94a3b8',
};

export function NodeDetailTab({ runId, selectedNode }: NodeDetailTabProps) {
  const [node, setNode] = useState<NodeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedNode) { setNode(null); return; }
    setLoading(true);
    setError(null);
    getRunNode(runId, selectedNode)
      .then(n => setNode(n))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [runId, selectedNode]);

  if (!selectedNode) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>
        Select a node in the DAG to inspect it.
      </div>
    );
  }
  if (loading) {
    return <div style={{ padding: 16, color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>Loading node…</div>;
  }
  if (error) {
    return <div style={{ padding: 16, color: '#f87171', fontSize: 12 }}>{error}</div>;
  }
  if (!node) return null;

  const stateColor = STATE_COLORS[node.state] ?? '#888';

  return (
    <div style={{ padding: '12px 16px', overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* Common section */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{node.nodeName}</span>
          {node.scope && (
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>scope: {node.scope}</span>
          )}
          <span style={{
            fontSize: 10,
            padding: '1px 7px',
            borderRadius: 8,
            background: stateColor,
            color: '#000',
            fontWeight: 600,
          }}>
            {node.state}
          </span>
          {node.attempt > 1 && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>attempt {node.attempt}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #888)', display: 'flex', gap: 12 }}>
          {node.startedAt && <span>Start: {new Date(node.startedAt).toLocaleTimeString()}</span>}
          {node.completedAt && <span>End: {new Date(node.completedAt).toLocaleTimeString()}</span>}
          <span>Duration: {formatDuration(node.durationSeconds)}</span>
        </div>
      </div>

      {node.state === 'failed' && node.errorCategory && node.errorMessage && (
        <NodeErrorView
          errorCategory={node.errorCategory}
          errorMessage={node.errorMessage}
        />
      )}

      {node.kind === 'reasoning' && <ReasoningNodeView runId={runId} node={node} />}
      {(node.kind === 'tool' || node.kind === 'converter') && <ToolNodeView runId={runId} node={node} />}
    </div>
  );
}
