import { v4 as uuidv4 } from 'uuid';
import * as pty from 'node-pty';
import * as os from 'node:os';
import {
  type TerminalInfo,
  type TerminalConfig,
  DEFAULT_COMMAND,
  DEFAULT_CWD,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} from './types.js';

type DataCallback = (data: string) => void;
type ExitCallback = () => void;

export class TerminalSession {
  readonly id: string;
  readonly name: string;
  readonly tmuxSession: string;
  private status: 'running' | 'exited' = 'running';
  private cols: number;
  private rows: number;
  private readonly createdAt: number;
  private readonly listeners: Set<DataCallback> = new Set();
  private readonly exitListeners: Set<ExitCallback> = new Set();
  private ptyProcess: pty.IPty | null = null;
  private commandStarted = false;
  private readonly deferredCommand: string;
  private readonly cwd: string;

  private constructor(
    id: string,
    name: string,
    cols: number,
    rows: number,
    deferredCommand: string,
    cwd: string,
  ) {
    this.id = id;
    this.name = name;
    this.tmuxSession = `caam-${name}`;
    this.cols = cols;
    this.rows = rows;
    this.createdAt = Date.now();
    this.deferredCommand = deferredCommand;
    this.cwd = cwd;
  }

  static async create(config: TerminalConfig): Promise<TerminalSession> {
    const id = uuidv4();
    const name = config.name ?? id;
    const cols = config.cols ?? DEFAULT_COLS;
    const rows = config.rows ?? DEFAULT_ROWS;
    const command = config.command ?? DEFAULT_COMMAND;
    const cwd = config.cwd ?? DEFAULT_CWD;

    const session = new TerminalSession(id, name, cols, rows, command, cwd);

    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    session.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    session.ptyProcess.onData((data: string) => {
      for (const cb of session.listeners) {
        cb(data);
      }
    });

    session.ptyProcess.onExit(() => {
      if (session.status === 'exited') return;
      session.status = 'exited';
      for (const cb of session.exitListeners) {
        cb();
      }
    });

    return session;
  }

  get info(): TerminalInfo {
    return {
      id: this.id,
      name: this.name,
      tmuxSession: this.tmuxSession,
      status: this.status,
      createdAt: this.createdAt,
      cols: this.cols,
      rows: this.rows,
    };
  }

  get isCommandRunning(): boolean {
    return this.commandStarted;
  }

  write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  onData(callback: DataCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onExit(callback: ExitCallback): () => void {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.cols = cols;
    this.rows = rows;
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
    }

    // On first resize: launch the deferred command.
    // This ensures the TUI app starts at the client's actual dimensions.
    if (!this.commandStarted) {
      this.commandStarted = true;
      if (this.deferredCommand) {
        this.write(this.deferredCommand + '\r');
      }
    }
  }

  async getScrollback(): Promise<string> {
    return '';
  }

  async getScreenContent(): Promise<string> {
    return '';
  }

  async destroy(): Promise<void> {
    const wasRunning = this.status === 'running';
    this.status = 'exited';
    this.listeners.clear();
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    if (wasRunning) {
      for (const cb of this.exitListeners) {
        cb();
      }
    }
    this.exitListeners.clear();
  }
}
