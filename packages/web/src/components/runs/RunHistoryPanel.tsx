import { useState, useEffect, useCallback } from 'react';
import type { RunSummary, RunFilters as RunFiltersType, ServerMessage } from '../../types';
import type { WebSocketClient } from '../../services/websocket-client';
import { listRuns } from '../../services/api';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { RunFilters } from './RunFilters';
import { RunEntry } from './RunEntry';

interface RunHistoryPanelProps {
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onResumeRun: (runId: string) => void;
  wsClient: WebSocketClient | null;
}

export function RunHistoryPanel({ selectedRunId, onSelectRun, onResumeRun, wsClient }: RunHistoryPanelProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [filters, setFilters] = useState<RunFiltersType>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    listRuns(filters)
      .then(data => setRuns(data))
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [filters]);

  const handler = useCallback((msg: ServerMessage) => {
    if (msg.type === 'workflow:state_changed') {
      setRuns(prev => prev.map(r =>
        r.runId === msg.runId ? { ...r, status: msg.status } : r,
      ));
    } else if (msg.type === 'workflow:started') {
      const stub: RunSummary = {
        runId: msg.runId,
        workflowName: '',
        workflowVersion: 1,
        status: 'running',
        startedAt: new Date().toISOString(),
        completedAt: null,
        durationSeconds: null,
        nodesTotal: msg.nodeCount,
        nodesCompleted: 0,
        nodesRunning: 0,
        nodesFailed: 0,
        findingsCount: 0,
        workspacePath: '',
        description: null,
      };
      setRuns(prev => [stub, ...prev]);
    }
  }, []);

  useWorkflowEvents(wsClient, null, handler);

  return (
    <div style={{ width: 280, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border, #333)', flexShrink: 0 }}>
      <div style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--color-border, #333)', flexShrink: 0 }}>
        Run History
      </div>
      <RunFilters value={filters} onChange={setFilters} />
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--color-text-secondary, #888)', fontSize: 13 }}>
            Loading...
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 12, color: 'var(--color-error, #f87171)', fontSize: 12 }}>{error}</div>
        )}
        {!loading && !error && runs.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--color-text-secondary, #888)', fontSize: 13 }}>
            No runs found.
          </div>
        )}
        {!loading && !error && runs.map(run => (
          <RunEntry
            key={run.runId}
            run={run}
            selected={run.runId === selectedRunId}
            onClick={() => onSelectRun(run.runId)}
            onResume={onResumeRun}
          />
        ))}
      </div>
    </div>
  );
}
