export type ClientMessage =
  | { type: 'terminal:input'; terminalId: string; data: string }
  | { type: 'terminal:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal:spawn'; name?: string; command?: string; cwd?: string }
  | { type: 'terminal:attach'; tmuxSessionName: string }
  | { type: 'terminal:kill'; terminalId: string }
  | { type: 'terminal:list' };

export type ServerMessage =
  | { type: 'terminal:output'; terminalId: string; data: string }
  | { type: 'terminal:created'; terminalId: string; name: string }
  | { type: 'terminal:exited'; terminalId: string; exitCode: number }
  | { type: 'terminal:list'; terminals: import('../modules/terminal/types.js').TerminalInfo[] }
  | { type: 'error'; message: string };
