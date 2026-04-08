import { useState, useEffect } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import type { ServerMessage } from '../../types';
import './WorkflowPanel.css';

export interface WorkflowNode {
  name: string;
  state: string;
  scope: string | null;
}

export interface WorkflowSummary {
  total_nodes: number;
  completed: number;
  failed: number;
  skipped: number;
  duration_seconds: number;
}

export interface WorkflowState {
  yaml: string;
  runId: string | null;
  nodes: WorkflowNode[];
  summary: WorkflowSummary | null;
  error: string;
}

interface WorkflowPanelProps {
  ws: WebSocketClient | null;
  workspacePath: string | null;
  workflowState: WorkflowState;
  onStateChange: (state: WorkflowState) => void;
}

export function useWorkflowState(ws: WebSocketClient | null): [WorkflowState, (s: Partial<WorkflowState>) => void] {
  const [state, setState] = useState<WorkflowState>({
    yaml: '',
    runId: null,
    nodes: [],
    summary: null,
    error: '',
  });

  function update(partial: Partial<WorkflowState>) {
    setState(prev => ({ ...prev, ...partial }));
  }

  useEffect(() => {
    if (!ws) return;

    return ws.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'workflow:started':
          setState(prev => ({ ...prev, runId: msg.runId, nodes: msg.nodes, summary: null, error: '' }));
          break;

        case 'workflow:node-update':
          setState(prev => {
            const exists = prev.nodes.some(n => n.name === msg.node);
            const nodes = exists
              ? prev.nodes.map(n => n.name === msg.node ? { ...n, state: msg.toState } : n)
              : [...prev.nodes, { name: msg.node, state: msg.toState, scope: null }];
            return { ...prev, nodes };
          });
          break;

        case 'workflow:completed':
          setState(prev => ({ ...prev, summary: msg.summary }));
          break;

        case 'error':
          setState(prev => ({ ...prev, error: msg.message }));
          break;
      }
    });
  }, [ws]);

  return [state, update];
}

export function WorkflowPanel({ ws, workspacePath, workflowState, onStateChange }: WorkflowPanelProps) {
  const [workflowFiles, setWorkflowFiles] = useState<string[]>([]);
  const { yaml, runId, summary, error } = workflowState;

  useEffect(() => {
    fetch('/api/workflow-files')
      .then(r => r.json())
      .then(setWorkflowFiles)
      .catch(() => {});
  }, []);

  function handleStart() {
    if (!ws || !workspacePath || !yaml.trim()) return;
    onStateChange({ error: '', summary: null, nodes: [] });
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
              if (data.content) onStateChange({ yaml: data.content });
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
        onChange={e => onStateChange({ yaml: e.target.value })}
        placeholder="Paste workflow YAML here..."
        disabled={!!isRunning}
      />

      <div className="workflow-panel-actions">
        <button
          className="workflow-panel-btn workflow-panel-btn--primary"
          onClick={handleStart}
          disabled={!workspacePath || !yaml.trim() || !!isRunning}
        >
          Start
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

      {summary && (
        <div className="workflow-panel-summary">
          {summary.completed} completed, {summary.failed} failed, {summary.skipped} skipped
          &mdash; {Math.round(summary.duration_seconds)}s
        </div>
      )}
    </div>
  );
}
