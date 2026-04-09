import { useState, useEffect } from 'react';
import type { WebSocketClient } from '../../services/websocket-client';
import type { ServerMessage, InputManifest, DataSource } from '../../types';
import { SourceModal } from './SourceModal';
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

export interface Finding {
  hypothesisId: string;
  content: string;
}

export interface WorkflowState {
  yaml: string;
  runId: string | null;
  nodes: WorkflowNode[];
  summary: WorkflowSummary | null;
  error: string;
  paused: boolean;
  findings: Finding[];
}

interface WorkflowPanelProps {
  ws: WebSocketClient | null;
  workspacePath: string | null;
  workflowState: WorkflowState;
  onStateChange: (state: Partial<WorkflowState>) => void;
}

export function useWorkflowState(ws: WebSocketClient | null): [WorkflowState, (s: Partial<WorkflowState>) => void] {
  const [state, setState] = useState<WorkflowState>({
    yaml: '',
    runId: null,
    nodes: [],
    summary: null,
    error: '',
    paused: false,
    findings: [],
  });

  function update(partial: Partial<WorkflowState>) {
    setState(prev => ({ ...prev, ...partial }));
  }

  useEffect(() => {
    if (!ws) return;

    return ws.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'workflow:started':
          setState(prev => ({ ...prev, runId: msg.runId, nodes: msg.nodes, summary: null, error: '', findings: [] }));
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

        case 'workflow:paused':
          setState(prev => ({ ...prev, paused: true }));
          break;

        case 'workflow:resumed':
          setState(prev => ({ ...prev, paused: false }));
          break;

        case 'workflow:finding':
          setState(prev => {
            const exists = prev.findings.some(f => f.hypothesisId === msg.hypothesisId);
            if (exists) return prev;
            return { ...prev, findings: [...prev.findings, { hypothesisId: msg.hypothesisId, content: msg.content }] };
          });
          break;

        case 'error':
          setState(prev => ({ ...prev, error: msg.message }));
          break;
      }
    });
  }, [ws]);

  return [state, update];
}

function sourceLabel(src: DataSource): string {
  switch (src.type) {
    case 'local_file': return (src as Record<string, unknown>).path as string || 'Local file';
    case 'url': return (src as Record<string, unknown>).url as string || 'URL';
    case 'glob': return (src as Record<string, unknown>).pattern as string || 'Glob';
    case 'postgres': return 'PostgreSQL' + ((src as Record<string, unknown>).query ? ' (query)' : ' (discovery)');
    case 'mysql': return 'MySQL' + ((src as Record<string, unknown>).query ? ' (query)' : ' (discovery)');
    case 'sqlite': return (src as Record<string, unknown>).path as string || 'SQLite';
    case 'bigquery': return `BigQuery: ${(src as Record<string, unknown>).dataset || ''}`;
    case 'snowflake': return `Snowflake: ${(src as Record<string, unknown>).database || ''}`;
    case 'mongo': return `MongoDB: ${(src as Record<string, unknown>).database || ''}`;
    case 's3': return `S3: ${(src as Record<string, unknown>).bucket || ''}`;
    case 'rest_api': return (src as Record<string, unknown>).base_url as string || 'REST API';
    case 'google_sheets': return 'Google Sheets';
    case 'inline': return 'Inline data';
    default: return src.type;
  }
}

interface ResumableRun {
  id: string;
  workflow_name: string;
  status: string;
  started_at: string;
  node_count: number;
  nodes_completed: number;
}

