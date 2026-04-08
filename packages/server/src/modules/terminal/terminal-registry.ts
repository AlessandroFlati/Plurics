import { TerminalSession } from './terminal-session.js';
import type { TerminalConfig, TerminalInfo } from './types.js';

type SpawnCallback = (name: string, purpose: string) => void;
type ExitCallback = (name: string) => void;

export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly purposes = new Map<string, string>();
  private readonly spawnCallbacks = new Set<SpawnCallback>();
  private readonly exitCallbacks = new Set<ExitCallback>();
  private readonly perTerminalExitCallbacks = new Map<string, Array<() => void>>();

  async spawn(config: TerminalConfig): Promise<TerminalInfo> {
    const session = await TerminalSession.create(config);
    this.sessions.set(session.id, session);
    if (config.purpose) {
      this.purposes.set(session.name, config.purpose);
    }
    session.onExit(() => {
      const id = session.id;
      this.sessions.delete(id);
      const name = session.name;
      this.purposes.delete(name);
      for (const cb of this.exitCallbacks) cb(name);
      const perTerminal = this.perTerminalExitCallbacks.get(id);
      if (perTerminal) {
        for (const cb of perTerminal) cb();
        this.perTerminalExitCallbacks.delete(id);
      }
    });
    for (const cb of this.spawnCallbacks) cb(session.name, config.purpose ?? '');
    return session.info;
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  getByName(name: string): TerminalSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.name === name) return session;
    }
    return undefined;
  }

  list(): TerminalInfo[] {
    return Array.from(this.sessions.values()).map(s => s.info);
  }

  listWithPurpose(): Array<{ name: string; purpose: string }> {
    return Array.from(this.sessions.values()).map(s => ({
      name: s.name,
      purpose: this.purposes.get(s.name) ?? '',
    }));
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

  onSpawn(callback: SpawnCallback): () => void {
    this.spawnCallbacks.add(callback);
    return () => this.spawnCallbacks.delete(callback);
  }

  onTerminalExit(callback: ExitCallback): () => void {
    this.exitCallbacks.add(callback);
    return () => this.exitCallbacks.delete(callback);
  }

  onTerminalExitById(terminalId: string, callback: () => void): void {
    if (!this.perTerminalExitCallbacks.has(terminalId)) {
      this.perTerminalExitCallbacks.set(terminalId, []);
    }
    this.perTerminalExitCallbacks.get(terminalId)!.push(callback);
  }

  private readonly outputListeners = new Map<string, Array<(data: string) => void>>();

  onOutput(terminalId: string, callback: (data: string) => void): () => void {
    if (!this.outputListeners.has(terminalId)) {
      this.outputListeners.set(terminalId, []);
    }
    this.outputListeners.get(terminalId)!.push(callback);

    // Attach to existing session if already spawned
    const session = this.sessions.get(terminalId);
    if (session) {
      return session.onData(callback);
    }
    return () => {
      const listeners = this.outputListeners.get(terminalId);
      if (listeners) {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }
}
