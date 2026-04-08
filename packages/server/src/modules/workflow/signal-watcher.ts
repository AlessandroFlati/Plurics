import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import chokidar from 'chokidar';
import type { SignalFile } from './types.js';
import { validateSignalSchema } from './signal-validator.js';
import { sleep } from './utils.js';

type SignalCallback = (signal: SignalFile, filename: string) => void;
type ErrorCallback = (type: string, filename: string) => void;

export class SignalWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private processedSignals = new Set<string>();
  private onError: ErrorCallback | null = null;

  start(workspacePath: string, onSignal: SignalCallback): void {
    this.stop();
    const signalsDir = path.join(workspacePath, '.caam', 'shared', 'signals');

    this.watcher = chokidar.watch(path.join(signalsDir, '*.done.json'), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on('add', async (filepath: string) => {
      await this.handleSignalFile(filepath, onSignal);
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.processedSignals.clear();
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
      signal = JSON.parse(raw!);
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
