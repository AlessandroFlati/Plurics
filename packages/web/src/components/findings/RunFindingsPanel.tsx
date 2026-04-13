import { useState, useEffect, useCallback } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import type { FindingRecord, ServerMessage } from '../../types';
import { getRunFindings } from '../../services/api';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { FindingCard } from './FindingCard';

interface RunFindingsPanelProps {
  runId: string;
  wsClient: WebSocketClient | null;
}

export function RunFindingsPanel({ runId, wsClient }: RunFindingsPanelProps) {
  const [findings, setFindings] = useState<FindingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [newFindingIds, setNewFindingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    getRunFindings(runId)
      .then(data => setFindings(data))
      .catch(() => setFindings([]))
      .finally(() => setLoading(false));
  }, [runId]);

  const handler = useCallback((msg: ServerMessage) => {
    if (msg.type !== 'finding:produced') return;
    if (msg.runId !== runId) return;
    const stub: FindingRecord = {
      findingId: msg.findingId,
      runId: msg.runId,
      hypothesisId: msg.hypothesisId,
      content: msg.content,
      summary: msg.content.slice(0, 100),
      verdict: 'inconclusive',
      producedAt: new Date().toISOString(),
      nodeName: null,
      scope: null,
    };
    setFindings(prev => [stub, ...prev]);
    setNewFindingIds(prev => {
      const next = new Set(prev);
      next.add(msg.findingId);
      return next;
    });
    setTimeout(() => {
      setNewFindingIds(prev => {
        const next = new Set(prev);
        next.delete(msg.findingId);
        return next;
      });
    }, 2000);
  }, [runId]);

  useWorkflowEvents(wsClient, runId, handler);

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>Loading…</div>;
  }

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '8px 12px' }}>
      {findings.length === 0 ? (
        <div style={{ color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>
          No findings produced by this run yet.
        </div>
      ) : (
        findings.map(f => (
          <FindingCard
            key={f.findingId}
            finding={f}
            runId={runId}
            isNew={newFindingIds.has(f.findingId)}
          />
        ))
      )}
    </div>
  );
}
