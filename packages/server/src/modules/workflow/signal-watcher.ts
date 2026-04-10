import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import type { SignalFile } from './types.js';
import { validateSignalSchema } from './signal-validator.js';
import { sleep, normalizeAgentSignal } from './utils.js';

type SignalCallback = (signal: SignalFile, filename: string) => void;
type ErrorCallback = (type: string, filename: string) => void;

export class SignalWatcher {
  private watcher: FSWatcher | null = null;
  private processedSignals = new Set<string>();
  private onError: ErrorCallback | null = null;

  start(workspacePath: string, onSignal: SignalCallback): void {
    const signalsDir = path.join(workspacePath, '.plurics', 'shared', 'signals');
    this.startDir(signalsDir, onSignal);
  }

  startDir(signalsDir: string, onSignal: SignalCallback): void {
    this.stop();

    this.watcher = chokidar.watch(path.join(signalsDir, '*.done.json'), {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on('add', async (filepath: string) => {
      await this.handleSignalFile(filepath, onSignal);
    });

    this.watcher.on('change', async (filepath: string) => {
      await this.handleSignalFile(filepath, onSignal);
    });
  }

  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private pollDir: string | null = null;
  private pollCallback: SignalCallback | null = null;

  startRecursive(rootDir: string, onSignal: SignalCallback): void {
    this.stop();
    this.pollDir = rootDir;
    this.pollCallback = onSignal;

    // Use polling as primary mechanism (chokidar + recursive globs unreliable on Windows)
    this.pollInterval = setInterval(() => {
      this.pollForSignals();
    }, 2000);

    // Also try chokidar as a fast-path
    try {
      this.watcher = chokidar.watch(path.join(rootDir, '**', '*.done.json'), {
        ignoreInitial: false,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        followSymlinks: true,
        usePolling: true,
        interval: 1000,
      });

      this.watcher.on('add', async (filepath: string) => {
        await this.handleSignalFile(filepath, onSignal);
      });

      this.watcher.on('change', async (filepath: string) => {
        await this.handleSignalFile(filepath, onSignal);
      });
    } catch {
      // Chokidar may fail; polling will handle it
    }
  }

  private async pollForSignals(): Promise<void> {
    if (!this.pollDir || !this.pollCallback) return;
    try {
      await this.scanDirForSignals(this.pollDir, this.pollCallback);
    } catch { /* directory may not exist yet */ }
  }

  private async scanDirForSignals(dir: string, onSignal: SignalCallback): Promise<void> {
    const { readdir, stat } = await import('node:fs/promises');
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanDirForSignals(fullPath, onSignal);
      } else if (entry.name.endsWith('.done.json')) {
        await this.handleSignalFile(fullPath, onSignal);
      }
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.pollDir = null;
    this.pollCallback = null;
    this.processedSignals.clear();
  }

  /** Pre-populate processed signals from a previous run (for resume). */
  prePopulate(signalIds: Set<string>): void {
    for (const id of signalIds) {
      this.processedSignals.add(id);
    }
  }

  setErrorHandler(handler: ErrorCallback): void {
    this.onError = handler;
  }

  private async handleSignalFile(filepath: string, onSignal: SignalCallback): Promise<void> {
    const filename = path.basename(filepath);

    if (filename.endsWith('.tmp')) return;

    let raw: string | undefined;
    for (const delay of [0, 200, 500, 1000]) {
      if (delay > 0) await sleep(delay);
      try {
        raw = await fs.readFile(filepath, 'utf-8');
        break;
      } catch {
        if (delay === 1000) {
          this.emitError('signal_read_failed', filename);
          return;
        }
      }
    }

    let signal: unknown;
    try {
      const parsed = JSON.parse(raw!);
      // Normalize LLM output before schema validation (aliases, paths, etc.)
      signal = (typeof parsed === 'object' && parsed !== null)
        ? normalizeAgentSignal(parsed as Record<string, unknown>)
        : parsed;
    } catch {
      this.emitError('signal_parse_failed', filename);
      return;
    }

    if (!validateSignalSchema(signal)) {
      this.emitError('signal_schema_invalid', filename);
      return;
    }

    const validated = signal as SignalFile;
    if (this.processedSignals.has(validated.signal_id)) return;
    this.processedSignals.add(validated.signal_id);

    onSignal(validated, filename);
  }

  private emitError(type: string, filename: string): void {
    if (this.onError) {
      this.onError(type, filename);
    }
  }
}
