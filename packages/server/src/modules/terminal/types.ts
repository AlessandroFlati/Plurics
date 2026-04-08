export interface TerminalInfo {
  id: string;
  name: string;
  tmuxSession: string;
  status: TerminalStatus;
  createdAt: number;
  cols: number;
  rows: number;
}

export type TerminalStatus = 'running' | 'exited';

export interface TerminalConfig {
  name?: string;
  command?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  purpose?: string;
  presetId?: number;
}

export const DEFAULT_COMMAND = 'claude --dangerously-skip-permissions';
export const DEFAULT_CWD = process.cwd();
export const TMUX_PREFIX = 'caam-';
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 30;
