import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { AgentRegistry } from '../terminal/agent-registry.js';

export class KnowledgeWatcher {
  private watcher: FSWatcher | null = null;
  private readonly registry: AgentRegistry;
  private cwd: string | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  start(cwd: string): void {
    if (this.cwd === cwd && this.watcher) return;
    this.stop();
    this.cwd = cwd;

    const watchPath = path.join(cwd, '.caam', 'agents');
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
      this.injectNotification(agentName);
    }, 300));
  }

  private injectNotification(agentName: string): void {
    const session = this.registry.getByName(agentName);
    if (!session || session.info.status !== 'running') return;

    session.write(`\r\n[CAAM] New message in your inbox. Read .caam/agents/${agentName}/inbox.md\r\n`);
  }
}
