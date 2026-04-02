# Phase 1: Terminal Grid MVP -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based terminal grid that can spawn, attach to, and interact with multiple Claude Code sessions running in tmux, with real-time WebSocket I/O.

**Architecture:** Monorepo with two packages (`server` and `web`). The server manages tmux sessions and relays I/O over a single multiplexed WebSocket. The React frontend renders terminals using xterm.js in a resizable grid layout.

**Tech Stack:** Node.js + TypeScript, Express, ws (WebSocket), React, xterm.js, react-grid-layout, tmux

---

## File Structure

```
packages/
  server/
    package.json
    tsconfig.json
    src/
      app.ts                           # Entry point, wires modules + transport
      modules/
        terminal/
          types.ts                     # TerminalInfo, TerminalStatus, config types
          tmux-manager.ts              # Wraps tmux CLI: create, list, send-keys, kill
          terminal-session.ts          # Single session: I/O relay, resize, metadata
          terminal-registry.ts         # Registry of all sessions, discovery
          __tests__/
            tmux-manager.test.ts
            terminal-session.test.ts
            terminal-registry.test.ts
      transport/
        websocket.ts                   # WebSocket server, message routing
        protocol.ts                    # Message type definitions
        __tests__/
          websocket.test.ts
  web/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx                         # React entry
      App.tsx                          # Top-level layout
      components/
        terminal/
          TerminalPane.tsx             # xterm.js wrapper + header bar
          TerminalPane.css
        grid/
          TerminalGrid.tsx             # react-grid-layout grid
          TerminalGrid.css
          LayoutPresets.tsx            # Preset layout buttons
        sidebar/
          TerminalManager.tsx          # Spawn/attach/list panel
          TerminalManager.css
      services/
        websocket-client.ts           # WebSocket connection, message send/receive
      stores/
        terminal-store.ts             # Terminal state management
      types.ts                        # Shared frontend types
```

---

### Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json` (root)
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json with workspaces**

```json
{
  "name": "claude-agent-auto-manager",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:server": "npm run dev --workspace=packages/server",
    "dev:web": "npm run dev --workspace=packages/web",
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:web\"",
    "test": "npm run test --workspace=packages/server",
    "build": "npm run build --workspaces"
  }
}
```

- [ ] **Step 2: Create server package.json**

```json
{
  "name": "@caam/server",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.12",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create server tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create web package.json**

```json
{
  "name": "@caam/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "xterm": "^5.3.0",
    "@xterm/addon-fit": "^0.10.0",
    "react-grid-layout": "^1.4.4"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/react-grid-layout": "^1.3.5",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 5: Create web tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
});
```

- [ ] **Step 7: Create web/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Agent Auto Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Update .gitignore**

```
node_modules/
dist/
.idea/
*.tsbuildinfo
```

- [ ] **Step 9: Install dependencies**

Run: `cd /mnt/c/Users/aless/PycharmProjects/ClaudeAgentAutoManager && npm install && npx concurrently --version`
Expected: Successful install, concurrently version printed.

Note: also `npm install -D concurrently` at root level.

Run: `npm install -D concurrently`

- [ ] **Step 10: Commit**

```bash
git add package.json packages/ .gitignore
git commit -m "feat: scaffold monorepo with server and web packages"
```

---

### Task 2: Protocol Types (Shared Message Definitions)

**Files:**
- Create: `packages/server/src/transport/protocol.ts`
- Create: `packages/server/src/modules/terminal/types.ts`

- [ ] **Step 1: Create terminal types**

```typescript
// packages/server/src/modules/terminal/types.ts

export interface TerminalInfo {
  id: string;
  name: string;
  tmuxSession: string;
  status: TerminalStatus;
  createdAt: number;
  cols: number;
  rows: number;
}

export type TerminalStatus = 'running' | 'exited';

export interface TerminalConfig {
  name?: string;
  command?: string;
  cols?: number;
  rows?: number;
}

export const DEFAULT_COMMAND = 'claude --dangerously-skip-permissions';
export const TMUX_PREFIX = 'caam-';
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 30;
```

- [ ] **Step 2: Create protocol types**

```typescript
// packages/server/src/transport/protocol.ts

export type ClientMessage =
  | { type: 'terminal:input'; terminalId: string; data: string }
  | { type: 'terminal:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal:spawn'; name?: string; command?: string }
  | { type: 'terminal:attach'; tmuxSessionName: string }
  | { type: 'terminal:kill'; terminalId: string }
  | { type: 'terminal:list' };

export type ServerMessage =
  | { type: 'terminal:output'; terminalId: string; data: string }
  | { type: 'terminal:created'; terminalId: string; name: string }
  | { type: 'terminal:exited'; terminalId: string; exitCode: number }
  | { type: 'terminal:list'; terminals: import('../modules/terminal/types.js').TerminalInfo[] }
  | { type: 'error'; message: string };
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/
git commit -m "feat: add terminal types and WebSocket protocol definitions"
```

---

### Task 3: TmuxManager

**Files:**
- Create: `packages/server/src/modules/terminal/tmux-manager.ts`
- Create: `packages/server/src/modules/terminal/__tests__/tmux-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/server/src/modules/terminal/__tests__/tmux-manager.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import { TmuxManager } from '../tmux-manager.js';
import { TMUX_PREFIX } from '../types.js';

const tmux = new TmuxManager();

