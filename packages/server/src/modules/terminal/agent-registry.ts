/**
 * AgentRegistry — manages all agent backends (claude-code, process, local-llm).
 *
 * Replaces TerminalRegistry as the central session manager. The existing
 * TerminalRegistry API is preserved for backward compatibility — manual spawns
 * from the UI still create claude-code sessions via the same interface.
 */

import type { AgentBackend, AgentConfig, AgentInfo, BackendType } from './agent-backend.js';
import { ClaudeCodeSession } from './claude-code-session.js';
import { ProcessSession } from './process-session.js';
import { LocalLlmSession } from './local-llm-session.js';
import type { TerminalConfig, TerminalInfo } from './types.js';
import { DEFAULT_COMMAND } from './types.js';

type SpawnCallback = (name: string, purpose: string) => void;
type ExitCallback = (name: string) => void;

export class AgentRegistry {
  private readonly sessions = new Map<string, AgentBackend>();
  private readonly purposes = new Map<string, string>();
  private readonly spawnCallbacks = new Set<SpawnCallback>();
  private readonly exitCallbacks = new Set<ExitCallback>();
  private readonly perAgentExitCallbacks = new Map<string, Array<() => void>>();

  /**
   * Spawn an agent using the appropriate backend.
   * For backward compat, also accepts TerminalConfig (treated as claude-code).
   */
  async spawn(config: AgentConfig | TerminalConfig): Promise<AgentInfo> {
    const agentConfig = this.normalizeConfig(config);
    const backend = await this.createBackend(agentConfig);

    this.sessions.set(backend.id, backend);
    if (agentConfig.purpose) {
      this.purposes.set(backend.name, agentConfig.purpose);
    }

    backend.onExit(() => {
      const id = backend.id;
      this.sessions.delete(id);
      this.purposes.delete(backend.name);
      for (const cb of this.exitCallbacks) cb(backend.name);
      const perAgent = this.perAgentExitCallbacks.get(id);
      if (perAgent) {
        for (const cb of perAgent) cb();
        this.perAgentExitCallbacks.delete(id);
      }
    });

    await backend.start();

    for (const cb of this.spawnCallbacks) cb(backend.name, agentConfig.purpose);
    return backend.info;
  }

  private normalizeConfig(config: AgentConfig | TerminalConfig): AgentConfig {
    // If it's already an AgentConfig (has 'backend' field), use directly
    if ('backend' in config) return config as AgentConfig;

    // Legacy TerminalConfig → AgentConfig
    const tc = config as TerminalConfig;
    return {
      name: tc.name ?? `agent-${Date.now()}`,
      cwd: tc.cwd ?? process.cwd(),
      purpose: tc.purpose ?? '',
      backend: 'claude-code',
      command: tc.command ?? DEFAULT_COMMAND,
    };
  }

  private async createBackend(config: AgentConfig): Promise<AgentBackend> {
    switch (config.backend) {
      case 'claude-code':
        return ClaudeCodeSession.create(config);

      case 'process': {
        const session = new ProcessSession(config);
        return session;
      }

      case 'local-llm': {
        const session = new LocalLlmSession(config);
        return session;
      }

      default:
        throw new Error(`Unknown backend type: ${config.backend}`);
    }
  }

  get(id: string): AgentBackend | undefined {
    return this.sessions.get(id);
  }

  getByName(name: string): AgentBackend | undefined {
    for (const session of this.sessions.values()) {
      if (session.name === name) return session;
    }
    return undefined;
  }

  list(): AgentInfo[] {
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
    if (!session) throw new Error(`Agent not found: ${id}`);
    await session.stop();
    this.sessions.delete(id);
  }

  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.kill(id).catch(() => {});
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
    if (!this.perAgentExitCallbacks.has(terminalId)) {
      this.perAgentExitCallbacks.set(terminalId, []);
    }
    this.perAgentExitCallbacks.get(terminalId)!.push(callback);
  }

  private readonly outputListeners = new Map<string, Array<(data: string) => void>>();

  onOutput(agentId: string, callback: (data: string) => void): () => void {
    if (!this.outputListeners.has(agentId)) {
      this.outputListeners.set(agentId, []);
    }
    this.outputListeners.get(agentId)!.push(callback);

    const session = this.sessions.get(agentId);
    if (session) {
      return session.onOutput(callback);
    }
    return () => {
      const listeners = this.outputListeners.get(agentId);
      if (listeners) {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }

  /**
   * Get the underlying TerminalInfo for a claude-code session (backward compat for WebSocket).
   * Returns undefined for non-claude-code backends.
   */
  getTerminalInfo(id: string): TerminalInfo | undefined {
    const session = this.sessions.get(id);
    if (session instanceof ClaudeCodeSession) {
      return session.getTerminalSession().info;
    }
    return undefined;
  }

  /**
   * List only claude-code sessions as TerminalInfo (backward compat for WebSocket terminal:list).
   */
  listTerminals(): TerminalInfo[] {
    const result: TerminalInfo[] = [];
    for (const session of this.sessions.values()) {
      if (session instanceof ClaudeCodeSession) {
        result.push(session.getTerminalSession().info);
      }
    }
    return result;
  }
}
