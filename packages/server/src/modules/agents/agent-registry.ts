/**
 * AgentRegistry — manages all agent backends (claude-code, process, local-llm).
 */

import type { LegacyAgentBackend, AgentConfig, AgentInfo } from './agent-backend.js';
import { ClaudeCodeSession } from './claude-code-session.js';
import { ProcessSession } from './process-session.js';
import { LocalLlmSession } from './local-llm-session.js';
import type { AgentBackend as NewAgentBackend, NewBackendType } from './agent-backend.js';
import { ClaudeBackend } from './claude-backend.js';
import { OpenAICompatBackend } from './openai-compat-backend.js';
import { OllamaBackend } from './ollama-backend.js';
import type { ClaudeBackendConfig } from './claude-backend.js';
import type { OpenAICompatBackendConfig } from './openai-compat-backend.js';
import type { OllamaBackendConfig } from './ollama-backend.js';

export type NewBackendConfig =
  | { type: 'claude'; config: ClaudeBackendConfig }
  | { type: 'openai-compat'; config: OpenAICompatBackendConfig }
  | { type: 'ollama'; config: OllamaBackendConfig };

type SpawnCallback = (name: string, purpose: string) => void;
type ExitCallback = (name: string) => void;

export class AgentRegistry {
  private readonly sessions = new Map<string, LegacyAgentBackend>();
  private readonly purposes = new Map<string, string>();
  private readonly spawnCallbacks = new Set<SpawnCallback>();
  private readonly exitCallbacks = new Set<ExitCallback>();
  private readonly perAgentExitCallbacks = new Map<string, Array<() => void>>();

  /** Spawn an agent using the appropriate backend for its type. */
  async spawn(config: AgentConfig): Promise<AgentInfo> {
    const backend = await this.createBackend(config);

    this.sessions.set(backend.id, backend);
    if (config.purpose) {
      this.purposes.set(backend.name, config.purpose);
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

    for (const cb of this.spawnCallbacks) cb(backend.name, config.purpose);
    return backend.info;
  }

  private async createBackend(config: AgentConfig): Promise<LegacyAgentBackend> {
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

  get(id: string): LegacyAgentBackend | undefined {
    return this.sessions.get(id);
  }

  getByName(name: string): LegacyAgentBackend | undefined {
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

  /**
   * Factory for new conversation-oriented backends (Phase 1+).
   * These backends are not tracked in the sessions Map — they are short-lived
   * per-conversation objects managed by the DAG executor node lifecycle.
   */
  createNewBackend(spec: NewBackendConfig): NewAgentBackend {
    switch (spec.type) {
      case 'claude':
        return new ClaudeBackend(spec.config);
      case 'openai-compat':
        return new OpenAICompatBackend(spec.config);
      case 'ollama':
        return new OllamaBackend(spec.config);
      default: {
        const _exhaustive: never = spec;
        throw new Error(`Unknown new backend type: ${(_exhaustive as NewBackendConfig).type}`);
      }
    }
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

}
