import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

export class KnowledgeWatcher {
  private watcher: FSWatcher | null = null;
  private cwd: string | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  start(cwd: string): void {
    if (this.cwd === cwd && this.watcher) return;
    this.stop();
    this.cwd = cwd;

    const watchPath = path.join(cwd, '.plurics', 'agents');
    this.watcher = chokidar.watch(path.join(watchPath, '**', 'inbox.md'), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on('change', (filePath: string) => {
      this.handleInboxChange(filePath);
    });

    this.watcher.on('add', (filePath: string) => {
      this.handleInboxChange(filePath);
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.cwd = null;
  }

  private handleInboxChange(filePath: string): void {
    const normalized = filePath.replace(/\\/g, '/');
    const match = normalized.match(/agents\/([^/]+)\/inbox\.md$/);
    if (!match) return;

    const agentName = match[1];

    const existing = this.debounceTimers.get(agentName);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(agentName, setTimeout(() => {
      this.debounceTimers.delete(agentName);
      // Inbox notification — no-op: PTY agent injection removed with legacy backends.
      void agentName;
    }, 300));
  }
}
