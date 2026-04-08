export interface TerminalInfo {
  id: string;
  name: string;
  tmuxSession: string;
  status: 'running' | 'exited';
  createdAt: number;
  cols: number;
  rows: number;
}

export type ServerMessage =
  | { type: 'terminal:output'; terminalId: string; data: string }
  | { type: 'terminal:created'; terminalId: string; name: string }
  | { type: 'terminal:exited'; terminalId: string; exitCode: number }
  | { type: 'terminal:list'; terminals: TerminalInfo[] }
  | { type: 'error'; message: string }
  | { type: 'workflow:started'; runId: string; nodeCount: number; nodes: Array<{ name: string; state: string; scope: string | null }> }
  | { type: 'workflow:node-update'; runId: string; node: string; fromState: string; toState: string; event: string; terminalId?: string }
  | { type: 'workflow:completed'; runId: string; summary: { total_nodes: number; completed: number; failed: number; skipped: number; duration_seconds: number } };

// --- Input Manifest ---

export interface InputManifest {
  sources: DataSource[];
  config_overrides: Record<string, unknown>;
  scope: ScopeConstraint | null;
  description: string | null;
}

export type DataSource =
  | { type: 'local_file'; path: string; format: string; sheet: string | null; encoding: string | null; delimiter: string | null }
  | { type: 'url'; url: string; format: string; headers: Record<string, string> }
  | { type: 'sqlite'; path: string; query: string }
  | { type: 'postgres'; connection_string: string; query: string }
  | { type: 'inline'; data: Record<string, unknown>[] };

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
  | { type: 'terminal:input'; terminalId: string; data: string }
  | { type: 'terminal:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal:spawn'; name?: string; command?: string; cwd?: string; purpose?: string; presetId?: number }
  | { type: 'terminal:attach'; tmuxSessionName: string }
  | { type: 'terminal:kill'; terminalId: string }
  | { type: 'terminal:subscribe'; terminalId: string }
  | { type: 'terminal:list' }
  | { type: 'workflow:start'; yamlContent: string; workspacePath: string; inputManifest?: InputManifest }
  | { type: 'workflow:abort'; runId: string }
  | { type: 'workflow:status'; runId: string };
