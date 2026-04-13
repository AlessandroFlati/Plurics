import type { RunSummary, RunStatus } from '../../types';
import { WorkflowControls } from './WorkflowControls';

interface RunMetadataHeaderProps {
  run: RunSummary;
}

const STATUS_COLORS: Record<RunStatus, string> = {
  running: '#facc15',
  completed: '#4ade80',
  failed: '#f87171',
  paused: '#fb923c',
  interrupted: '#f59e0b',
  aborted: '#94a3b8',
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function RunMetadataHeader({ run }: RunMetadataHeaderProps) {
  const statusColor = STATUS_COLORS[run.status] ?? '#888';
  const shortId = run.runId.slice(0, 8) + '\u2026';

  function handleCopyId() {
    navigator.clipboard.writeText(run.runId).catch(() => undefined);
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      height: 52,
      padding: '0 16px',
      background: 'var(--color-bg-elevated, #1e1e1e)',
      borderBottom: '1px solid var(--color-border, #333)',
      flexShrink: 0,
    }}>
      {/* Left: name + run ID */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.workflowName}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>
            {shortId}
          </span>
          <button
            onClick={handleCopyId}
            title="Copy run ID"
            style={{
              fontSize: 9,
              padding: '1px 5px',
              background: 'transparent',
              border: '1px solid var(--color-border, #555)',
              borderRadius: 3,
              color: 'var(--color-text-secondary, #888)',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
            }}
          >
            copy
          </button>
        </div>
      </div>

      {/* Center: status + time + duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 8,
          background: statusColor,
          color: run.status === 'aborted' ? '#fff' : '#000',
          fontWeight: 600,
          textTransform: 'capitalize',
        }}>
          {run.status}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>
          {new Date(run.startedAt).toLocaleString()}
        </span>
        {run.durationSeconds !== null && (
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>
            {formatDuration(run.durationSeconds)}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Metrics */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--color-text-secondary, #aaa)', flexShrink: 0 }}>
        <span>{run.nodesCompleted}/{run.nodesTotal} nodes</span>
        <span>{run.findingsCount} findings</span>
      </div>

      {/* Controls */}
      <WorkflowControls runId={run.runId} status={run.status} />
    </div>
  );
}
