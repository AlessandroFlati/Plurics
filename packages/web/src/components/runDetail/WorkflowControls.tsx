import { useState } from 'react';
import type { RunStatus } from '../../types';
import { pauseRun, resumeRun, abortRun } from '../../services/api';

interface WorkflowControlsProps {
  runId: string;
  status: RunStatus;
}

export function WorkflowControls({ runId, status }: WorkflowControlsProps) {
  const [pauseLoading, setPauseLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [abortLoading, setAbortLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canPause = status === 'running';
  const canResume = status === 'interrupted' || status === 'paused';
  const canAbort = status === 'running' || status === 'paused' || status === 'interrupted';

  async function handlePause() {
    setPauseLoading(true);
    setActionError(null);
    try {
      await pauseRun(runId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPauseLoading(false);
    }
  }

  async function handleResume() {
    setResumeLoading(true);
    setActionError(null);
    try {
      await resumeRun(runId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setResumeLoading(false);
    }
  }

  async function handleAbort() {
    setAbortLoading(true);
    setActionError(null);
    try {
      await abortRun(runId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setAbortLoading(false);
    }
  }

  const btnBase: React.CSSProperties = {
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 4,
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handlePause}
          disabled={!canPause || pauseLoading}
          style={{ ...btnBase, border: '1px solid #facc15', color: '#facc15', opacity: canPause ? 1 : 0.4, cursor: canPause ? 'pointer' : 'not-allowed' }}
        >
          {pauseLoading ? '...' : 'Pause'}
        </button>
        <button
          onClick={handleResume}
          disabled={!canResume || resumeLoading}
          style={{ ...btnBase, border: '1px solid #4ade80', color: '#4ade80', opacity: canResume ? 1 : 0.4, cursor: canResume ? 'pointer' : 'not-allowed' }}
        >
          {resumeLoading ? '...' : 'Resume'}
        </button>
        <button
          onClick={handleAbort}
          disabled={!canAbort || abortLoading}
          style={{ ...btnBase, border: '1px solid #f87171', color: '#f87171', opacity: canAbort ? 1 : 0.4, cursor: canAbort ? 'pointer' : 'not-allowed' }}
        >
          {abortLoading ? '...' : 'Abort'}
        </button>
      </div>
      {actionError && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#f87171' }}>{actionError}</div>
      )}
    </div>
  );
}
