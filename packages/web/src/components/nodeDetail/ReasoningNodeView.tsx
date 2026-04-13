import { useState, useEffect } from 'react';
import type { NodeState } from '../../types';
import { getNodePurpose } from '../../services/api';

interface ReasoningNodeViewProps {
  runId: string;
  node: NodeState;
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-secondary, #888)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const valueStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-primary)',
};

export function ReasoningNodeView({ runId, node }: ReasoningNodeViewProps) {
  const [purpose, setPurpose] = useState<string | null>(null);
  const [purposeLoading, setPurposeLoading] = useState(false);

  useEffect(() => {
    setPurposeLoading(true);
    getNodePurpose(runId, node.nodeName)
      .then(p => setPurpose(p))
      .catch(() => setPurpose(null))
      .finally(() => setPurposeLoading(false));
  }, [runId, node.nodeName]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12 }}>
      {/* Backend / Model */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={labelStyle}>Backend</div>
          <div style={valueStyle}>{node.backend ?? '\u2014'}</div>
        </div>
        <div>
          <div style={labelStyle}>Model</div>
          <div style={valueStyle}>{node.model ?? '\u2014'}</div>
        </div>
      </div>

      {/* Purpose */}
      <div>
        <div style={labelStyle}>Purpose</div>
        {purposeLoading ? (
          <div style={{ color: 'var(--color-text-secondary, #888)', fontSize: 11 }}>Loading…</div>
        ) : purpose ? (
          <pre style={{
            margin: '4px 0 0 0',
            fontSize: 12,
            fontFamily: 'monospace',
            background: '#1a1a1a',
            borderRadius: 4,
            padding: '6px 8px',
            maxHeight: 200,
            overflow: 'auto',
            color: 'var(--color-text-primary)',
          }}>
            {purpose}
          </pre>
        ) : (
          <div style={{ color: 'var(--color-text-secondary, #888)', fontSize: 11 }}>Not available.</div>
        )}
      </div>

      {/* Tokens placeholder */}
      <div>
        <div style={labelStyle}>Tokens</div>
        <div style={{ color: 'var(--color-text-secondary, #888)', fontSize: 11 }}>Token data not available.</div>
      </div>

      {/* Tool-call trace placeholder */}
      <div>
        <div style={labelStyle}>Tool-call trace</div>
        <div style={{ color: 'var(--color-text-secondary, #888)', fontSize: 11 }}>Tool-call trace available in node signals.</div>
      </div>
    </div>
  );
}
