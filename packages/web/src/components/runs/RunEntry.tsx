import type { RunSummary, RunStatus } from '../../types';

interface RunEntryProps {
  run: RunSummary;
  selected: boolean;
  onClick: () => void;
  onResume: (runId: string) => void;
}

const STATUS_COLORS: Record<RunStatus, string> = {
  running: '#facc15',
  completed: '#4ade80',
  failed: '#f87171',
  paused: '#fb923c',
  interrupted: '#f59e0b',
  aborted: '#94a3b8',
};

function formatRelative(isoString: string): string {
  const diffMs = Date.now() - Date.parse(isoString);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function RunEntry({ run, selected, onClick, onResume }: RunEntryProps) {
  const statusColor = STATUS_COLORS[run.status] ?? '#888';
  const canResume = run.status === 'interrupted' || run.status === 'paused';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        cursor: 'pointer',
        padding: '10px 12px',
        background: selected ? 'var(--color-bg-elevated, #232323)' : 'transparent',
        borderBottom: '1px solid var(--color-border, #2a2a2a)',
        gap: 10,
      }}
      onMouseEnter={e => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-hover, #1e1e1e)';
      }}
      onMouseLeave={e => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {/* Status color bar */}
      <div style={{ width: 4, borderRadius: 2, background: statusColor, flexShrink: 0 }} />

      {/* Center content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.workflowName}
          </span>
          <span style={{
            fontSize: 10,
            padding: '1px 5px',
            borderRadius: 8,
            background: 'var(--color-bg-elevated, #2a2a2a)',
            color: 'var(--color-text-secondary, #aaa)',
            flexShrink: 0,
          }}>
            v{run.workflowVersion}
          </span>
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #777)', flexShrink: 0, marginLeft: 'auto' }}>
            {formatRelative(run.startedAt)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>
          <span>
            {run.nodesCompleted}/{run.nodesTotal}
            {run.status === 'running' && run.nodesRunning > 0 ? ` (${run.nodesRunning} running)` : ''}
          </span>
          {run.findingsCount > 0 && (
            <span style={{ color: '#4ade80' }}>{run.findingsCount} findings</span>
          )}
        </div>
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{
          fontSize: 10,
          padding: '2px 7px',
          borderRadius: 8,
          background: statusColor,
          color: run.status === 'aborted' ? '#fff' : '#000',
          fontWeight: 600,
          textTransform: 'capitalize',
        }}>
          {run.status}
        </span>
        {run.durationSeconds !== null && (
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #777)' }}>
            {formatDuration(run.durationSeconds)}
          </span>
        )}
        {canResume && (
          <button
            onClick={e => { e.stopPropagation(); onResume(run.runId); }}
            style={{
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 4,
              border: '1px solid #4ade80',
              background: 'transparent',
              color: '#4ade80',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
            }}
          >
            Resume
          </button>
        )}
      </div>
    </div>
  );
}
