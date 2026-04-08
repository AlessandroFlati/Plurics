import { TerminalSession } from './terminal-session.js';
import type { TerminalConfig, TerminalInfo } from './types.js';

export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>();

  async spawn(config: TerminalConfig): Promise<TerminalInfo> {
    const session = await TerminalSession.create(config);
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

  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.kill(id);
    }
  }
}
