import { useState, useEffect } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import type { ServerMessage } from '../../types';
import { DagVisualization } from './DagVisualization';
import './WorkflowPanel.css';

interface WorkflowNode {
  name: string;
  state: string;
  scope: string | null;
}

interface WorkflowSummary {
  total_nodes: number;
  completed: number;
  failed: number;
  skipped: number;
  duration_seconds: number;
}

interface WorkflowPanelProps {
  ws: WebSocketClient | null;
  workspacePath: string | null;
}

export function WorkflowPanel({ ws, workspacePath }: WorkflowPanelProps) {
  const [yaml, setYaml] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [summary, setSummary] = useState<WorkflowSummary | null>(null);
  const [error, setError] = useState('');
  const [workflowFiles, setWorkflowFiles] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/workflow-files')
      .then(r => r.json())
      .then(setWorkflowFiles)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ws) return;

    return ws.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'workflow:started':
          setRunId(msg.runId);
          setNodes(msg.nodes);
          setSummary(null);
          setError('');
          break;

        case 'workflow:node-update':
          setNodes(prev => prev.map(n =>
            n.name === msg.node ? { ...n, state: msg.toState } : n
          ));
          break;

        case 'workflow:completed':
          setSummary(msg.summary);
          break;

        case 'error':
          if (runId) setError(msg.message);
          break;
      }
    });
  }, [ws, runId]);

  function handleStart() {
    if (!ws || !workspacePath || !yaml.trim()) return;
    setError('');
    setSummary(null);
    setNodes([]);
    ws.send({ type: 'workflow:start', yamlContent: yaml, workspacePath });
  }

  function handleAbort() {
    if (!ws || !runId) return;
    ws.send({ type: 'workflow:abort', runId });
  }

  const isRunning = runId && !summary;

  return (
    <div className="workflow-panel">
      <div className="workflow-panel-title">Workflow</div>

      {workflowFiles.length > 0 && (
        <select
          className="workflow-panel-select"
          onChange={async (e) => {
            const file = e.target.value;
            if (!file) return;
            try {
              const res = await fetch(`/api/workflow-files/${encodeURIComponent(file)}`);
              const data = await res.json();
              if (data.content) setYaml(data.content);
            } catch { /* ignore */ }
          }}
          disabled={!!isRunning}
          defaultValue=""
        >
          <option value="">Load workflow file...</option>
          {workflowFiles.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      )}

      <textarea
        className="workflow-panel-textarea"
        value={yaml}
        onChange={e => setYaml(e.target.value)}
        placeholder="Paste workflow YAML here..."
        disabled={!!isRunning}
      />

      <div className="workflow-panel-actions">
        <button
          className="workflow-panel-btn workflow-panel-btn--primary"
          onClick={handleStart}
          disabled={!workspacePath || !yaml.trim() || !!isRunning}
        >
          Start Workflow
        </button>
        {isRunning && (
          <button
            className="workflow-panel-btn workflow-panel-btn--danger"
            onClick={handleAbort}
          >
            Abort
          </button>
        )}
      </div>

      {error && <div className="workflow-panel-status" style={{ color: 'var(--color-error)' }}>{error}</div>}

      {nodes.length > 0 && (
        <>
          <div className="workflow-panel-status">
            <div className="workflow-panel-status-label">
              {summary ? 'Completed' : 'Running'}{runId ? ` (${runId})` : ''}
            </div>
          </div>
          <DagVisualization nodes={nodes} yamlContent={yaml} />
        </>
      )}

      {summary && (
        <div className="workflow-panel-summary">
          {summary.completed} completed, {summary.failed} failed, {summary.skipped} skipped
          &mdash; {Math.round(summary.duration_seconds)}s
        </div>
      )}
    </div>
  );
}
