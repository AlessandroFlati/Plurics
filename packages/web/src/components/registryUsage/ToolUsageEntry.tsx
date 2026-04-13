import type { ToolUsageSummary } from '../../types';

interface ToolUsageEntryProps {
  entry: ToolUsageSummary;
  onNavigate: (toolName: string) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function ToolUsageEntry({ entry, onNavigate }: ToolUsageEntryProps) {
  const nodeList = entry.invokingNodes.slice(0, 3).join(', ') + (entry.invokingNodes.length > 3 ? ' \u2026' : '');

  return (
    <tr>
      <td style={{ padding: '6px 10px' }}>
        <span
          onClick={() => onNavigate(entry.toolName)}
          style={{
            color: 'var(--color-accent, #569cd6)',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          {entry.toolName}
        </span>
      </td>
      <td style={{ padding: '6px 10px', color: 'var(--color-text-secondary, #888)', fontSize: 11 }}>
        v{entry.toolVersion}
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
        {entry.invocationCount}
      </td>
      <td style={{ padding: '6px 10px' }}>
        <span style={{ color: '#4ade80' }}>{entry.successCount} ok</span>
        {' / '}
        <span style={{ color: entry.failureCount > 0 ? '#f87171' : 'var(--color-text-secondary, #888)' }}>
          {entry.failureCount} fail
        </span>
      </td>
      <td style={{ padding: '6px 10px', color: 'var(--color-text-secondary, #888)' }}>
        {formatDuration(entry.totalDurationMs)}
      </td>
      <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>
        {nodeList || '\u2014'}
      </td>
    </tr>
  );
}
