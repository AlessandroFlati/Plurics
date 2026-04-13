import { useState, useEffect } from 'react';
import type { NodeState } from '../../types';
import { getNodeLogs } from '../../services/api';

interface ToolNodeViewProps {
  runId: string;
  node: NodeState;
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-secondary, #888)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};

const preStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontFamily: 'monospace',
  background: 'var(--color-bg-elevated, #1e1e1e)',
  borderRadius: 4,
  padding: '6px 8px',
  maxHeight: 160,
  overflow: 'auto',
  color: 'var(--color-text-primary)',
};

export function ToolNodeView({ runId, node }: ToolNodeViewProps) {
  const [logs, setLogs] = useState<{ stdout: string; stderr: string } | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    setLogsLoading(true);
    getNodeLogs(runId, node.nodeName)
      .then(l => setLogs(l))
      .catch(() => setLogs(null))
      .finally(() => setLogsLoading(false));
  }, [runId, node.nodeName]);

  const durationMs = node.durationSeconds !== null ? Math.round(node.durationSeconds * 1000) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12 }}>
      {/* Tool name + version */}
      <div>
        <span style={{ fontWeight: 700 }}>{node.toolName ?? '\u2014'}</span>
        {node.toolVersion && (
          <span style={{ color: 'var(--color-text-secondary, #888)', marginLeft: 6 }}>v{node.toolVersion}</span>
        )}
      </div>

      {/* Duration */}
      <div>
        <div style={labelStyle}>Invocation duration</div>
        <div>{durationMs !== null ? `${durationMs}ms` : '\u2014'}</div>
      </div>

      {/* stdout */}
      <div>
        <div style={labelStyle}>stdout</div>
        {logsLoading ? (
          <div style={{ color: 'var(--color-text-secondary, #888)', fontSize: 11 }}>Loading…</div>
        ) : (
          <pre style={preStyle}>
            {logs?.stdout || <em>No output.</em>}
          </pre>
        )}
      </div>

      {/* stderr */}
      <div>
        <div style={labelStyle}>stderr</div>
        {logsLoading ? (
          <div style={{ color: 'var(--color-text-secondary, #888)', fontSize: 11 }}>Loading…</div>
        ) : (
          <pre style={preStyle}>
            {logs?.stderr || <em>No stderr.</em>}
          </pre>
        )}
      </div>
    </div>
  );
}
