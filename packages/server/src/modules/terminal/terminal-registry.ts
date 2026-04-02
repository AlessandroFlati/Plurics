import type { TmuxManager } from './tmux-manager.js';
import { TerminalSession } from './terminal-session.js';
import type { TerminalConfig, TerminalInfo } from './types.js';

export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly tmux: TmuxManager;

  constructor(tmux: TmuxManager) {
    this.tmux = tmux;
  }

  async spawn(config: TerminalConfig): Promise<TerminalInfo> {
    const session = await TerminalSession.create(this.tmux, config);
    this.sessions.set(session.id, session);
    session.onExit(() => this.sessions.delete(session.id));
    return session.info;
  }

  async attach(tmuxSessionName: string): Promise<TerminalInfo> {
    for (const session of this.sessions.values()) {
      if (session.tmuxSession === tmuxSessionName) {
        return session.info;
      }
    }
    const session = await TerminalSession.attach(this.tmux, tmuxSessionName);
    this.sessions.set(session.id, session);
    session.onExit(() => this.sessions.delete(session.id));
    return session.info;
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  list(): TerminalInfo[] {
    return Array.from(this.sessions.values()).map(s => s.info);
  }

  async kill(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Terminal not found: ${id}`);
    }
    await session.destroy();
    this.sessions.delete(id);
  }

  async discover(): Promise<TerminalInfo[]> {
    const tmuxSessions = await this.tmux.listSessions();
    const discovered: TerminalInfo[] = [];
    for (const name of tmuxSessions) {
      let alreadyTracked = false;
      for (const session of this.sessions.values()) {
        if (session.tmuxSession === name) {
          alreadyTracked = true;
          break;
        }
      }
      if (!alreadyTracked) {
        const info = await this.attach(name);
        discovered.push(info);
      }
    }
    return discovered;
  }

  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.kill(id);
    }
  }
}
