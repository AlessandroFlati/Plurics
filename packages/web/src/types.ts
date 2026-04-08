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

export type ClientMessage =
  | { type: 'terminal:input'; terminalId: string; data: string }
  | { type: 'terminal:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal:spawn'; name?: string; command?: string; cwd?: string; purpose?: string; presetId?: number }
  | { type: 'terminal:attach'; tmuxSessionName: string }
  | { type: 'terminal:kill'; terminalId: string }
  | { type: 'terminal:subscribe'; terminalId: string }
  | { type: 'terminal:list' }
  | { type: 'workflow:start'; yamlContent: string; workspacePath: string }
  | { type: 'workflow:abort'; runId: string }
  | { type: 'workflow:status'; runId: string };
