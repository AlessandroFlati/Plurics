import { v4 as uuidv4 } from 'uuid';
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
  private poller: ReturnType<typeof setInterval> | null = null;
  private lastCaptureLength = 0;

  private constructor(
    id: string,
    name: string,
    tmuxSession: string,
    cols: number,
    rows: number,
    tmux: TmuxManager,
  ) {
    this.id = id;
    this.name = name;
    this.tmuxSession = tmuxSession;
    this.cols = cols;
    this.rows = rows;
    this.createdAt = Date.now();
    this.tmux = tmux;
  }

  static async create(tmux: TmuxManager, config: TerminalConfig): Promise<TerminalSession> {
    const id = uuidv4();
    const name = config.name ?? id;
    const cols = config.cols ?? DEFAULT_COLS;
    const rows = config.rows ?? DEFAULT_ROWS;
    const command = config.command ?? DEFAULT_COMMAND;
    const cwd = config.cwd ?? DEFAULT_CWD;

    const tmuxSession = await tmux.createSession(name, command, cols, rows, cwd);
    const session = new TerminalSession(id, name, tmuxSession, cols, rows, tmux);
    session.startPolling();
    return session;
  }

  static async attach(tmux: TmuxManager, tmuxSessionName: string): Promise<TerminalSession> {
    const exists = await tmux.hasSession(tmuxSessionName);
    if (!exists) {
      throw new Error(`tmux session not found: ${tmuxSessionName}`);
    }
    const id = uuidv4();
    const name = tmuxSessionName.replace(TMUX_PREFIX, '');
    const session = new TerminalSession(id, name, tmuxSessionName, DEFAULT_COLS, DEFAULT_ROWS, tmux);
    session.startPolling();
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
  }

  async getScrollback(): Promise<string> {
    return this.tmux.capturePane(this.tmuxSession);
  }

  async destroy(): Promise<void> {
    this.stopPolling();
    this.status = 'exited';
    this.listeners.clear();
    try {
      await this.tmux.killSession(this.tmuxSession);
    } catch {
      // Session may already be dead
    }
  }

  private startPolling(): void {
    this.poller = setInterval(async () => {
      try {
        const exists = await this.tmux.hasSession(this.tmuxSession);
        if (!exists) {
          this.status = 'exited';
          this.stopPolling();
          return;
        }
        const content = await this.tmux.capturePane(this.tmuxSession);
        if (content.length !== this.lastCaptureLength) {
          const newContent = content.slice(this.lastCaptureLength);
          this.lastCaptureLength = content.length;
          for (const cb of this.listeners) {
            cb(newContent);
          }
        }
      } catch {
        // Ignore transient capture failures
      }
    }, 100);
  }

  private stopPolling(): void {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }
}