// Helper to clean up test sessions
async function killTestSessions() {
  const sessions = await tmux.listSessions();
  for (const name of sessions) {
    await tmux.killSession(name);
  }
}

describe('TmuxManager', () => {
  afterEach(async () => {
    await killTestSessions();
  });

  it('creates a tmux session with the caam- prefix', async () => {
    const name = await tmux.createSession('test-session', 'bash', 80, 24);
    expect(name).toBe(`${TMUX_PREFIX}test-session`);
    const sessions = await tmux.listSessions();
    expect(sessions).toContain(`${TMUX_PREFIX}test-session`);
  });

  it('lists only caam- prefixed sessions', async () => {
    await tmux.createSession('list-test', 'bash', 80, 24);
    const sessions = await tmux.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    for (const s of sessions) {
      expect(s.startsWith(TMUX_PREFIX)).toBe(true);
    }
  });

  it('kills a session', async () => {
    await tmux.createSession('kill-test', 'bash', 80, 24);
    await tmux.killSession(`${TMUX_PREFIX}kill-test`);
    const sessions = await tmux.listSessions();
    expect(sessions).not.toContain(`${TMUX_PREFIX}kill-test`);
  });

  it('sends keys to a session', async () => {
    await tmux.createSession('keys-test', 'bash', 80, 24);
    // Should not throw
    await tmux.sendKeys(`${TMUX_PREFIX}keys-test`, 'echo hello\n');
  });

  it('captures pane content', async () => {
    await tmux.createSession('capture-test', 'bash', 80, 24);
    await tmux.sendKeys(`${TMUX_PREFIX}capture-test`, 'echo TESTMARKER\n');
    // Give bash a moment to process
    await new Promise(r => setTimeout(r, 500));
    const content = await tmux.capturePane(`${TMUX_PREFIX}capture-test`);
    expect(content).toContain('TESTMARKER');
  });

  it('throws when killing a non-existent session', async () => {
    await expect(tmux.killSession(`${TMUX_PREFIX}nonexistent-${Date.now()}`))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/aless/PycharmProjects/ClaudeAgentAutoManager && npx vitest run --workspace packages/server 2>&1 | tail -20`
Expected: FAIL -- cannot find module `../tmux-manager.js`

- [ ] **Step 3: Implement TmuxManager**

```typescript
// packages/server/src/modules/terminal/tmux-manager.ts

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TMUX_PREFIX } from './types.js';

const execFileAsync = promisify(execFile);

export class TmuxManager {
  async createSession(name: string, command: string, cols: number, rows: number): Promise<string> {
    const sessionName = `${TMUX_PREFIX}${name}`;
    await execFileAsync('tmux', [
      'new-session',
      '-d',
      '-s', sessionName,
      '-x', String(cols),
      '-y', String(rows),
      command,
    ]);
    return sessionName;
  }

  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('tmux', [
        'list-sessions',
        '-F', '#{session_name}',
      ]);
      return stdout
        .trim()
        .split('\n')
        .filter(name => name.startsWith(TMUX_PREFIX));
    } catch {
      // tmux returns error when no sessions exist
      return [];
    }
  }

  async killSession(sessionName: string): Promise<void> {
    await execFileAsync('tmux', ['kill-session', '-t', sessionName]);
  }

  async sendKeys(sessionName: string, keys: string): Promise<void> {
    await execFileAsync('tmux', ['send-keys', '-t', sessionName, '-l', keys]);
  }

  async capturePane(sessionName: string, lines = 1000): Promise<string> {
    const { stdout } = await execFileAsync('tmux', [
      'capture-pane',
      '-t', sessionName,
      '-p',
      '-S', String(-lines),
    ]);
    return stdout;
  }

  async resizePane(sessionName: string, cols: number, rows: number): Promise<void> {
    await execFileAsync('tmux', [
      'resize-window',
      '-t', sessionName,
      '-x', String(cols),
      '-y', String(rows),
    ]);
  }

  async hasSession(sessionName: string): Promise<boolean> {
    try {
      await execFileAsync('tmux', ['has-session', '-t', sessionName]);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/aless/PycharmProjects/ClaudeAgentAutoManager && npm run test --workspace=packages/server`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/terminal/
git commit -m "feat: implement TmuxManager with create, list, kill, send-keys, capture"
```

---

### Task 4: TerminalSession

**Files:**
- Create: `packages/server/src/modules/terminal/terminal-session.ts`
- Create: `packages/server/src/modules/terminal/__tests__/terminal-session.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/server/src/modules/terminal/__tests__/terminal-session.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import { TerminalSession } from '../terminal-session.js';
import { TmuxManager } from '../tmux-manager.js';

const tmux = new TmuxManager();
const sessions: TerminalSession[] = [];

afterEach(async () => {
  for (const s of sessions) {
    await s.destroy();
  }
  sessions.length = 0;
});

describe('TerminalSession', () => {
  it('creates and exposes metadata', async () => {
    const session = await TerminalSession.create(tmux, {
      name: 'meta-test',
      command: 'bash',
      cols: 80,
      rows: 24,
    });
    sessions.push(session);

    expect(session.id).toBeTruthy();
    expect(session.name).toBe('meta-test');
    expect(session.info.status).toBe('running');
    expect(session.info.cols).toBe(80);
    expect(session.info.rows).toBe(24);
  });

  it('writes data and receives output', async () => {
    const session = await TerminalSession.create(tmux, {
      name: 'io-test',
      command: 'bash',
    });
    sessions.push(session);

    const received: string[] = [];
    session.onData((data) => received.push(data));

    session.write('echo IOCHECK\n');

    // Wait for output
    await new Promise(r => setTimeout(r, 1000));
    const scrollback = await session.getScrollback();
    expect(scrollback).toContain('IOCHECK');
  });

  it('destroys the session and cleans up', async () => {
    const session = await TerminalSession.create(tmux, {
      name: 'destroy-test',
      command: 'bash',
    });

    await session.destroy();
    const exists = await tmux.hasSession(session.tmuxSession);
    expect(exists).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=packages/server`
Expected: FAIL -- cannot find module `../terminal-session.js`

- [ ] **Step 3: Implement TerminalSession**

```typescript
// packages/server/src/modules/terminal/terminal-session.ts

import { v4 as uuidv4 } from 'uuid';
import { spawn, type ChildProcess } from 'node:child_process';
import type { TmuxManager } from './tmux-manager.js';
import {
  type TerminalInfo,
  type TerminalConfig,
  DEFAULT_COMMAND,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  TMUX_PREFIX,
} from './types.js';

type DataCallback = (data: string) => void;

export class TerminalSession {
  readonly id: string;
  readonly name: string;
  readonly tmuxSession: string;
  private status: 'running' | 'exited' = 'running';
  private cols: number;
  private rows: number;
  private readonly createdAt: number;
  private readonly tmux: TmuxManager;
  private readonly listeners: Set<DataCallback> = new Set();
  private poller: ReturnType<typeof setInterval> | null = null;
  private lastCaptureLength = 0;

  private constructor(
    id: string,
    name: string,
    tmuxSession: string,
    cols: number,
    rows: number,
    tmux: TmuxManager,
  ) {
    this.id = id;
    this.name = name;
    this.tmuxSession = tmuxSession;
    this.cols = cols;
    this.rows = rows;
    this.createdAt = Date.now();
    this.tmux = tmux;
  }

  static async create(tmux: TmuxManager, config: TerminalConfig): Promise<TerminalSession> {
    const id = uuidv4();
    const name = config.name ?? id;
    const cols = config.cols ?? DEFAULT_COLS;
    const rows = config.rows ?? DEFAULT_ROWS;
    const command = config.command ?? DEFAULT_COMMAND;

    const tmuxSession = await tmux.createSession(name, command, cols, rows);
    const session = new TerminalSession(id, name, tmuxSession, cols, rows, tmux);
    session.startPolling();
    return session;
  }

  static async attach(tmux: TmuxManager, tmuxSessionName: string): Promise<TerminalSession> {
    const exists = await tmux.hasSession(tmuxSessionName);
    if (!exists) {
      throw new Error(`tmux session not found: ${tmuxSessionName}`);
    }
    const id = uuidv4();
    const name = tmuxSessionName.replace(TMUX_PREFIX, '');
    const session = new TerminalSession(id, name, tmuxSessionName, DEFAULT_COLS, DEFAULT_ROWS, tmux);
    session.startPolling();
    return session;
  }

  get info(): TerminalInfo {
    return {
      id: this.id,
      name: this.name,
      tmuxSession: this.tmuxSession,
      status: this.status,
      createdAt: this.createdAt,
      cols: this.cols,
      rows: this.rows,
    };
  }

  write(data: string): void {
    this.tmux.sendKeys(this.tmuxSession, data);
  }

  onData(callback: DataCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.cols = cols;
    this.rows = rows;
    await this.tmux.resizePane(this.tmuxSession, cols, rows);
  }

  async getScrollback(): Promise<string> {
    return this.tmux.capturePane(this.tmuxSession);
  }

  async destroy(): Promise<void> {
    this.stopPolling();
    this.status = 'exited';
    this.listeners.clear();
    try {
      await this.tmux.killSession(this.tmuxSession);
    } catch {
      // Session may already be dead
    }
  }

  private startPolling(): void {
    // Poll tmux capture-pane for new output every 100ms
    this.poller = setInterval(async () => {
      try {
        const exists = await this.tmux.hasSession(this.tmuxSession);
        if (!exists) {
          this.status = 'exited';
          this.stopPolling();
          return;
        }
        const content = await this.tmux.capturePane(this.tmuxSession);
        if (content.length !== this.lastCaptureLength) {
          const newContent = content.slice(this.lastCaptureLength);
          this.lastCaptureLength = content.length;
          for (const cb of this.listeners) {
            cb(newContent);
          }
        }
      } catch {
        // Ignore transient capture failures
      }
    }, 100);
  }

  private stopPolling(): void {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/server`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/terminal/
git commit -m "feat: implement TerminalSession with create, attach, I/O, destroy"
```

---

### Task 5: TerminalRegistry

**Files:**
- Create: `packages/server/src/modules/terminal/terminal-registry.ts`
- Create: `packages/server/src/modules/terminal/__tests__/terminal-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/server/src/modules/terminal/__tests__/terminal-registry.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import { TerminalRegistry } from '../terminal-registry.js';
import { TmuxManager } from '../tmux-manager.js';

const tmux = new TmuxManager();
let registry: TerminalRegistry;

afterEach(async () => {
  await registry.destroyAll();
});

describe('TerminalRegistry', () => {
  it('spawns a terminal and retrieves it by id', async () => {
    registry = new TerminalRegistry(tmux);
    const info = await registry.spawn({ name: 'reg-test', command: 'bash' });

    expect(info.name).toBe('reg-test');

    const session = registry.get(info.id);
    expect(session).toBeDefined();
    expect(session!.name).toBe('reg-test');
  });

  it('lists all terminals', async () => {
    registry = new TerminalRegistry(tmux);
    await registry.spawn({ name: 'list-a', command: 'bash' });
    await registry.spawn({ name: 'list-b', command: 'bash' });

    const all = registry.list();
    expect(all).toHaveLength(2);
  });

  it('kills a terminal and removes it from the registry', async () => {
    registry = new TerminalRegistry(tmux);
    const info = await registry.spawn({ name: 'kill-reg', command: 'bash' });

    await registry.kill(info.id);
    expect(registry.get(info.id)).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it('discovers existing tmux sessions', async () => {
    registry = new TerminalRegistry(tmux);
    // Create a session outside the registry
    await tmux.createSession('discover-me', 'bash', 80, 24);

    await registry.discover();
    const all = registry.list();
    expect(all.some(t => t.name === 'discover-me')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=packages/server`
Expected: FAIL -- cannot find module `../terminal-registry.js`

- [ ] **Step 3: Implement TerminalRegistry**

```typescript
// packages/server/src/modules/terminal/terminal-registry.ts

import type { TmuxManager } from './tmux-manager.js';
import { TerminalSession } from './terminal-session.js';
import type { TerminalConfig, TerminalInfo } from './types.js';

export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly tmux: TmuxManager;

  constructor(tmux: TmuxManager) {
    this.tmux = tmux;
  }

  async spawn(config: TerminalConfig): Promise<TerminalInfo> {
    const session = await TerminalSession.create(this.tmux, config);
    this.sessions.set(session.id, session);
    return session.info;
  }

  async attach(tmuxSessionName: string): Promise<TerminalInfo> {
    // Check if already attached
    for (const session of this.sessions.values()) {
      if (session.tmuxSession === tmuxSessionName) {
        return session.info;
      }
    }
    const session = await TerminalSession.attach(this.tmux, tmuxSessionName);
    this.sessions.set(session.id, session);
    return session.info;
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  list(): TerminalInfo[] {
    return Array.from(this.sessions.values()).map(s => s.info);
  }

  async kill(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Terminal not found: ${id}`);
    }
    await session.destroy();
    this.sessions.delete(id);
  }

  async discover(): Promise<TerminalInfo[]> {
    const tmuxSessions = await this.tmux.listSessions();
    const discovered: TerminalInfo[] = [];
    for (const name of tmuxSessions) {
      // Skip already-tracked sessions
      let alreadyTracked = false;
      for (const session of this.sessions.values()) {
        if (session.tmuxSession === name) {
          alreadyTracked = true;
          break;
        }
      }
      if (!alreadyTracked) {
        const info = await this.attach(name);
        discovered.push(info);
      }
    }
    return discovered;
  }

  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.kill(id);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/server`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/terminal/
git commit -m "feat: implement TerminalRegistry with spawn, attach, discover, kill"
```

---

### Task 6: WebSocket Transport

**Files:**
- Create: `packages/server/src/transport/websocket.ts`
- Create: `packages/server/src/transport/__tests__/websocket.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/server/src/transport/__tests__/websocket.test.ts

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createWebSocketServer } from '../websocket.js';
import { TerminalRegistry } from '../../modules/terminal/terminal-registry.js';
import { TmuxManager } from '../../modules/terminal/tmux-manager.js';
import type { ServerMessage, ClientMessage } from '../protocol.js';

let httpServer: http.Server;
let registry: TerminalRegistry;
let port: number;

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

beforeEach(async () => {
  const tmux = new TmuxManager();
  registry = new TerminalRegistry(tmux);
  httpServer = http.createServer();
  createWebSocketServer(httpServer, registry);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as { port: number }).port;
      resolve();
    });
  });
});

afterEach(async () => {
  await registry.destroyAll();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('WebSocket transport', () => {
  it('spawns a terminal and returns terminal:created', async () => {
    const ws = await connectClient();
    send(ws, { type: 'terminal:spawn', name: 'ws-test', command: 'bash' });

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('terminal:created');
    if (msg.type === 'terminal:created') {
      expect(msg.name).toBe('ws-test');
      expect(msg.terminalId).toBeTruthy();
    }
    ws.close();
  });

  it('lists terminals', async () => {
    const ws = await connectClient();
    await registry.spawn({ name: 'list-ws', command: 'bash' });

    send(ws, { type: 'terminal:list' });
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('terminal:list');
    if (msg.type === 'terminal:list') {
      expect(msg.terminals).toHaveLength(1);
      expect(msg.terminals[0].name).toBe('list-ws');
    }
    ws.close();
  });

  it('returns error for unknown message type', async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify({ type: 'bogus' }));

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('error');
    ws.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=packages/server`
Expected: FAIL -- cannot find module `../websocket.js`

- [ ] **Step 3: Implement WebSocket server**

```typescript
// packages/server/src/transport/websocket.ts

import { WebSocketServer, type WebSocket } from 'ws';
import type http from 'node:http';
import type { ClientMessage, ServerMessage } from './protocol.js';
import type { TerminalRegistry } from '../modules/terminal/terminal-registry.js';

export function createWebSocketServer(
  server: http.Server,
  registry: TerminalRegistry,
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    // Track output listeners so we can clean up on disconnect
    const cleanups: Array<() => void> = [];

    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendMessage(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      try {
        await handleMessage(ws, msg, registry, cleanups);
      } catch (err) {
        sendMessage(ws, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    });

    ws.on('close', () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
    });
  });

  return wss;
}

async function handleMessage(
  ws: WebSocket,
  msg: ClientMessage,
  registry: TerminalRegistry,
  cleanups: Array<() => void>,
): Promise<void> {
  switch (msg.type) {
    case 'terminal:spawn': {
      const info = await registry.spawn({
        name: msg.name,
        command: msg.command,
      });
      sendMessage(ws, {
        type: 'terminal:created',
        terminalId: info.id,
        name: info.name,
      });
      // Subscribe to output
      const session = registry.get(info.id)!;
      const unsub = session.onData((data) => {
        sendMessage(ws, {
          type: 'terminal:output',
          terminalId: info.id,
          data,
        });
      });
      cleanups.push(unsub);
      break;
    }

    case 'terminal:attach': {
      const info = await registry.attach(msg.tmuxSessionName);
      sendMessage(ws, {
        type: 'terminal:created',
        terminalId: info.id,
        name: info.name,
      });
      const session = registry.get(info.id)!;
      const unsub = session.onData((data) => {
        sendMessage(ws, {
          type: 'terminal:output',
          terminalId: info.id,
          data,
        });
      });
      cleanups.push(unsub);
      break;
    }

    case 'terminal:input': {
      const session = registry.get(msg.terminalId);
      if (!session) {
        sendMessage(ws, { type: 'error', message: `Terminal not found: ${msg.terminalId}` });
        return;
      }
      session.write(msg.data);
      break;
    }

    case 'terminal:resize': {
      const session = registry.get(msg.terminalId);
      if (!session) {
        sendMessage(ws, { type: 'error', message: `Terminal not found: ${msg.terminalId}` });
        return;
      }
      await session.resize(msg.cols, msg.rows);
      break;
    }

    case 'terminal:kill': {
      await registry.kill(msg.terminalId);
      sendMessage(ws, {
        type: 'terminal:exited',
        terminalId: msg.terminalId,
        exitCode: 0,
      });
      break;
    }

    case 'terminal:list': {
      sendMessage(ws, {
        type: 'terminal:list',
        terminals: registry.list(),
      });
      break;
    }

    default:
      sendMessage(ws, { type: 'error', message: `Unknown message type: ${(msg as { type: string }).type}` });
  }
}

function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/server`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/transport/
git commit -m "feat: implement WebSocket transport with message routing"
```

---

### Task 7: Server Entry Point

**Files:**
- Create: `packages/server/src/app.ts`

- [ ] **Step 1: Create app.ts**

```typescript
// packages/server/src/app.ts

import http from 'node:http';
import express from 'express';
import { TmuxManager } from './modules/terminal/tmux-manager.js';
import { TerminalRegistry } from './modules/terminal/terminal-registry.js';
import { createWebSocketServer } from './transport/websocket.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const app = express();
const server = http.createServer(app);

const tmux = new TmuxManager();
const registry = new TerminalRegistry(tmux);

// REST endpoint for health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// REST endpoint for terminal list (used by frontend on initial load)
app.get('/api/terminals', (_req, res) => {
  res.json(registry.list());
});

createWebSocketServer(server, registry);

// Discover existing tmux sessions on startup
registry.discover().then((discovered) => {
  if (discovered.length > 0) {
    console.log(`Discovered ${discovered.length} existing tmux session(s)`);
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
```

- [ ] **Step 2: Verify server starts**

Run: `cd /mnt/c/Users/aless/PycharmProjects/ClaudeAgentAutoManager && timeout 5 npx tsx packages/server/src/app.ts 2>&1 || true`
Expected: "Server listening on port 3001" printed before timeout.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat: add server entry point with express + websocket"
```

---

### Task 8: Frontend -- React Entry + WebSocket Client

**Files:**
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/types.ts`
- Create: `packages/web/src/services/websocket-client.ts`
- Create: `packages/web/src/stores/terminal-store.ts`

- [ ] **Step 1: Create shared frontend types**

```typescript
// packages/web/src/types.ts

export interface TerminalInfo {
  id: string;
  name: string;
  tmuxSession: string;
  status: 'running' | 'exited';
  createdAt: number;
  cols: number;
  rows: number;
}

export type ServerMessage =
  | { type: 'terminal:output'; terminalId: string; data: string }
  | { type: 'terminal:created'; terminalId: string; name: string }
  | { type: 'terminal:exited'; terminalId: string; exitCode: number }
  | { type: 'terminal:list'; terminals: TerminalInfo[] }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'terminal:input'; terminalId: string; data: string }
  | { type: 'terminal:resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal:spawn'; name?: string; command?: string }
  | { type: 'terminal:attach'; tmuxSessionName: string }
  | { type: 'terminal:kill'; terminalId: string }
  | { type: 'terminal:list' };
```

- [ ] **Step 2: Create WebSocket client service**

```typescript
// packages/web/src/services/websocket-client.ts

import type { ClientMessage, ServerMessage } from '../types';

type MessageHandler = (msg: ServerMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.send({ type: 'terminal:list' });
    };

    this.ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      for (const handler of this.handlers) {
        handler(msg);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting in 2s...');
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
```

- [ ] **Step 3: Create terminal store**

```typescript
// packages/web/src/stores/terminal-store.ts

import { useSyncExternalStore, useCallback } from 'react';
import type { TerminalInfo, ServerMessage } from '../types';
import type { WebSocketClient } from '../services/websocket-client';

interface TerminalState {
  terminals: Map<string, TerminalInfo>;
  outputListeners: Map<string, Set<(data: string) => void>>;
}

const state: TerminalState = {
  terminals: new Map(),
  outputListeners: new Map(),
};

let listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function initTerminalStore(ws: WebSocketClient): () => void {
  return ws.onMessage((msg: ServerMessage) => {
    switch (msg.type) {
      case 'terminal:created': {
        state.terminals.set(msg.terminalId, {
          id: msg.terminalId,
          name: msg.name,
          tmuxSession: '',
          status: 'running',
          createdAt: Date.now(),
          cols: 120,
          rows: 30,
        });
        emitChange();
        break;
      }
      case 'terminal:exited': {
        const t = state.terminals.get(msg.terminalId);
        if (t) {
          t.status = 'exited';
          emitChange();
        }
        break;
      }
      case 'terminal:list': {
        state.terminals.clear();
        for (const t of msg.terminals) {
          state.terminals.set(t.id, t);
        }
        emitChange();
        break;
      }
      case 'terminal:output': {
        const cbs = state.outputListeners.get(msg.terminalId);
        if (cbs) {
          for (const cb of cbs) {
            cb(msg.data);
          }
        }
        break;
      }
    }
  });
}

function getSnapshot(): TerminalInfo[] {
  return Array.from(state.terminals.values());
}

// Keep a stable reference for useSyncExternalStore
let cachedSnapshot = getSnapshot();
function getStableSnapshot(): TerminalInfo[] {
  const next = getSnapshot();
  if (next.length !== cachedSnapshot.length || next.some((t, i) => t !== cachedSnapshot[i])) {
    cachedSnapshot = next;
  }
  return cachedSnapshot;
}

export function useTerminals(): TerminalInfo[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getStableSnapshot,
  );
}

export function subscribeToOutput(terminalId: string, callback: (data: string) => void): () => void {
  if (!state.outputListeners.has(terminalId)) {
    state.outputListeners.set(terminalId, new Set());
  }
  state.outputListeners.get(terminalId)!.add(callback);
  return () => {
    state.outputListeners.get(terminalId)?.delete(callback);
  };
}
```

- [ ] **Step 4: Create App.tsx and main.tsx**

```tsx
// packages/web/src/App.tsx

import { useEffect, useRef } from 'react';
import { WebSocketClient } from './services/websocket-client';
import { initTerminalStore, useTerminals } from './stores/terminal-store';
import { TerminalGrid } from './components/grid/TerminalGrid';
import { TerminalManager } from './components/sidebar/TerminalManager';

const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;

export function App() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const terminals = useTerminals();

  useEffect(() => {
    const ws = new WebSocketClient(wsUrl);
    wsRef.current = ws;
    const unsub = initTerminalStore(ws);
    ws.connect();
    return () => {
      unsub();
      ws.disconnect();
    };
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#1e1e1e', color: '#fff' }}>
      <TerminalManager
        terminals={terminals}
        onSpawn={(name) => wsRef.current?.send({ type: 'terminal:spawn', name })}
        onKill={(id) => wsRef.current?.send({ type: 'terminal:kill', terminalId: id })}
      />
      <TerminalGrid
        terminals={terminals}
        ws={wsRef.current}
      />
    </div>
  );
}
```

```tsx
// packages/web/src/main.tsx

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat: add React entry, WebSocket client, terminal store"
```

---

### Task 9: Frontend -- TerminalPane (xterm.js Wrapper)

**Files:**
- Create: `packages/web/src/components/terminal/TerminalPane.tsx`
- Create: `packages/web/src/components/terminal/TerminalPane.css`

- [ ] **Step 1: Create TerminalPane component**

```tsx
// packages/web/src/components/terminal/TerminalPane.tsx

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { subscribeToOutput } from '../../stores/terminal-store';
import type { WebSocketClient } from '../../services/websocket-client';
import type { TerminalInfo } from '../../types';
import './TerminalPane.css';

interface TerminalPaneProps {
  terminal: TerminalInfo;
  ws: WebSocketClient | null;
}

export function TerminalPane({ terminal, ws }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitRef.current = fitAddon;

    // Send input to server
    xterm.onData((data) => {
      ws?.send({
        type: 'terminal:input',
        terminalId: terminal.id,
        data,
      });
    });

    // Receive output from server
    const unsub = subscribeToOutput(terminal.id, (data) => {
      xterm.write(data);
    });

    // Send resize events
    xterm.onResize(({ cols, rows }) => {
      ws?.send({
        type: 'terminal:resize',
        terminalId: terminal.id,
        cols,
        rows,
      });
    });

    // Refit on container resize
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(containerRef.current);

    return () => {
      unsub();
      observer.disconnect();
      xterm.dispose();
    };
  }, [terminal.id, ws]);

  return (
    <div className="terminal-pane">
      <div className="terminal-pane-header">
        <span className="terminal-pane-name">{terminal.name}</span>
        <span className={`terminal-pane-status terminal-pane-status--${terminal.status}`}>
          {terminal.status}
        </span>
      </div>
      <div className="terminal-pane-body" ref={containerRef} />
    </div>
  );
}
```

- [ ] **Step 2: Create TerminalPane.css**

```css
/* packages/web/src/components/terminal/TerminalPane.css */

.terminal-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
}

.terminal-pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  background: #2d2d2d;
  font-size: 12px;
  user-select: none;
}

.terminal-pane-name {
  font-weight: 600;
}

.terminal-pane-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
}

.terminal-pane-status--running {
  background: #2ea04366;
  color: #4ade80;
}

.terminal-pane-status--exited {
  background: #dc262666;
  color: #f87171;
}

.terminal-pane-body {
  flex: 1;
  overflow: hidden;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/terminal/
git commit -m "feat: add TerminalPane component with xterm.js"
```

---

### Task 10: Frontend -- TerminalGrid with react-grid-layout

**Files:**
- Create: `packages/web/src/components/grid/TerminalGrid.tsx`
- Create: `packages/web/src/components/grid/TerminalGrid.css`
- Create: `packages/web/src/components/grid/LayoutPresets.tsx`

- [ ] **Step 1: Create LayoutPresets**

```tsx
// packages/web/src/components/grid/LayoutPresets.tsx

interface LayoutPresetsProps {
  onSelect: (cols: number, rows: number) => void;
}

const PRESETS = [
  { label: '1x1', cols: 1, rows: 1 },
  { label: '2x1', cols: 2, rows: 1 },
  { label: '2x2', cols: 2, rows: 2 },
  { label: '3x2', cols: 3, rows: 2 },
  { label: '3x3', cols: 3, rows: 3 },
];

export function LayoutPresets({ onSelect }: LayoutPresetsProps) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => onSelect(p.cols, p.rows)}
          style={{
            padding: '4px 8px',
            background: '#3c3c3c',
            color: '#ccc',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create TerminalGrid**

```tsx
// packages/web/src/components/grid/TerminalGrid.tsx

import { useState, useMemo } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout';
import { TerminalPane } from '../terminal/TerminalPane';
import { LayoutPresets } from './LayoutPresets';
import type { TerminalInfo } from '../../types';
import type { WebSocketClient } from '../../services/websocket-client';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './TerminalGrid.css';

const ReactGridLayout = WidthProvider(RGL);

interface TerminalGridProps {
  terminals: TerminalInfo[];
  ws: WebSocketClient | null;
}

export function TerminalGrid({ terminals, ws }: TerminalGridProps) {
  const [gridCols, setGridCols] = useState(2);
  const [gridRows, setGridRows] = useState(2);
  const [customLayout, setCustomLayout] = useState<Layout[] | null>(null);

  const autoLayout: Layout[] = useMemo(() => {
    return terminals.map((t, i) => ({
      i: t.id,
      x: i % gridCols,
      y: Math.floor(i / gridCols),
      w: 1,
      h: 1,
    }));
  }, [terminals, gridCols]);

  const layout = customLayout ?? autoLayout;

  function handlePresetSelect(cols: number, _rows: number) {
    setGridCols(cols);
    setGridRows(_rows);
    setCustomLayout(null);
  }

  function handleLayoutChange(newLayout: Layout[]) {
    setCustomLayout(newLayout);
  }

  // Row height: divide available height by grid rows
  // Subtract header area (40px for presets bar)
  const rowHeight = Math.floor((window.innerHeight - 40) / gridRows) - 10;

  return (
    <div className="terminal-grid">
      <div className="terminal-grid-toolbar">
        <LayoutPresets onSelect={handlePresetSelect} />
      </div>
      <ReactGridLayout
        className="terminal-grid-layout"
        layout={layout}
        cols={gridCols}
        rowHeight={rowHeight}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".terminal-pane-header"
        compactType="vertical"
        margin={[4, 4]}
      >
        {terminals.map((t) => (
          <div key={t.id}>
            <TerminalPane terminal={t} ws={ws} />
          </div>
        ))}
      </ReactGridLayout>
    </div>
  );
}
```

- [ ] **Step 3: Create TerminalGrid.css**

```css
/* packages/web/src/components/grid/TerminalGrid.css */

.terminal-grid {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.terminal-grid-toolbar {
  padding: 6px 8px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.terminal-grid-layout {
  flex: 1;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/grid/
git commit -m "feat: add TerminalGrid with react-grid-layout and layout presets"
```

---

### Task 11: Frontend -- TerminalManager Sidebar

**Files:**
- Create: `packages/web/src/components/sidebar/TerminalManager.tsx`
- Create: `packages/web/src/components/sidebar/TerminalManager.css`

- [ ] **Step 1: Create TerminalManager component**

```tsx
// packages/web/src/components/sidebar/TerminalManager.tsx

import { useState } from 'react';
import type { TerminalInfo } from '../../types';
import './TerminalManager.css';

interface TerminalManagerProps {
  terminals: TerminalInfo[];
  onSpawn: (name: string) => void;
  onKill: (id: string) => void;
}

export function TerminalManager({ terminals, onSpawn, onKill }: TerminalManagerProps) {
  const [newName, setNewName] = useState('');

  function handleSpawn() {
    const name = newName.trim() || `agent-${terminals.length + 1}`;
    onSpawn(name);
    setNewName('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSpawn();
    }
  }

  return (
    <div className="terminal-manager">
      <h2 className="terminal-manager-title">Terminals</h2>

      <div className="terminal-manager-spawn">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Terminal name..."
          className="terminal-manager-input"
        />
        <button onClick={handleSpawn} className="terminal-manager-btn">
          Spawn
        </button>
      </div>

      <ul className="terminal-manager-list">
        {terminals.map((t) => (
          <li key={t.id} className="terminal-manager-item">
            <span className="terminal-manager-item-name">{t.name}</span>
            <span className={`terminal-manager-item-status terminal-manager-item-status--${t.status}`}>
              {t.status}
            </span>
            <button
              className="terminal-manager-item-kill"
              onClick={() => onKill(t.id)}
              title="Kill terminal"
            >
              x
            </button>
          </li>
        ))}
        {terminals.length === 0 && (
          <li className="terminal-manager-empty">No terminals running</li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Create TerminalManager.css**

```css
/* packages/web/src/components/sidebar/TerminalManager.css */

.terminal-manager {
  width: 220px;
  background: #252525;
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;
  padding: 12px;
  flex-shrink: 0;
}

.terminal-manager-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px 0;
}

.terminal-manager-spawn {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}

.terminal-manager-input {
  flex: 1;
  padding: 4px 6px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 3px;
  color: #ccc;
  font-size: 12px;
}

.terminal-manager-btn {
  padding: 4px 10px;
  background: #0e639c;
  color: #fff;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.terminal-manager-btn:hover {
  background: #1177bb;
}

.terminal-manager-list {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  overflow-y: auto;
}

.terminal-manager-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  border-bottom: 1px solid #333;
  font-size: 12px;
}

.terminal-manager-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-manager-item-status {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
}

.terminal-manager-item-status--running {
  background: #2ea04366;
  color: #4ade80;
}

.terminal-manager-item-status--exited {
  background: #dc262666;
  color: #f87171;
}

.terminal-manager-item-kill {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}

.terminal-manager-item-kill:hover {
  color: #f87171;
}

.terminal-manager-empty {
  color: #666;
  font-size: 12px;
  padding: 8px 4px;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/sidebar/
git commit -m "feat: add TerminalManager sidebar with spawn and kill"
```

---

### Task 12: Integration -- End-to-End Smoke Test

**Files:**
- Create: `packages/server/src/modules/terminal/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// packages/server/src/modules/terminal/__tests__/integration.test.ts

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import express from 'express';
import { TmuxManager } from '../tmux-manager.js';
import { TerminalRegistry } from '../terminal-registry.js';
import { createWebSocketServer } from '../../../transport/websocket.js';
import type { ServerMessage, ClientMessage } from '../../../transport/protocol.js';

let httpServer: http.Server;
let registry: TerminalRegistry;
let port: number;

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

function waitFor(ws: WebSocket, predicate: (msg: ServerMessage) => boolean, timeoutMs = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
    ws.on('message', function handler(data) {
      const msg: ServerMessage = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    });
  });
}

beforeEach(async () => {
  const tmux = new TmuxManager();
  registry = new TerminalRegistry(tmux);
  const app = express();
  httpServer = http.createServer(app);
  createWebSocketServer(httpServer, registry);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as { port: number }).port;
      resolve();
    });
  });
});

afterEach(async () => {
  await registry.destroyAll();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('End-to-end integration', () => {
  it('spawns a terminal, sends input, receives output', async () => {
    const ws = await connectClient();

    // Spawn a bash terminal
    send(ws, { type: 'terminal:spawn', name: 'e2e-test', command: 'bash' });
    const created = await waitFor(ws, m => m.type === 'terminal:created');
    expect(created.type).toBe('terminal:created');
    if (created.type !== 'terminal:created') throw new Error('unexpected');

    const terminalId = created.terminalId;

    // Send input
    send(ws, { type: 'terminal:input', terminalId, data: 'echo E2E_MARKER\n' });

    // Wait for output containing our marker
    const output = await waitFor(ws, (m) =>
      m.type === 'terminal:output' && m.data.includes('E2E_MARKER'),
    );
    expect(output.type).toBe('terminal:output');

    // Kill it
    send(ws, { type: 'terminal:kill', terminalId });
    const exited = await waitFor(ws, m => m.type === 'terminal:exited');
    expect(exited.type).toBe('terminal:exited');

    ws.close();
  });

  it('lists terminals after spawning', async () => {
    const ws = await connectClient();

    send(ws, { type: 'terminal:spawn', name: 'list-e2e-a', command: 'bash' });
    await waitFor(ws, m => m.type === 'terminal:created');

    send(ws, { type: 'terminal:spawn', name: 'list-e2e-b', command: 'bash' });
    await waitFor(ws, m => m.type === 'terminal:created');

    send(ws, { type: 'terminal:list' });
    const list = await waitFor(ws, m => m.type === 'terminal:list');
    if (list.type !== 'terminal:list') throw new Error('unexpected');
    expect(list.terminals).toHaveLength(2);

    ws.close();
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npm run test --workspace=packages/server`
Expected: All tests PASS, including integration tests.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/terminal/__tests__/integration.test.ts
git commit -m "test: add end-to-end integration tests for terminal spawn and I/O"
```

---

### Task 13: Verify Full Stack

- [ ] **Step 1: Build server TypeScript**

Run: `npm run build --workspace=packages/server`
Expected: Compiles without errors.

- [ ] **Step 2: Build web frontend**

Run: `npm run build --workspace=packages/web`
Expected: Vite build completes without errors.

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: All tests PASS.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 1 Terminal Grid MVP"
```
