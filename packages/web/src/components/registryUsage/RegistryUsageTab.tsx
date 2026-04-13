import { useState, useEffect, useCallback } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import type { ToolUsageSummary, ServerMessage } from '../../types';
import { getRunRegistryUsage } from '../../services/api';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { ToolUsageEntry } from './ToolUsageEntry';

interface RegistryUsageTabProps {
  runId: string;
  wsClient: WebSocketClient | null;
  onNavigateToTool: (toolName: string) => void;
}

export function RegistryUsageTab({ runId, wsClient, onNavigateToTool }: RegistryUsageTabProps) {
  const [usage, setUsage] = useState<ToolUsageSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getRunRegistryUsage(runId)
      .then(data => {
        const sorted = [...data].sort((a, b) => b.totalDurationMs - a.totalDurationMs);
        setUsage(sorted);
      })
      .catch(() => setUsage([]))
      .finally(() => setLoading(false));
  }, [runId]);

  const handler = useCallback((msg: ServerMessage) => {
    if (msg.type !== 'tool:invoked') return;
    if (msg.runId !== runId) return;
    setUsage(prev => {
      const idx = prev.findIndex(u => u.toolName === msg.toolName && u.toolVersion === msg.toolVersion);
      if (idx >= 0) {
        const updated = [...prev];
        const entry = { ...updated[idx] };
        entry.invocationCount += 1;
        if (!entry.invokingNodes.includes(msg.nodeName)) {
          entry.invokingNodes = [...entry.invokingNodes, msg.nodeName];
        }
        updated[idx] = entry;
        return updated;
      }
      return [...prev, {
        toolName: msg.toolName,
        toolVersion: msg.toolVersion,
        invocationCount: 1,
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
        invokingNodes: [msg.nodeName],
      }];
    });
  }, [runId]);

  useWorkflowEvents(wsClient, runId, handler);

  const thStyle: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-secondary, #888)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    position: 'sticky',
    top: 0,
    background: 'var(--color-bg-elevated, #1e1e1e)',
  };

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>Loading…</div>;
  }

  if (usage.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--color-text-secondary, #888)', fontSize: 12 }}>
        No tool invocations recorded for this run.
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Tool</th>
            <th style={thStyle}>Version</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Invocations</th>
            <th style={thStyle}>Success / Failure</th>
            <th style={thStyle}>Duration</th>
            <th style={thStyle}>Nodes</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((entry, i) => (
            <ToolUsageEntry
              key={`${entry.toolName}-${entry.toolVersion}-${i}`}
              entry={entry}
              onNavigate={onNavigateToTool}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
