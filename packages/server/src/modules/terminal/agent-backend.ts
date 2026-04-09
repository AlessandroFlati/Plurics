/**
 * AgentBackend — unified interface for all agent execution backends.
 *
 * Three implementations:
 * - ClaudeCodeBackend: wraps TerminalSession (node-pty → claude CLI)
 * - ProcessBackend: child_process for deterministic scripts (Lean, Python)
 * - LocalLlmBackend: HTTP to OpenAI-compatible API (vLLM, llama.cpp)
 */

export type BackendType = 'claude-code' | 'process' | 'local-llm';

export interface AgentConfig {
  name: string;
  cwd: string;
  purpose: string;
  backend: BackendType;

  // claude-code specific
  command?: string;          // e.g. 'claude --dangerously-skip-permissions --model claude-opus-4-6'
  effort?: 'low' | 'medium' | 'high';

  // process specific
  processCommand?: string[]; // e.g. ['python', '-m', 'ohlc_fetcher']
  workingDir?: string;       // override cwd for the process
  env?: Record<string, string>;

  // local-llm specific
  endpoint?: string;         // e.g. 'http://localhost:8000/v1'
  model?: string;            // e.g. 'Goedel-LM/Goedel-Prover-V2-8B'
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;     // injected as system message
}

export interface AgentResult {
  success: boolean;
  output: string;            // stdout or LLM completion
  error: string | null;      // stderr or error message
  exitCode: number | null;   // for process backend
  durationMs: number;
  artifacts: AgentArtifact[];
}

export interface AgentArtifact {
  path: string;
  type: 'json' | 'lean' | 'python' | 'markdown' | 'binary';
}

export interface AgentInfo {
  id: string;
  name: string;
  backendType: BackendType;
  status: 'running' | 'exited';
  createdAt: number;
}

export interface AgentBackend {
  readonly id: string;
  readonly name: string;
  readonly backendType: BackendType;
  readonly info: AgentInfo;

  /** Start the agent with the given config. */
  start(): Promise<void>;

  /** Stop the agent (kill process, close connection). */
  stop(): Promise<void>;

  /** Check if the agent is still running. */
  isAlive(): boolean;

  /** Inject content (purpose prompt for claude-code, prompt for local-llm, stdin for process). */
  inject(content: string): Promise<void>;

  /** Subscribe to output data (terminal output, stdout, LLM tokens). */
  onOutput(callback: (data: string) => void): () => void;

  /** Subscribe to exit event. */
  onExit(callback: () => void): () => void;

  /** Resize (only meaningful for claude-code PTY backend). */
  resize(cols: number, rows: number): Promise<void>;

  /** Write raw data (only meaningful for claude-code PTY backend). */
  write(data: string): void;

  /**
   * Get the result after completion (for process/local-llm backends).
   * Claude-code backends return null (they write signal files directly).
   */
  getResult(): AgentResult | null;
}