export function WorkflowPanel({ ws, workspacePath, workflowState, onStateChange }: WorkflowPanelProps) {
  const [workflowFiles, setWorkflowFiles] = useState<string[]>([]);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [description, setDescription] = useState('');
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [resumableRuns, setResumableRuns] = useState<ResumableRun[]>([]);
  const { yaml, runId, summary, error } = workflowState;

  useEffect(() => {
    fetch('/api/workflow-files')
      .then(r => r.json())
      .then(setWorkflowFiles)
      .catch(() => {});
    fetch('/api/workflows/runs/resumable')
      .then(r => r.json())
      .then(setResumableRuns)
      .catch(() => {});
  }, []);

  function handleStart() {
    if (!ws || !workspacePath || !yaml.trim()) return;
    onStateChange({ error: '', summary: null, nodes: [] });

    const inputManifest: InputManifest = {
      sources,
      config_overrides: {},
      scope: null,
      description: description || null,
    };

    ws.send({
      type: 'workflow:start',
      yamlContent: yaml,
      workspacePath,
      inputManifest: sources.length > 0 ? inputManifest : undefined,
    });
  }

  function handleResumeRun(resumeRunId: string) {
    if (!ws) return;
    onStateChange({ error: '', summary: null, nodes: [] });
    ws.send({ type: 'workflow:resume-run', runId: resumeRunId });
    setResumableRuns(prev => prev.filter(r => r.id !== resumeRunId));
  }

  function handleAbort() {
    if (!ws || !runId) return;
    ws.send({ type: 'workflow:abort', runId });
  }

  function handlePause() {
    if (!ws || !runId) return;
    ws.send({ type: 'workflow:pause', runId });
  }

  function handleResume() {
    if (!ws || !runId) return;
    ws.send({ type: 'workflow:resume', runId });
  }

  const isRunning = runId && !summary;
  const { paused } = workflowState;

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
          <option value="">Load workflow...</option>
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

      <div className="workflow-panel-section-label">Data Sources</div>

      {sources.map((src, i) => (
        <div key={i} className="workflow-panel-source">
          <span className="workflow-panel-source-type">{src.type}</span>
          <span className="workflow-panel-source-name">{sourceLabel(src)}</span>
          <button className="workflow-panel-source-remove" onClick={() => setSources(prev => prev.filter((_, j) => j !== i))} disabled={!!isRunning}>x</button>
        </div>
      ))}

      {!isRunning && (
        <button
          className="workflow-panel-btn"
          onClick={() => setShowSourceModal(true)}
          style={{ width: '100%' }}
        >
          + Add Source
        </button>
      )}

      <input
        className="workflow-panel-input"
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        disabled={!!isRunning}
      />

      <div className="workflow-panel-actions">
        {!isRunning && (
          <button
            className="workflow-panel-btn workflow-panel-btn--primary"
            onClick={handleStart}
            disabled={!workspacePath || !yaml.trim()}
          >
            Start
          </button>
        )}
        {isRunning && !paused && (
          <button
            className="workflow-panel-btn workflow-panel-btn--warn"
            onClick={handlePause}
          >
            Pause
          </button>
        )}
        {isRunning && paused && (
          <button
            className="workflow-panel-btn workflow-panel-btn--primary"
            onClick={handleResume}
          >
            Resume
          </button>
        )}
        {isRunning && (
          <button
            className="workflow-panel-btn workflow-panel-btn--danger"
            onClick={handleAbort}
          >
            Stop
          </button>
        )}
      </div>

      {!isRunning && resumableRuns.length > 0 && (
        <div className="workflow-panel-section-label">Resumable Runs</div>
      )}
      {!isRunning && resumableRuns.map(r => (
        <div key={r.id} className="workflow-panel-source" style={{ flexWrap: 'wrap' }}>
          <span className="workflow-panel-source-type" title={r.id}>{r.workflow_name}</span>
          <span className="workflow-panel-source-name" style={{ fontSize: 10 }}>
            {r.nodes_completed}/{r.node_count} nodes
          </span>
          <button
            className="workflow-panel-btn"
            style={{ padding: '2px 8px', fontSize: 10 }}
            onClick={() => handleResumeRun(r.id)}
          >
            Resume
          </button>
        </div>
      ))}

      {error && <div className="workflow-panel-status" style={{ color: 'var(--color-error)' }}>{error}</div>}

      {summary && (
        <div className="workflow-panel-summary">
          {summary.completed} completed, {summary.failed} failed, {summary.skipped} skipped
          &mdash; {Math.round(summary.duration_seconds)}s
        </div>
      )}

      {showSourceModal && (
        <SourceModal
          onAdd={(src) => setSources(prev => [...prev, src])}
          onClose={() => setShowSourceModal(false)}
          workspacePath={workspacePath}
        />
      )}
    </div>
  );
}
