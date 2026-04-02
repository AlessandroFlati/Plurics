import { v4 as uuidv4 } from 'uuid';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TmuxManager } from './tmux-manager.js';
import {
  type TerminalInfo,
  type TerminalConfig,
  DEFAULT_COMMAND,
  DEFAULT_CWD,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  TMUX_PREFIX,
} from './types.js';

type DataCallback = (data: string) => void;

export class TerminalSession {
  readonly id: string;
  readonly name: string;
  readonly tmuxSession: string;
  private status: 'running' | 'exited' = 'running';
  private cols: number;
  private rows: number;
  private readonly createdAt: number;
  private readonly tmux: TmuxManager;
  private readonly listeners: Set<DataCallback> = new Set();
  private pipeProcess: ChildProcess | null = null;
  private pipePath: string | null = null;
  private exitPoller: ReturnType<typeof setInterval> | null = null;
  private pipeStarted = false;
  private readonly deferredCommand: string;

  private constructor(
    id: string,
    name: string,
    tmuxSession: string,
    cols: number,
    rows: number,
    tmux: TmuxManager,
    deferredCommand: string,
  ) {
    this.id = id;
    this.name = name;
    this.tmuxSession = tmuxSession;
    this.cols = cols;
    this.rows = rows;
    this.createdAt = Date.now();
    this.tmux = tmux;
    this.deferredCommand = deferredCommand;
  }

  static async create(tmux: TmuxManager, config: TerminalConfig): Promise<TerminalSession> {
    const id = uuidv4();
    const name = config.name ?? id;
    const cols = config.cols ?? DEFAULT_COLS;
    const rows = config.rows ?? DEFAULT_ROWS;
    const command = config.command ?? DEFAULT_COMMAND;
    const cwd = config.cwd ?? DEFAULT_CWD;

    // Create tmux with a waiting shell. The real command is deferred until
    // the client sends its actual terminal dimensions (first resize).
    // This ensures the TUI renders at the correct size from the start.
    const tmuxSession = await tmux.createSession(name, 'bash', cols, rows, cwd);
    const session = new TerminalSession(id, name, tmuxSession, cols, rows, tmux, command);
    session.startExitPoller();
    return session;
  }

  static async attach(tmux: TmuxManager, tmuxSessionName: string): Promise<TerminalSession> {
    const exists = await tmux.hasSession(tmuxSessionName);
    if (!exists) {
      throw new Error(`tmux session not found: ${tmuxSessionName}`);
    }
    const id = uuidv4();
    const name = tmuxSessionName.replace(TMUX_PREFIX, '');
    const session = new TerminalSession(id, name, tmuxSessionName, DEFAULT_COLS, DEFAULT_ROWS, tmux, '');
    // For attached sessions, pipe immediately (already running at whatever size)
    await session.startPipeOutput();
    session.pipeStarted = true;
    session.startExitPoller();
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

  write(data: string): void {
    this.tmux.sendKeys(this.tmuxSession, data);
  }

  onData(callback: DataCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.cols = cols;
    this.rows = rows;
    await this.tmux.resizePane(this.tmuxSession, cols, rows);

    // On first resize: start pipe-pane, then launch the deferred command.
    // This ensures the TUI app starts at the client's actual dimensions.
    if (!this.pipeStarted) {
      this.pipeStarted = true;
      await this.startPipeOutput();
      if (this.deferredCommand) {
        // Use exec to replace the waiting shell with the real command
        await this.tmux.sendKeys(this.tmuxSession, `exec ${this.deferredCommand}\n`);
      }
    }
  }

  async getScrollback(): Promise<string> {
    return this.tmux.capturePane(this.tmuxSession);
  }

  async destroy(): Promise<void> {
    this.stopPipeOutput();
    this.stopExitPoller();
    this.status = 'exited';
    this.listeners.clear();
    try {
      await this.tmux.killSession(this.tmuxSession);
    } catch {
      // Session may already be dead
    }
  }

  /**
   * Use `tmux pipe-pane` to stream raw PTY output through a FIFO.
   * This captures the actual escape sequences that xterm.js needs
   * to render TUI apps correctly (unlike capture-pane which strips them).
   */
  private async startPipeOutput(): Promise<void> {
    const tmpDir = os.tmpdir();
    this.pipePath = path.join(tmpDir, `caam-pipe-${this.id}`);

    await new Promise<void>((resolve, reject) => {
      const mkfifo = spawn('mkfifo', [this.pipePath!]);
      mkfifo.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`mkfifo failed with code ${code}`));
      });
    });

    await this.tmux.pipePaneToFile(this.tmuxSession, this.pipePath);

    this.pipeProcess = spawn('cat', [this.pipePath], { stdio: ['ignore', 'pipe', 'ignore'] });

    this.pipeProcess.stdout!.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf-8');
      for (const cb of this.listeners) {
        cb(data);
      }
    });

    this.pipeProcess.on('close', () => {
      // Pipe closed -- session likely ended
    });
  }

  private stopPipeOutput(): void {
    this.tmux.pipePaneStop(this.tmuxSession).catch(() => {});

    if (this.pipeProcess) {
      this.pipeProcess.kill();
      this.pipeProcess = null;
    }

    if (this.pipePath) {
      try { fs.unlinkSync(this.pipePath); } catch { /* may already be gone */ }
      this.pipePath = null;
    }
  }

  private startExitPoller(): void {
    this.exitPoller = setInterval(async () => {
      try {
        const exists = await this.tmux.hasSession(this.tmuxSession);
        if (!exists) {
          this.status = 'exited';
          this.stopExitPoller();
          this.stopPipeOutput();
        }
      } catch {
        // ignore
      }
    }, 2000);
  }

  private stopExitPoller(): void {
    if (this.exitPoller) {
      clearInterval(this.exitPoller);
      this.exitPoller = null;
    }
  }
}
