/**
 * ClaudeCodeSession — AgentBackend adapter for the existing TerminalSession.
 * Wraps node-pty based terminal sessions running `claude --dangerously-skip-permissions`.
 *
 * This is the backward-compatible path: existing workflows that use claude-code
 * backend get the same TerminalSession under the hood.
 */

import { TerminalSession } from './terminal-session.js';
import type { TerminalConfig } from './types.js';
import type { AgentBackend, AgentConfig, AgentInfo, AgentResult, BackendType } from './agent-backend.js';

type DataCallback = (data: string) => void;
type ExitCallback = () => void;

export class ClaudeCodeSession implements AgentBackend {
  readonly backendType: BackendType = 'claude-code';
  private session: TerminalSession;

  private constructor(session: TerminalSession) {
    this.session = session;
  }

  get id(): string { return this.session.id; }
  get name(): string { return this.session.name; }

  get info(): AgentInfo {
    const termInfo = this.session.info;
    return {
      id: termInfo.id,
      name: termInfo.name,
      backendType: 'claude-code',
      status: termInfo.status,
      createdAt: termInfo.createdAt,
    };
  }

  /** Create from AgentConfig (used by AgentRegistry). */
  static async create(config: AgentConfig): Promise<ClaudeCodeSession> {
    const termConfig: TerminalConfig = {
      name: config.name,
      command: config.command,
      cwd: config.cwd,
      purpose: config.purpose,
    };
    const session = await TerminalSession.create(termConfig);
    return new ClaudeCodeSession(session);
  }

  /** Wrap an existing TerminalSession (for backward compat with manual spawns). */
  static fromTerminalSession(session: TerminalSession): ClaudeCodeSession {
    return new ClaudeCodeSession(session);
  }

  /** Access the underlying TerminalSession for legacy code paths. */
  getTerminalSession(): TerminalSession {
    return this.session;
  }

  async start(): Promise<void> {
    // TerminalSession starts on creation — no-op here
  }

  async stop(): Promise<void> {
    await this.session.destroy();
  }

  isAlive(): boolean {
    return this.session.info.status === 'running';
  }

  async inject(content: string): Promise<void> {
    this.session.write(content);
  }

  onOutput(callback: DataCallback): () => void {
    return this.session.onData(callback);
  }

  onExit(callback: ExitCallback): () => void {
    return this.session.onExit(callback);
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.session.resize(cols, rows);
  }

  write(data: string): void {
    this.session.write(data);
  }

  getResult(): AgentResult | null {
    // Claude-code agents write signal files directly — no in-memory result
    return null;
  }
}
