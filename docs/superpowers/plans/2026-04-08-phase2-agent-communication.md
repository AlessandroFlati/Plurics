# Phase 2: Agent Communication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add peer-to-peer agent communication via filesystem-based messaging, a spawn modal with purpose editor and preset library, and a FileWatcher that injects notifications into terminals.

**Architecture:** New server modules (knowledge watcher, agent bootstrap, preset repository) integrate with the existing TerminalRegistry. The frontend gains a SpawnModal component. All inter-agent communication flows through `.caam/` files on disk, watched by chokidar.

**Tech Stack:** chokidar (file watching), better-sqlite3 (preset persistence), React modal component, existing node-pty terminal sessions.

---

## File Structure

### New files

```
packages/server/src/db/preset-repository.ts          # CRUD for agent_presets table
packages/server/src/modules/knowledge/agent-bootstrap.ts  # Creates .caam/ dirs, purpose.md, agents.md
packages/server/src/modules/knowledge/knowledge-watcher.ts # chokidar watcher + injection
packages/web/src/components/sidebar/SpawnModal.tsx     # Modal with purpose editor + preset list
packages/web/src/components/sidebar/SpawnModal.css     # Modal styles
```

### Modified files

```
packages/server/src/db/database.ts                    # Add agent_presets table creation
packages/server/src/modules/terminal/types.ts         # Add purpose/presetId to TerminalConfig
packages/server/src/modules/terminal/terminal-registry.ts # Add getByName(), onSpawn/onExit hooks
packages/server/src/transport/protocol.ts             # Add purpose/presetId to spawn message
packages/server/src/transport/websocket.ts            # Handle purpose/presetId in spawn, inject prompt
packages/server/src/app.ts                            # Wire up new modules, add preset API routes
packages/web/src/types.ts                             # Add purpose/presetId to ClientMessage spawn
packages/web/src/App.tsx                              # SpawnModal integration, pass purpose to spawn
packages/web/src/components/sidebar/TerminalManager.tsx # Open modal instead of inline spawn
packages/web/src/components/grid/EmptySlot.tsx        # Open modal instead of direct spawn
```

---

### Task 1: Preset Repository (SQLite)

**Files:**
- Modify: `packages/server/src/db/database.ts`
- Create: `packages/server/src/db/preset-repository.ts`

- [ ] **Step 1: Add agent_presets table to database.ts**

In `packages/server/src/db/database.ts`, add the table creation after the existing `workspace_agents` table creation. Find the line after `db.exec(\`CREATE TABLE IF NOT EXISTS workspace_agents`:

```typescript
  db.exec(`CREATE TABLE IF NOT EXISTS agent_presets (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    purpose TEXT NOT NULL,
    use_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
```

- [ ] **Step 2: Create preset-repository.ts**

Create `packages/server/src/db/preset-repository.ts`:

```typescript
import type Database from 'better-sqlite3';

export interface AgentPreset {
  id: number;
  name: string;
  purpose: string;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePresetInput {
  name: string;
  purpose: string;
}

export interface UpdatePresetInput {
  name?: string;
  purpose?: string;
}

export class PresetRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  list(): AgentPreset[] {
    return this.db.prepare(
      'SELECT * FROM agent_presets ORDER BY use_count DESC, updated_at DESC'
    ).all() as AgentPreset[];
  }

  getById(id: number): AgentPreset | undefined {
    return this.db.prepare('SELECT * FROM agent_presets WHERE id = ?').get(id) as AgentPreset | undefined;
  }

  create(input: CreatePresetInput): AgentPreset {
    const stmt = this.db.prepare(
      'INSERT INTO agent_presets (name, purpose, created_at, updated_at) VALUES (?, ?, datetime(\'now\'), datetime(\'now\'))'
    );
    const result = stmt.run(input.name, input.purpose);
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, input: UpdatePresetInput): void {
    const fields: string[] = ['updated_at = datetime(\'now\')'];
    const values: unknown[] = [];
    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.purpose !== undefined) { fields.push('purpose = ?'); values.push(input.purpose); }
    values.push(id);
    this.db.prepare(`UPDATE agent_presets SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM agent_presets WHERE id = ?').run(id);
  }

  incrementUseCount(id: number): void {
    this.db.prepare(
      'UPDATE agent_presets SET use_count = use_count + 1, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(id);
  }
}
```

- [ ] **Step 3: Run existing tests to verify no breakage**

Run: `npm test --workspace=packages/server`
Expected: All existing tests pass (database table creation is additive).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/database.ts packages/server/src/db/preset-repository.ts
git commit -m "feat: add agent_presets table and PresetRepository"
```

---

### Task 2: Preset API Routes

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Import PresetRepository and add routes**

In `packages/server/src/app.ts`, add import at the top alongside the existing WorkspaceRepository import:

```typescript
import { PresetRepository } from './db/preset-repository.js';
```

After the line `const workspaceRepo = new WorkspaceRepository(getDb());`, add:

```typescript
const presetRepo = new PresetRepository(getDb());
```

After the workspace routes (after `app.post('/api/workspaces/:id/select', ...)`), add:

```typescript
app.get('/api/agent-presets', (_req, res) => {
  res.json(presetRepo.list());
});

app.post('/api/agent-presets', (req, res) => {
  try {
    const preset = presetRepo.create(req.body);
    res.json(preset);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create preset' });
  }
});

app.put('/api/agent-presets/:id', (req, res) => {
  presetRepo.update(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/agent-presets/:id', (req, res) => {
  presetRepo.remove(Number(req.params.id));
  res.json({ ok: true });
});
```

- [ ] **Step 2: Verify routes work**

Run the dev server and test with curl:

```bash
npm run dev
curl -s http://localhost:11001/api/agent-presets
```

Expected: `[]`

```bash
curl -s -X POST http://localhost:11001/api/agent-presets -H "Content-Type: application/json" -d '{"name":"test","purpose":"Test purpose"}'
```

Expected: JSON object with id, name, purpose, use_count=0.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat: add preset CRUD API routes"
```

---

### Task 3: Agent Bootstrap Module

**Files:**
- Create: `packages/server/src/modules/knowledge/agent-bootstrap.ts`
- Modify: `packages/server/src/modules/terminal/types.ts`

- [ ] **Step 1: Add purpose and presetId to TerminalConfig**

In `packages/server/src/modules/terminal/types.ts`, add two optional fields to `TerminalConfig`:

```typescript
export interface TerminalConfig {
  name?: string;
  command?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  purpose?: string;
  presetId?: number;
}
```

- [ ] **Step 2: Create agent-bootstrap.ts**

Create `packages/server/src/modules/knowledge/agent-bootstrap.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

const COMMUNICATION_TEMPLATE = `
---

## Communication

To see which agents are available, read:
  .caam/shared/agents.md

To send a message to another agent, append to:
  .caam/agents/<target-name>/inbox.md

Use this format:
  ## From: <your-name> @ <timestamp>
  <message body>

Your inbox is at .caam/agents/<your-name>/inbox.md
Check it when notified.
`;

export class AgentBootstrap {
  private caamDir: string | null = null;

  setCwd(cwd: string): void {
    this.caamDir = path.join(cwd, '.caam');
  }

  getCaamDir(): string | null {
    return this.caamDir;
  }

  ensureDirectoryStructure(): void {
    if (!this.caamDir) return;
    fs.mkdirSync(path.join(this.caamDir, 'shared'), { recursive: true });
    fs.mkdirSync(path.join(this.caamDir, 'agents'), { recursive: true });
  }

  createAgentFiles(agentName: string, purpose: string): void {
    if (!this.caamDir) return;
    this.ensureDirectoryStructure();

    const agentDir = path.join(this.caamDir, 'agents', agentName);
    fs.mkdirSync(agentDir, { recursive: true });

    const fullPurpose = purpose.trim() + '\n' + COMMUNICATION_TEMPLATE;
    fs.writeFileSync(path.join(agentDir, 'purpose.md'), fullPurpose, 'utf-8');

    const inboxPath = path.join(agentDir, 'inbox.md');
    if (!fs.existsSync(inboxPath)) {
      fs.writeFileSync(inboxPath, '', 'utf-8');
    }
  }

  regenerateAgentsList(activeAgents: Array<{ name: string; purpose: string }>): void {
    if (!this.caamDir) return;
    this.ensureDirectoryStructure();

    let content = '# Active Agents\n';
    for (const agent of activeAgents) {
      const summary = agent.purpose.split('\n')[0].trim();
      content += `\n## ${agent.name}\n- **Status**: running\n- **Purpose**: ${summary}\n`;
    }

    fs.writeFileSync(path.join(this.caamDir, 'shared', 'agents.md'), content, 'utf-8');
  }

  getInjectionPrompt(agentName: string): string {
    return `Read your purpose and instructions at .caam/agents/${agentName}/purpose.md and follow them.\r`;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/terminal/types.ts packages/server/src/modules/knowledge/agent-bootstrap.ts
git commit -m "feat: add AgentBootstrap module for .caam/ directory management"
```

---

### Task 4: Wire Agent Bootstrap into Server

**Files:**
- Modify: `packages/server/src/modules/terminal/terminal-registry.ts`
- Modify: `packages/server/src/transport/protocol.ts`
- Modify: `packages/server/src/transport/websocket.ts`
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Add getByName() and purpose tracking to TerminalRegistry**

In `packages/server/src/modules/terminal/terminal-registry.ts`, add a name-to-purpose map and a getByName method. Replace the entire file:

```typescript
import { TerminalSession } from './terminal-session.js';
import type { TerminalConfig, TerminalInfo } from './types.js';

type SpawnCallback = (name: string, purpose: string) => void;
type ExitCallback = (name: string) => void;

export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly purposes = new Map<string, string>();
  private readonly spawnCallbacks = new Set<SpawnCallback>();
  private readonly exitCallbacks = new Set<ExitCallback>();

  async spawn(config: TerminalConfig): Promise<TerminalInfo> {
    const session = await TerminalSession.create(config);
    this.sessions.set(session.id, session);
    if (config.purpose) {
      this.purposes.set(session.name, config.purpose);
    }
    session.onExit(() => {
      this.sessions.delete(session.id);
      const name = session.name;
      this.purposes.delete(name);
      for (const cb of this.exitCallbacks) cb(name);
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
}
```

- [ ] **Step 2: Add purpose/presetId to protocol.ts**

In `packages/server/src/transport/protocol.ts`, update the terminal:spawn client message:

```typescript
  | { type: 'terminal:spawn'; name?: string; command?: string; cwd?: string; purpose?: string; presetId?: number }
```

- [ ] **Step 3: Update websocket.ts spawn handler to inject purpose prompt**

In `packages/server/src/transport/websocket.ts`, the `createWebSocketServer` function signature changes to accept `AgentBootstrap`:

```typescript
import type { AgentBootstrap } from '../modules/knowledge/agent-bootstrap.js';
```

Change the function signature:

```typescript
export function createWebSocketServer(
  server: http.Server,
  registry: TerminalRegistry,
  bootstrap: AgentBootstrap,
): WebSocketServer {
```

Update `handleMessage` to accept bootstrap:

```typescript
async function handleMessage(
  ws: WebSocket,
  msg: ClientMessage,
  registry: TerminalRegistry,
  cleanups: Array<() => void>,
  bootstrap: AgentBootstrap,
): Promise<void> {
```

Update the call site inside `wss.on('connection', ...)`:

```typescript
        await handleMessage(ws, msg, registry, cleanups, bootstrap);
```

In the `terminal:spawn` case, after `registry.spawn()`, add purpose file creation and prompt injection:

```typescript
    case 'terminal:spawn': {
      const info = await registry.spawn({
        name: msg.name,
        command: msg.command,
        cwd: msg.cwd,
        purpose: msg.purpose,
      });
      if (msg.purpose && msg.name) {
        bootstrap.createAgentFiles(msg.name, msg.purpose);
        bootstrap.regenerateAgentsList(registry.listWithPurpose());
        // Inject purpose prompt after a delay to let the shell start
        const session = registry.get(info.id);
        if (session) {
          setTimeout(() => {
            session.write(bootstrap.getInjectionPrompt(msg.name!));
          }, 2000);
        }
      }
      sendMessage(ws, {
        type: 'terminal:created',
        terminalId: info.id,
        name: info.name,
      });
      break;
    }
```

- [ ] **Step 4: Wire bootstrap into app.ts**

In `packages/server/src/app.ts`, add import:

```typescript
import { AgentBootstrap } from './modules/knowledge/agent-bootstrap.js';
```

After `const registry = new TerminalRegistry();`, add:

```typescript
const bootstrap = new AgentBootstrap();
```

Update `createWebSocketServer` call:

```typescript
createWebSocketServer(server, registry, bootstrap);
```

Add registry exit hook to regenerate agents.md:

```typescript
registry.onTerminalExit(() => {
  bootstrap.regenerateAgentsList(registry.listWithPurpose());
});
```

Also, expose `presetRepo` and `bootstrap` to the spawn flow. In the workspace select route, set the bootstrap cwd. Add after the `POST /api/workspaces/:id/select` route:

Actually, the cwd is set per-spawn via the WebSocket message. Update the spawn handler in websocket.ts to also call `bootstrap.setCwd()`:

In the `terminal:spawn` case in websocket.ts, before `bootstrap.createAgentFiles`:

```typescript
      if (msg.cwd) {
        bootstrap.setCwd(msg.cwd);
      }
```

For preset use_count, add `presetRepo` to the websocket server. Update `app.ts`:

```typescript
import { PresetRepository } from './db/preset-repository.js';
```

Pass presetRepo to createWebSocketServer:

```typescript
createWebSocketServer(server, registry, bootstrap, presetRepo);
```

Update `createWebSocketServer` signature in websocket.ts:

```typescript
import type { PresetRepository } from '../db/preset-repository.js';

export function createWebSocketServer(
  server: http.Server,
  registry: TerminalRegistry,
  bootstrap: AgentBootstrap,
  presetRepo: PresetRepository,
): WebSocketServer {
```

And `handleMessage`:

```typescript
async function handleMessage(
  ws: WebSocket,
  msg: ClientMessage,
  registry: TerminalRegistry,
  cleanups: Array<() => void>,
  bootstrap: AgentBootstrap,
  presetRepo: PresetRepository,
): Promise<void> {
```

Update the call site:

```typescript
        await handleMessage(ws, msg, registry, cleanups, bootstrap, presetRepo);
```

In the spawn case, after the purpose block, add preset use_count:

```typescript
      if (msg.presetId) {
        presetRepo.incrementUseCount(msg.presetId);
      }
```

- [ ] **Step 5: Verify the server starts without errors**

Run: `npm run dev:server`
Expected: `Server listening on port 11001` with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/terminal/terminal-registry.ts packages/server/src/transport/protocol.ts packages/server/src/transport/websocket.ts packages/server/src/app.ts
git commit -m "feat: wire agent bootstrap into spawn flow with purpose injection"
```

---

### Task 5: KnowledgeWatcher (chokidar)

**Files:**
- Create: `packages/server/src/modules/knowledge/knowledge-watcher.ts`
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Install chokidar**

```bash
npm install chokidar --workspace=packages/server
```

- [ ] **Step 2: Create knowledge-watcher.ts**

Create `packages/server/src/modules/knowledge/knowledge-watcher.ts`:

```typescript
import * as path from 'node:path';
import chokidar from 'chokidar';
import type { TerminalRegistry } from '../terminal/terminal-registry.js';

export class KnowledgeWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private readonly registry: TerminalRegistry;
  private cwd: string | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(registry: TerminalRegistry) {
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
    // Extract agent name from path: .../agents/<name>/inbox.md
    const normalized = filePath.replace(/\\/g, '/');
    const match = normalized.match(/agents\/([^/]+)\/inbox\.md$/);
    if (!match) return;

    const agentName = match[1];

    // Debounce per agent
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
```

- [ ] **Step 3: Wire KnowledgeWatcher into app.ts**

In `packages/server/src/app.ts`, add import:

```typescript
import { KnowledgeWatcher } from './modules/knowledge/knowledge-watcher.js';
```

After `const bootstrap = new AgentBootstrap();`, add:

```typescript
const watcher = new KnowledgeWatcher(registry);
```

The watcher needs to start when the first terminal is spawned (which sets the cwd). Add after the registry exit hook:

```typescript
registry.onSpawn((name, _purpose) => {
  const caamDir = bootstrap.getCaamDir();
  if (caamDir) {
    // caamDir is <cwd>/.caam, watcher needs <cwd>
    const cwd = path.dirname(caamDir);
    watcher.start(cwd);
  }
});
```

Note: `path` is already imported in app.ts.

- [ ] **Step 4: Verify the server starts without errors**

Run: `npm run dev:server`
Expected: `Server listening on port 11001` with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/knowledge/knowledge-watcher.ts packages/server/src/app.ts package-lock.json packages/server/package.json
git commit -m "feat: add KnowledgeWatcher with chokidar for inbox notification injection"
```

---

### Task 6: Frontend — Update Types and Protocol

**Files:**
- Modify: `packages/web/src/types.ts`

- [ ] **Step 1: Add purpose/presetId to ClientMessage spawn type**

In `packages/web/src/types.ts`, find the terminal:spawn line in `ClientMessage` and update it:

```typescript
  | { type: 'terminal:spawn'; name?: string; command?: string; cwd?: string; purpose?: string; presetId?: number }
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/types.ts
git commit -m "feat: add purpose/presetId to frontend spawn message type"
```

---

### Task 7: Frontend — SpawnModal Component

**Files:**
- Create: `packages/web/src/components/sidebar/SpawnModal.tsx`
- Create: `packages/web/src/components/sidebar/SpawnModal.css`

- [ ] **Step 1: Create SpawnModal.css**

Create `packages/web/src/components/sidebar/SpawnModal.css`:

```css
.spawn-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.spawn-modal {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  width: 720px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  font-family: var(--font-ui);
  color: var(--color-text-primary);
}

.spawn-modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
  font-weight: 600;
}

.spawn-modal-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.spawn-modal-presets {
  width: 200px;
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  flex-shrink: 0;
}

.spawn-modal-presets-title {
  padding: 12px 12px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
}

.spawn-modal-preset-item {
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  width: 100%;
  text-align: left;
  font-family: var(--font-ui);
}

.spawn-modal-preset-item:hover {
  background: var(--color-surface-2, rgba(255,255,255,0.05));
  color: var(--color-text-primary);
}

.spawn-modal-preset-item--selected {
  background: var(--color-surface-3, rgba(255,255,255,0.1));
  color: var(--color-text-primary);
}

.spawn-modal-preset-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.spawn-modal-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  gap: 12px;
  min-width: 0;
}

.spawn-modal-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.spawn-modal-input {
  background: var(--color-surface-2, rgba(255,255,255,0.05));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  padding: 8px 10px;
  font-size: 13px;
  color: var(--color-text-primary);
  font-family: var(--font-ui);
  outline: none;
}

.spawn-modal-input:focus {
  border-color: var(--color-border-focus, #007acc);
}

.spawn-modal-textarea {
  background: var(--color-surface-2, rgba(255,255,255,0.05));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  padding: 10px;
  font-size: 13px;
  color: var(--color-text-primary);
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  outline: none;
  resize: vertical;
  min-height: 200px;
  flex: 1;
  line-height: 1.5;
}

.spawn-modal-textarea:focus {
  border-color: var(--color-border-focus, #007acc);
}

.spawn-modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.spawn-modal-btn {
  padding: 6px 16px;
  border-radius: var(--radius-sm, 4px);
  font-size: 13px;
  font-family: var(--font-ui);
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: var(--color-surface-2, rgba(255,255,255,0.05));
  color: var(--color-text-primary);
}

.spawn-modal-btn:hover {
  background: var(--color-surface-3, rgba(255,255,255,0.1));
}

.spawn-modal-btn--primary {
  background: var(--color-accent, #007acc);
  border-color: var(--color-accent, #007acc);
  color: #fff;
}

.spawn-modal-btn--primary:hover {
  opacity: 0.9;
}

.spawn-modal-btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spawn-modal-btn--save {
  margin-right: auto;
}
```

- [ ] **Step 2: Create SpawnModal.tsx**

Create `packages/web/src/components/sidebar/SpawnModal.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import './SpawnModal.css';

interface AgentPreset {
  id: number;
  name: string;
  purpose: string;
  use_count: number;
}

interface SpawnModalProps {
  onSpawn: (name: string, purpose: string, presetId?: number) => void;
  onClose: () => void;
}

export function SpawnModal({ onSpawn, onClose }: SpawnModalProps) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/agent-presets')
      .then(r => r.json())
      .then(setPresets)
      .catch(() => {});
  }, []);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  function handlePresetClick(preset: AgentPreset) {
    setName(preset.name);
    setPurpose(preset.purpose);
    setSelectedPresetId(preset.id);
  }

  function handleSpawn() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSpawn(trimmedName, purpose.trim(), selectedPresetId ?? undefined);
  }

  async function handleSavePreset() {
    const trimmedName = name.trim();
    const trimmedPurpose = purpose.trim();
    if (!trimmedName || !trimmedPurpose) return;

    const existing = presets.find(p => p.name === trimmedName);
    if (existing) {
      await fetch(`/api/agent-presets/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: trimmedPurpose }),
      });
    } else {
      await fetch('/api/agent-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, purpose: trimmedPurpose }),
      });
    }

    const updated = await fetch('/api/agent-presets').then(r => r.json());
    setPresets(updated);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSpawn();
    }
  }

  return (
    <div className="spawn-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spawn-modal" onKeyDown={handleKeyDown}>
        <div className="spawn-modal-header">Spawn Agent</div>
        <div className="spawn-modal-body">
          <div className="spawn-modal-presets">
            <div className="spawn-modal-presets-title">Presets</div>
            {presets.length === 0 && (
              <div className="spawn-modal-preset-empty">No presets saved yet</div>
            )}
            {presets.map(p => (
              <button
                key={p.id}
                className={'spawn-modal-preset-item' + (selectedPresetId === p.id ? ' spawn-modal-preset-item--selected' : '')}
                onClick={() => handlePresetClick(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="spawn-modal-form">
            <label className="spawn-modal-label">Agent Name</label>
            <input
              ref={nameRef}
              type="text"
              className="spawn-modal-input"
              value={name}
              onChange={e => { setName(e.target.value); setSelectedPresetId(null); }}
              placeholder="e.g. code-reviewer"
            />
            <label className="spawn-modal-label">Purpose (purpose.md)</label>
            <textarea
              className="spawn-modal-textarea"
              value={purpose}
              onChange={e => { setPurpose(e.target.value); setSelectedPresetId(null); }}
              placeholder="Describe this agent's role, responsibilities, and instructions..."
            />
          </div>
        </div>
        <div className="spawn-modal-footer">
          <button
            className="spawn-modal-btn spawn-modal-btn--save"
            onClick={handleSavePreset}
            disabled={!name.trim() || !purpose.trim()}
          >
            Save as Preset
          </button>
          <button className="spawn-modal-btn" onClick={onClose}>Cancel</button>
          <button
            className="spawn-modal-btn spawn-modal-btn--primary"
            onClick={handleSpawn}
            disabled={!name.trim()}
          >
            Spawn
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/sidebar/SpawnModal.tsx packages/web/src/components/sidebar/SpawnModal.css
git commit -m "feat: add SpawnModal component with purpose editor and preset quicklist"
```

---

### Task 8: Frontend — Integrate SpawnModal into App

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/sidebar/TerminalManager.tsx`
- Modify: `packages/web/src/components/grid/EmptySlot.tsx`

- [ ] **Step 1: Update App.tsx to use SpawnModal**

In `packages/web/src/App.tsx`, add import:

```typescript
import { SpawnModal } from './components/sidebar/SpawnModal';
```

Add state for the modal after the existing `cwd` state:

```typescript
  const [showSpawnModal, setShowSpawnModal] = useState(false);
```

Replace the existing `handleSpawn` and `spawnNewTerminal` functions:

```typescript
  function handleSpawn(name: string, spawnCwd: string) {
    setCwd(spawnCwd);
  }

  function openSpawnModal() {
    if (!cwd) return;
    setShowSpawnModal(true);
  }

  function handleModalSpawn(name: string, purpose: string, presetId?: number) {
    if (!cwd) return;
    setShowSpawnModal(false);
    wsRef.current?.send({ type: 'terminal:spawn', name, cwd, purpose: purpose || undefined, presetId });
  }
```

Update `handleSpawnInSlot` to open the modal:

```typescript
  function handleSpawnInSlot(_leafPath: string) {
    openSpawnModal();
  }
```

Update `handleSplitH` and `handleSplitV` to open the modal instead of auto-spawning:

```typescript
  function handleSplitH(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'horizontal'));
    openSpawnModal();
  }

  function handleSplitV(terminalId: string) {
    setLayout(prev => splitLeaf(prev, terminalId, 'vertical'));
    openSpawnModal();
  }
```

In the return JSX, add the modal before the closing `</div>`:

```tsx
      {showSpawnModal && (
        <SpawnModal
          onSpawn={handleModalSpawn}
          onClose={() => setShowSpawnModal(false)}
        />
      )}
```

- [ ] **Step 2: Update TerminalManager to open modal**

In `packages/web/src/components/sidebar/TerminalManager.tsx`, change the props interface:

```typescript
interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name: string, cwd: string) => void;
  onOpenSpawnModal: () => void;
  onKill: (id: string) => void;
  onPresetSelect: (label: string, cols: number, rows: number) => void;
}
```

Update the destructuring:

```typescript
export function TerminalManager({ terminals, onSpawn, onOpenSpawnModal, onKill, onPresetSelect: _onPresetSelect }: TerminalManagerProps) {
```

Replace the spawn section (the input + spawn button) with just a button that opens the modal. Remove `newName` state and `handleSpawn`/`handleKeyDown` functions. Replace the spawn div:

```tsx
      <div className={'terminal-manager-spawn' + (activeCwd ? '' : ' terminal-manager-spawn--disabled')}>
        <button onClick={onOpenSpawnModal} className="terminal-manager-btn" disabled={!activeCwd} style={{ width: '100%' }}>
          Spawn Agent
        </button>
      </div>
```

- [ ] **Step 3: Update App.tsx TerminalManager props**

In the App.tsx return JSX, update the TerminalManager component:

```tsx
      <TerminalManager
        terminals={terminals}
        onSpawn={handleSpawn}
        onOpenSpawnModal={openSpawnModal}
        onKill={handleKill}
        onPresetSelect={handlePresetSelect}
      />
```

- [ ] **Step 4: Verify everything compiles with hot reload**

Check the Vite terminal output for compilation errors.
Expected: HMR updates with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/sidebar/TerminalManager.tsx
git commit -m "feat: integrate SpawnModal into app, sidebar, and empty slots"
```

---

### Task 9: End-to-End Verification

**Files:** None (manual testing)

- [ ] **Step 1: Start the dev server**

```bash
npx kill-port 11000 11001 2>/dev/null; npm run dev
```

- [ ] **Step 2: Test preset CRUD**

Open http://localhost:11000. Set workspace to `C:\Users\aless\PycharmProjects\`. Click "Spawn Agent". In the modal:
- Type name: `test-agent`, purpose: `Test agent for verification`
- Click "Save as Preset"
- Verify preset appears in the left list
- Click "Cancel"

- [ ] **Step 3: Test agent spawn with purpose**

Click "Spawn Agent" again. Select the `test-agent` preset. Click "Spawn".
- Verify terminal appears in grid
- Verify `.caam/agents/test-agent/purpose.md` exists with purpose content + communication section
- Verify `.caam/agents/test-agent/inbox.md` exists (empty)
- Verify `.caam/shared/agents.md` lists the agent

- [ ] **Step 4: Test inbox notification**

Spawn a second agent. In the first agent's terminal, write to the second agent's inbox:
```
echo "## From: test-agent @ 2026-04-08" >> .caam/agents/second-agent/inbox.md
```
Verify the second terminal receives the `[CAAM] New message in your inbox` injection.

- [ ] **Step 5: Test agent exit**

Close a pane. Verify:
- Terminal removed from sidebar
- `.caam/shared/agents.md` no longer lists that agent

- [ ] **Step 6: Commit any fixes**

If any fixes were needed, commit them.

```bash
git add -A
git commit -m "fix: end-to-end verification fixes"
```
