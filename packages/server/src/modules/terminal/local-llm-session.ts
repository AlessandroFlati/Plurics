/**
 * LocalLlmSession — AgentBackend for local LLMs via OpenAI-compatible HTTP API.
 * Used for: Goedel-Prover-V2-8B on vLLM, or any model served with OpenAI API format.
 *
 * The session sends the purpose as a prompt, receives the completion,
 * and packages the result for the DAG executor.
 */

import { v4 as uuidv4 } from 'uuid';
import type { AgentBackend, AgentConfig, AgentInfo, AgentResult, BackendType } from './agent-backend.js';

type DataCallback = (data: string) => void;
type ExitCallback = () => void;

export class LocalLlmSession implements AgentBackend {
  readonly id: string;
  readonly name: string;
  readonly backendType: BackendType = 'local-llm';

  private config: AgentConfig;
  private status: 'running' | 'exited' = 'running';
  private readonly createdAt: number;
  private readonly outputListeners = new Set<DataCallback>();
  private readonly exitListeners = new Set<ExitCallback>();
  private result: AgentResult | null = null;
  private abortController: AbortController | null = null;

  constructor(config: AgentConfig) {
    this.id = uuidv4();
    this.name = config.name;
    this.config = config;
    this.createdAt = Date.now();
  }

  get info(): AgentInfo {
    return {
      id: this.id,
      name: this.name,
      backendType: this.backendType,
      status: this.status,
      createdAt: this.createdAt,
    };
  }

  async start(): Promise<void> {
    // The actual LLM call happens when inject() is called with the purpose
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    this.status = 'exited';
    for (const cb of this.exitListeners) cb();
  }

  isAlive(): boolean {
    return this.status === 'running';
  }

  async inject(content: string): Promise<void> {
    const endpoint = this.config.endpoint;
    if (!endpoint) throw new Error(`LocalLlmSession ${this.name}: no endpoint specified`);

    const startTime = Date.now();
    this.abortController = new AbortController();

    try {
      const messages: Array<{ role: string; content: string }> = [];

      if (this.config.systemPrompt) {
        messages.push({ role: 'system', content: this.config.systemPrompt });
      }
      messages.push({ role: 'user', content });

      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model ?? 'default',
          messages,
          max_tokens: this.config.maxTokens ?? 16384,
          temperature: this.config.temperature ?? 0.0,
          stream: false,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error ${response.status}: ${errorText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string }; finish_reason: string }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      const completion = data.choices?.[0]?.message?.content ?? '';
      const finishReason = data.choices?.[0]?.finish_reason ?? 'unknown';

      // Stream the completion to output listeners
      for (const cb of this.outputListeners) cb(completion);

      this.result = {
        success: true,
        output: completion,
        error: null,
        exitCode: 0,
        durationMs: Date.now() - startTime,
        artifacts: [],
      };

      // Log usage if available
      if (data.usage) {
        const usage = `[tokens] prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens}, finish: ${finishReason}`;
        for (const cb of this.outputListeners) cb(`\n${usage}\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.result = {
        success: false,
        output: '',
        error: message,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        artifacts: [],
      };
      for (const cb of this.outputListeners) cb(`[error] ${message}\n`);
    } finally {
      this.status = 'exited';
      this.abortController = null;
      for (const cb of this.exitListeners) cb();
    }
  }

  onOutput(callback: DataCallback): () => void {
    this.outputListeners.add(callback);
    return () => this.outputListeners.delete(callback);
  }

  onExit(callback: ExitCallback): () => void {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }

  async resize(_cols: number, _rows: number): Promise<void> {
    // No-op
  }

  write(_data: string): void {
    // No-op — use inject() instead
  }

  getResult(): AgentResult | null {
    return this.result;
  }
}
