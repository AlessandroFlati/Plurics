/**
 * ProcessSession — AgentBackend for deterministic child processes.
 * Used for: Lean compiler (lake build), Python scripts, OHLC fetcher, backtester.
 *
 * The process receives its purpose via a temp file (not stdin), runs to completion,
 * and the result is derived from exit code + stdout/stderr.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentBackend, AgentConfig, AgentInfo, AgentResult, BackendType } from './agent-backend.js';

type DataCallback = (data: string) => void;
type ExitCallback = () => void;

export class ProcessSession implements AgentBackend {
  readonly id: string;
  readonly name: string;
  readonly backendType: BackendType = 'process';

  private config: AgentConfig;
  private process: ChildProcess | null = null;
  private status: 'running' | 'exited' = 'running';
  private readonly createdAt: number;
  private readonly outputListeners = new Set<DataCallback>();
  private readonly exitListeners = new Set<ExitCallback>();
  private stdout = '';
  private stderr = '';
  private exitCode: number | null = null;
  private startTime = 0;

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
    const cmd = this.config.processCommand;
    if (!cmd || cmd.length === 0) {
      throw new Error(`ProcessSession ${this.name}: no command specified`);
    }

    const cwd = this.config.workingDir ?? this.config.cwd;

    // Write purpose to a temp file the process can read
    const purposePath = path.join(cwd, `.plurics-purpose-${this.id}.md`);
    await fs.writeFile(purposePath, this.config.purpose, 'utf-8');

    const env = {
      ...process.env,
      ...this.config.env,
      PLURICS_PURPOSE_FILE: purposePath,
      PLURICS_AGENT_NAME: this.name,
      PLURICS_WORKSPACE: this.config.cwd,
      // Legacy aliases for scripts still using CAAM_* names
      CAAM_PURPOSE_FILE: purposePath,
      CAAM_AGENT_NAME: this.name,
      CAAM_WORKSPACE: this.config.cwd,
    };

    this.startTime = Date.now();

    this.process = spawn(cmd[0], cmd.slice(1), {
      cwd,
      env: env as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      const str = data.toString();
      this.stdout += str;
      for (const cb of this.outputListeners) cb(str);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const str = data.toString();
      this.stderr += str;
      for (const cb of this.outputListeners) cb(`[stderr] ${str}`);
    });

    this.process.on('exit', (code) => {
      this.exitCode = code;
      this.status = 'exited';
      // Clean up purpose file
      fs.unlink(purposePath).catch(() => {});
      for (const cb of this.exitListeners) cb();
    });

    this.process.on('error', (err) => {
      this.stderr += `\nProcess error: ${err.message}`;
      this.status = 'exited';
      for (const cb of this.exitListeners) cb();
    });
  }

  async stop(): Promise<void> {
    if (this.process && this.status === 'running') {
      this.process.kill('SIGTERM');
      // Force kill after 5s
      setTimeout(() => {
        if (this.status === 'running') {
          this.process?.kill('SIGKILL');
        }
      }, 5000);
    }
    this.status = 'exited';
  }

  isAlive(): boolean {
    return this.status === 'running';
  }

  async inject(content: string): Promise<void> {
    // For process backend, inject writes to stdin
    if (this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(content);
      this.process.stdin.end();
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
    // No-op for process backend
  }

  write(data: string): void {
    if (this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(data);
    }
  }

  getResult(): AgentResult | null {
    if (this.status !== 'exited') return null;
    return {
      success: this.exitCode === 0,
      output: this.stdout,
      error: this.stderr || null,
      exitCode: this.exitCode,
      durationMs: Date.now() - this.startTime,
      artifacts: [],
    };
  }
}
