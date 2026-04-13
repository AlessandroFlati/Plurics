// --- Run / History types (declared first so ServerMessage can reference them) ---

export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'interrupted';

export interface RunSummary {
  runId: string;
  workflowName: string;
  workflowVersion: number;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  nodesTotal: number;
  nodesCompleted: number;
  nodesRunning: number;
  nodesFailed: number;
  findingsCount: number;
  workspacePath: string;
  description: string | null;
}

export type ServerMessage =
  | { type: 'error'; message: string }
  | { type: 'workflow:started'; runId: string; nodeCount: number; nodes: Array<{ name: string; state: string; scope: string | null }> }
  | { type: 'workflow:node-update'; runId: string; node: string; fromState: string; toState: string; event: string; terminalId?: string }
  | { type: 'workflow:completed'; runId: string; summary: { total_nodes: number; completed: number; failed: number; skipped: number; duration_seconds: number } }
  | { type: 'workflow:paused'; runId: string }
  | { type: 'workflow:resumed'; runId: string }
  | { type: 'workflow:finding'; runId: string; hypothesisId: string; content: string }
  | { type: 'workflow:state_changed'; runId: string; status: RunStatus }
  | { type: 'node:state_changed'; runId: string; nodeName: string; state: string; scope: string | null }
  | { type: 'signal:received'; runId: string; nodeName: string; signal: string; summary: string }
  | { type: 'tool:invoked'; runId: string; nodeName: string; toolName: string; toolVersion: string }
  | { type: 'finding:produced'; runId: string; findingId: string; hypothesisId: string; content: string }
  | { type: 'run:created'; run: RunSummary };

// --- Input Manifest ---

export interface InputManifest {
  sources: DataSource[];
  config_overrides: Record<string, unknown>;
  scope: ScopeConstraint | null;
  description: string | null;
}

// DataSource is a pass-through to the server. The UI creates local_file sources;
// other types can be added via raw JSON or future UI extensions.
export type DataSource = Record<string, unknown> & { type: string };

export interface ScopeConstraint {
  include_columns: string[] | null;
  exclude_columns: string[] | null;
  date_range: { column: string; start: string | null; end: string | null } | null;
  row_filter: { column: string; operator: string; value: unknown } | null;
  max_rows: number | null;
  sampling_method: 'head' | 'random' | 'stratified' | null;
  stratify_column: string | null;
}

export type ClientMessage =
  | { type: 'workflow:start'; yamlContent: string; workspacePath: string; yamlPath?: string; inputManifest?: InputManifest }
  | { type: 'workflow:abort'; runId: string }
  | { type: 'workflow:pause'; runId: string }
  | { type: 'workflow:resume'; runId: string }
  | { type: 'workflow:status'; runId: string }
  | { type: 'workflow:resume-run'; runId: string };

export interface NodeState {
  nodeName: string;
  scope: string | null;
  kind: 'reasoning' | 'tool' | 'converter';
  state: string;
  attempt: number;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  backend?: string;
  model?: string;
  toolName?: string;
  toolVersion?: string;
  lastSignalSummary: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
}

export type EventCategory =
  | 'workflow_started'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'node_state_transition'
  | 'signal_received'
  | 'tool_invoked'
  | 'finding_produced';

export interface WorkflowEvent {
  eventId: number | string;
  runId: string;
  category: EventCategory;
  timestamp: string;
  description: string;
  nodeName: string | null;
  scope: string | null;
  payload: Record<string, unknown>;
}

export interface FindingRecord {
  findingId: string;
  runId: string;
  hypothesisId: string;
  content: string;
  summary: string;
  verdict: 'confirmed' | 'falsified' | 'inconclusive';
  producedAt: string;
  nodeName: string | null;
  scope: string | null;
}

export interface ToolPort {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ToolSummary {
  name: string;
  version: string;
  description: string;
  category: string;
  inputPorts: ToolPort[];
  outputPorts: ToolPort[];
}

export interface ToolDetail extends ToolSummary {
  sourceHash: string;
  registeredAt: string;
}

export interface ToolInvocationRecord {
  invocationId: string;
  runId: string;
  nodeName: string;
  toolName: string;
  toolVersion: string;
  startedAt: string;
  completedAt: string | null;
  success: boolean;
  errorMessage: string | null;
}

export interface RegistryCategory {
  category: string;
  toolCount: number;
}

export interface ToolUsageSummary {
  toolName: string;
  toolVersion: string;
  invocationCount: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  invokingNodes: string[];
}

export interface RunFilters {
  status?: RunStatus;
  workflowName?: string;
}
