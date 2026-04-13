// --- Signal Protocol Types ---

export interface SignalFile {
  schema_version: 1;
  signal_id: string;
  agent: string;
  scope: string | null;
  status: 'success' | 'failure' | 'branch' | 'budget_exhausted';
  decision: {
    goto: string;
    reason: string;
    payload: unknown;
  } | null;
  outputs: Array<{
    path: string;
    sha256: string;
    size_bytes: number;
  }>;
  metrics: {
    duration_seconds: number;
    retries_used: number;
  };
  error: {
    category: string;
    message: string;
    recoverable: boolean;
  } | null;
}

// --- DAG Node Types ---

export type NodeState =
  | 'pending'
  | 'ready'
  | 'spawning'
  | 'running'
  | 'validating'
  | 'completed'
  | 'retrying'
  | 'failed'
  | 'skipped';

export interface DagNode {
  name: string;
  preset: string;
  state: NodeState;
  scope: string | null;
  dependsOn: string[];
  terminalId: string | null;
  retryCount: number;
  maxRetries: number;
  invocationCount: number;
  maxInvocations: number;
  timeoutMs: number;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  signal: SignalFile | null;
  startedAt: number | null;
  kind?: 'reasoning' | 'tool';
  tool?: string;
  toolInputs?: Record<string, unknown>;
  toolset?: ToolsetEntry[];
}

// --- Version Policy Types ---

export type VersionResolution = 'pin_at_start' | 'always_latest';
export type DestructiveChangeAction = 'invalidate_and_continue' | 'abort' | 'ignore';
export type InvalidationScope = 'contaminated' | 'all_findings' | 'all_candidates';

export interface VersionPolicy {
  resolution: VersionResolution;
  dynamic_tools: string[];
  on_destructive_change: {
    action: DestructiveChangeAction;
    scope: InvalidationScope | InvalidationScope[];
  };
}

export const DEFAULT_VERSION_POLICY: VersionPolicy = {
  resolution: 'pin_at_start',
  dynamic_tools: [],
  on_destructive_change: {
    action: 'invalidate_and_continue',
    scope: 'contaminated',
  },
};

// --- Workflow YAML Types ---

export interface WorkflowConfig {
  name: string;
  version: number;
  version_policy?: VersionPolicy;
  plugin?: string;
  _yamlPath?: string;
  _resolved_tools?: Record<string, number>;
  config: Record<string, unknown> & {
    agent_timeout_seconds: number;
    /** Scope concurrency: max number of distinct sub-DAG scopes active in parallel. */
    max_parallel_scopes?: number;
    /** @deprecated Use max_parallel_scopes. Aliased for backward compatibility. */
    max_parallel_hypotheses?: number;
    /** Hard cap on total concurrent agents (spawning + running + validating). */
    max_concurrent_agents?: number;
  };
  shared_context: string;
  nodes: Record<string, WorkflowNodeDef>;
}

export interface WorkflowNodeDef {
  preset: string;
  depends_on?: string[];
  depends_on_all?: string[];
  inputs?: string[];
  outputs?: string[];
  branch?: Array<{
    condition: string;
    goto: string;
    foreach?: string;
  }>;
  max_invocations?: number;
  next?: string;
  max_retries?: number;
  timeout_seconds?: number;
  model?: 'opus' | 'sonnet' | 'haiku';
  effort?: 'low' | 'medium' | 'high';

  // Node kind — required on every node
  kind?: 'reasoning' | 'tool';

  // kind: tool — registry tool reference
  tool?: string;               // e.g. 'pandas.load_csv'
  toolInputs?: Record<string, unknown>;

  // kind: reasoning — optional toolset declaration (Phase 1: parsed, not used)
  toolset?: ToolsetEntry[];

  // Evolutionary role for pool-based workflows
  evolutionary_role?: 'generator' | 'evaluator' | 'selector';

  // Agent backend type (default: 'claude')
  backend?: 'claude' | 'openai-compat' | 'ollama';
  // process backend: command to execute
  command?: string[];
  // process backend: working directory override
  working_dir?: string;
  // local-llm backend: API endpoint
  endpoint?: string;
  // local-llm backend: max tokens for completion
  max_tokens?: number;
  // local-llm backend: provider API format ('openai' or 'ollama')
  provider?: 'openai' | 'ollama';
  // local-llm backend: disable thinking mode (Ollama only, for Qwen/DeepSeek-R1)
  disable_thinking?: boolean;
}

export type ToolsetEntry =
  | { name: string; category?: never; glob?: never }
  | { category: string; name?: never; glob?: never }
  | { glob: string; name?: never; category?: never };

// --- State Transitions ---

export const TRANSITIONS: Record<NodeState, Partial<Record<string, NodeState>>> = {
  pending:    { deps_met: 'ready', upstream_failed: 'skipped', budget_exhausted: 'skipped' },
  ready:      { spawn: 'spawning' },
  spawning:   { terminal_created: 'running' },
  running:    { signal_received: 'validating', timeout: 'retrying', crash: 'retrying' },
  validating: { outputs_valid: 'completed', integrity_failed: 'retrying' },
  retrying:   { retry_available: 'spawning', max_retries: 'failed' },
  completed:  {},
  failed:     {},
  skipped:    {},
};

// --- Event Log ---

export interface EventLogEntry {
  timestamp: number;
  runId: string;
  node: string;
  fromState: NodeState;
  toState: NodeState;
  event: string;
}

/** Event emitted when a converter tool is automatically inserted and invoked. */
export interface ConverterEventLogEntry {
  type: 'converter_inserted';
  converterTool: string;
  converterVersion: number;
  upstreamNode: string;
  upstreamPort: string;
  downstreamNode: string;
  downstreamPort: string;
  convertedHandle: string;
  durationMs: number;
}

// --- Node Snapshot (for run resume) ---

export interface NodeSnapshot {
  key: string;
  name: string;
  preset: string;
  state: NodeState;
  scope: string | null;
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  invocationCount: number;
  maxInvocations: number;
  timeoutMs: number;
  signalId: string | null;
  startedAt: number | null;
}

export interface RunSnapshot {
  runId: string;
  timestamp: number;
  paused: boolean;
  nodes: NodeSnapshot[];
}

// --- Signal Filename Parsing ---

export const SIGNAL_FILENAME_REGEX = /^(?<agent>[a-z_]+)(?:\.(?<scope>[A-Za-z0-9_-]+))?(?:\.(?<iteration>pass|retry)-(?<n>\d+))?\.done\.json$/;

// --- Validation ---

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    issue: 'missing' | 'size_mismatch' | 'sha256_mismatch' | 'json_parse_failed';
    expected: string | number;
    actual: string | number | null;
  }>;
}
