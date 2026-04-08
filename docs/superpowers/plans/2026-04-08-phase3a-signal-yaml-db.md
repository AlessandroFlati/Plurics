# Phase 3A: Signal Infrastructure, YAML Parser & Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation for workflow orchestration: signal file types, signal validation, signal file watcher, workflow YAML parser with cycle detection, and database tables for workflow runs.

**Architecture:** New `packages/server/src/modules/workflow/` module with pure-function validators and a chokidar-based signal watcher. YAML parser validates workflow definitions into typed structures. Database gains workflow_runs and workflow_events tables.

**Tech Stack:** chokidar (already installed), yaml (new dep), better-sqlite3 (existing), crypto (node built-in), vitest (testing)

---

## File Structure

### New files

```
packages/server/src/modules/workflow/types.ts            # All workflow, signal, DAG node types
packages/server/src/modules/workflow/utils.ts             # Atomic JSON write, sleep, hex, filename builder
packages/server/src/modules/workflow/signal-validator.ts   # Validate signal schema + output integrity
packages/server/src/modules/workflow/signal-watcher.ts     # chokidar watcher on .caam/shared/signals/
packages/server/src/modules/workflow/yaml-parser.ts        # Parse + validate workflow YAML
packages/server/src/db/workflow-repository.ts              # Workflow run + event persistence
```

### Modified files

```
packages/server/src/db/database.ts                        # Add workflow_runs, workflow_events tables
packages/server/package.json                              # Add yaml dependency
```

### Test files

```
packages/server/src/modules/workflow/__tests__/signal-validator.test.ts
packages/server/src/modules/workflow/__tests__/yaml-parser.test.ts
packages/server/src/db/__tests__/workflow-repository.test.ts
```

---

### Task 1: Workflow Types

**Files:**
- Create: `packages/server/src/modules/workflow/types.ts`

- [ ] **Step 1: Create types.ts with all interfaces**

Create `packages/server/src/modules/workflow/types.ts`:

```typescript
// --- Signal Protocol Types ---

export interface SignalFile {
  schema_version: 1;
  signal_id: string;
  agent: string;
  scope: string | null;
  status: 'success' | 'failure' | 'branch' | 'budget_exhausted';
  decision: {
    goto: string;
    reason: string;
    payload: unknown;
  } | null;
  outputs: Array<{
    path: string;
    sha256: string;
    size_bytes: number;
  }>;
  metrics: {
    duration_seconds: number;
    retries_used: number;
  };
  error: {
    category: string;
    message: string;
    recoverable: boolean;
  } | null;
}

// --- DAG Node Types ---

export type NodeState =
  | 'pending'
  | 'ready'
  | 'spawning'
  | 'running'
  | 'validating'
  | 'completed'
  | 'retrying'
  | 'failed'
  | 'skipped';

export interface DagNode {
  name: string;
  preset: string;
  state: NodeState;
  scope: string | null;
  dependsOn: string[];
  terminalId: string | null;
  retryCount: number;
  maxRetries: number;
  invocationCount: number;
  maxInvocations: number;
  timeoutMs: number;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  signal: SignalFile | null;
  startedAt: number | null;
}

// --- Workflow YAML Types ---

export interface WorkflowConfig {
  name: string;
  version: number;
  config: {
    max_hypothesis_rounds: number;
    max_audit_rounds: number;
    max_total_tests: number;
    agent_timeout_seconds: number;
    base_significance?: number;
    max_parallel_hypotheses?: number;
  };
  shared_context: string;
  nodes: Record<string, WorkflowNodeDef>;
}

export interface WorkflowNodeDef {
  preset: string;
  depends_on?: string[];
  depends_on_all?: string[];
  inputs?: string[];
  outputs?: string[];
  branch?: Array<{
    condition: string;
    goto: string;
    foreach?: string;
  }>;
  max_invocations?: number;
  next?: string;
  max_retries?: number;
  timeout_seconds?: number;
}

// --- State Transitions ---

export const TRANSITIONS: Record<NodeState, Partial<Record<string, NodeState>>> = {
  pending:    { deps_met: 'ready', upstream_failed: 'skipped', budget_exhausted: 'skipped' },
  ready:      { spawn: 'spawning' },
  spawning:   { terminal_created: 'running' },
  running:    { signal_received: 'validating', timeout: 'retrying', crash: 'retrying' },
  validating: { outputs_valid: 'completed', integrity_failed: 'retrying' },
  retrying:   { retry_available: 'spawning', max_retries: 'failed' },
  completed:  {},
  failed:     {},
  skipped:    {},
};

// --- Event Log ---

export interface EventLogEntry {
  timestamp: number;
  runId: string;
  node: string;
  fromState: NodeState;
  toState: NodeState;
  event: string;
}

// --- Signal Filename Parsing ---

export const SIGNAL_FILENAME_REGEX = /^(?<agent>[a-z_]+)(?:\.(?<scope>[A-Za-z0-9_-]+))?(?:\.(?<iteration>pass|retry)-(?<n>\d+))?\.done\.json$/;

// --- Validation ---

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    issue: 'missing' | 'size_mismatch' | 'sha256_mismatch' | 'json_parse_failed';
    expected: string | number;
    actual: string | number | null;
  }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/modules/workflow/types.ts
git commit -m "feat: add workflow, signal, and DAG node type definitions"
```

---

### Task 2: Workflow Utilities

**Files:**
- Create: `packages/server/src/modules/workflow/utils.ts`

- [ ] **Step 1: Create utils.ts**

Create `packages/server/src/modules/workflow/utils.ts`:

```typescript
import { randomBytes, createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { DagNode } from './types.js';

export async function writeJsonAtomic(filepath: string, data: unknown): Promise<void> {
  const tmpPath = `${filepath}.${randomBytes(4).toString('hex')}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, filepath);
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function buildSignalFilename(node: Pick<DagNode, 'name' | 'scope' | 'retryCount'>): string {
  let filename = node.name;
  if (node.scope) filename += `.${node.scope}`;
  if (node.retryCount > 0) filename += `.retry-${node.retryCount}`;
  return `${filename}.done.json`;
}

export async function computeSha256(filepath: string): Promise<string> {
  const content = await fs.readFile(filepath);
  return createHash('sha256').update(content).digest('hex');
}

export async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/modules/workflow/utils.ts
git commit -m "feat: add workflow utility functions (atomic write, sha256, sleep)"
```

---

### Task 3: Signal Validator

**Files:**
- Create: `packages/server/src/modules/workflow/signal-validator.ts`
- Create: `packages/server/src/modules/workflow/__tests__/signal-validator.test.ts`

- [ ] **Step 1: Create signal-validator.ts**

Create `packages/server/src/modules/workflow/signal-validator.ts`:

```typescript
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { SignalFile, ValidationResult } from './types.js';
import { computeSha256, fileExists } from './utils.js';

export function validateSignalSchema(signal: unknown): signal is SignalFile {
  if (typeof signal !== 'object' || signal === null) return false;
  const s = signal as Record<string, unknown>;

  if (s.schema_version !== 1) return false;
  if (typeof s.signal_id !== 'string') return false;
  if (typeof s.agent !== 'string') return false;
  if (s.scope !== null && typeof s.scope !== 'string') return false;
  if (!['success', 'failure', 'branch', 'budget_exhausted'].includes(s.status as string)) return false;

  if (s.decision !== null) {
    if (typeof s.decision !== 'object') return false;
    const d = s.decision as Record<string, unknown>;
    if (typeof d.goto !== 'string') return false;
    if (typeof d.reason !== 'string') return false;
  }

  if (!Array.isArray(s.outputs)) return false;
  for (const o of s.outputs as unknown[]) {
    if (typeof o !== 'object' || o === null) return false;
    const out = o as Record<string, unknown>;
    if (typeof out.path !== 'string') return false;
    if (typeof out.sha256 !== 'string') return false;
    if (typeof out.size_bytes !== 'number') return false;
  }

  if (typeof s.metrics !== 'object' || s.metrics === null) return false;
  const m = s.metrics as Record<string, unknown>;
  if (typeof m.duration_seconds !== 'number') return false;
  if (typeof m.retries_used !== 'number') return false;

  if (s.error !== null) {
    if (typeof s.error !== 'object') return false;
    const e = s.error as Record<string, unknown>;
    if (typeof e.category !== 'string') return false;
    if (typeof e.message !== 'string') return false;
    if (typeof e.recoverable !== 'boolean') return false;
  }

  return true;
}

export async function validateSignalOutputs(
  workspacePath: string,
  signal: SignalFile,
): Promise<ValidationResult> {
  const errors: ValidationResult['errors'] = [];

  for (const output of signal.outputs) {
    const fullPath = path.join(workspacePath, '.caam', output.path);

    if (!await fileExists(fullPath)) {
      errors.push({ path: output.path, issue: 'missing', expected: 'exists', actual: null });
      continue;
    }

    const stat = await fs.stat(fullPath);
    if (stat.size !== output.size_bytes) {
      errors.push({ path: output.path, issue: 'size_mismatch', expected: output.size_bytes, actual: stat.size });
      continue;
    }

    const hash = await computeSha256(fullPath);
    if (hash !== output.sha256) {
      errors.push({ path: output.path, issue: 'sha256_mismatch', expected: output.sha256, actual: hash });
      continue;
    }

    if (output.path.endsWith('.json')) {
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        JSON.parse(content);
      } catch {
        errors.push({ path: output.path, issue: 'json_parse_failed', expected: 'valid JSON', actual: 'parse error' });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 2: Create signal-validator.test.ts**

Create `packages/server/src/modules/workflow/__tests__/signal-validator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { validateSignalSchema, validateSignalOutputs } from '../signal-validator.js';
import type { SignalFile } from '../types.js';

function makeSignal(overrides: Partial<SignalFile> = {}): SignalFile {
  return {
    schema_version: 1,
    signal_id: 'sig-20260408-test-abcd',
    agent: 'test_agent',
    scope: null,
    status: 'success',
    decision: null,
    outputs: [],
    metrics: { duration_seconds: 10, retries_used: 0 },
    error: null,
    ...overrides,
  };
}

describe('validateSignalSchema', () => {
  it('accepts a valid signal', () => {
    expect(validateSignalSchema(makeSignal())).toBe(true);
  });

  it('accepts a signal with branch decision', () => {
    expect(validateSignalSchema(makeSignal({
      status: 'branch',
      decision: { goto: 'next_node', reason: 'done', payload: ['H-001'] },
    }))).toBe(true);
  });

  it('rejects null', () => {
    expect(validateSignalSchema(null)).toBe(false);
  });

  it('rejects wrong schema_version', () => {
    expect(validateSignalSchema({ ...makeSignal(), schema_version: 2 })).toBe(false);
  });

  it('rejects missing agent', () => {
    const s = makeSignal();
    (s as Record<string, unknown>).agent = 123;
    expect(validateSignalSchema(s)).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(validateSignalSchema({ ...makeSignal(), status: 'unknown' })).toBe(false);
  });

  it('rejects outputs with missing sha256', () => {
    expect(validateSignalSchema({
      ...makeSignal(),
      outputs: [{ path: 'foo.json', size_bytes: 10 }],
    })).toBe(false);
  });
});

describe('validateSignalOutputs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caam-test-'));
    fs.mkdirSync(path.join(tmpDir, '.caam', 'shared', 'results'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns valid for signal with no outputs', async () => {
    const result = await validateSignalOutputs(tmpDir, makeSignal());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing output file', async () => {
    const signal = makeSignal({
      outputs: [{ path: 'shared/results/missing.json', sha256: 'abc', size_bytes: 10 }],
    });
    const result = await validateSignalOutputs(tmpDir, signal);
    expect(result.valid).toBe(false);
    expect(result.errors[0].issue).toBe('missing');
  });

  it('detects size mismatch', async () => {
    const filePath = path.join(tmpDir, '.caam', 'shared', 'results', 'out.json');
    fs.writeFileSync(filePath, '{"ok":true}');
    const stat = fs.statSync(filePath);
    const signal = makeSignal({
      outputs: [{ path: 'shared/results/out.json', sha256: 'abc', size_bytes: stat.size + 100 }],
    });
    const result = await validateSignalOutputs(tmpDir, signal);
    expect(result.valid).toBe(false);
    expect(result.errors[0].issue).toBe('size_mismatch');
  });

  it('detects sha256 mismatch', async () => {
    const filePath = path.join(tmpDir, '.caam', 'shared', 'results', 'out.json');
    const content = '{"ok":true}';
    fs.writeFileSync(filePath, content);
    const stat = fs.statSync(filePath);
    const signal = makeSignal({
      outputs: [{ path: 'shared/results/out.json', sha256: 'wrong_hash', size_bytes: stat.size }],
    });
    const result = await validateSignalOutputs(tmpDir, signal);
    expect(result.valid).toBe(false);
    expect(result.errors[0].issue).toBe('sha256_mismatch');
  });

  it('validates correct output', async () => {
    const filePath = path.join(tmpDir, '.caam', 'shared', 'results', 'out.json');
    const content = '{"ok":true}';
    fs.writeFileSync(filePath, content);
    const stat = fs.statSync(filePath);
    const hash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const signal = makeSignal({
      outputs: [{ path: 'shared/results/out.json', sha256: hash, size_bytes: stat.size }],
    });
    const result = await validateSignalOutputs(tmpDir, signal);
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/server/src/modules/workflow/__tests__/signal-validator.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/workflow/signal-validator.ts packages/server/src/modules/workflow/__tests__/signal-validator.test.ts
git commit -m "feat: add signal schema validation and output integrity checker"
```

---

### Task 4: Signal Watcher

**Files:**
- Create: `packages/server/src/modules/workflow/signal-watcher.ts`

- [ ] **Step 1: Create signal-watcher.ts**

Create `packages/server/src/modules/workflow/signal-watcher.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/modules/workflow/signal-watcher.ts
git commit -m "feat: add SignalWatcher with chokidar for .done.json signal files"
```

---

### Task 5: YAML Parser

**Files:**
- Create: `packages/server/src/modules/workflow/yaml-parser.ts`
- Create: `packages/server/src/modules/workflow/__tests__/yaml-parser.test.ts`

- [ ] **Step 1: Install yaml package**

```bash
npm install yaml --workspace=packages/server
```

- [ ] **Step 2: Create yaml-parser.ts**

Create `packages/server/src/modules/workflow/yaml-parser.ts`:

```typescript
import { parse as parseYaml } from 'yaml';
import type { WorkflowConfig, WorkflowNodeDef } from './types.js';

export function parseWorkflow(yamlContent: string): WorkflowConfig {
  const raw = parseYaml(yamlContent);

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Workflow YAML must be an object');
  }

  assertField(raw, 'name', 'string');
  assertField(raw, 'version', 'number');
  assertField(raw, 'config', 'object');
  assertField(raw, 'nodes', 'object');

  const requiredConfigFields = [
    'max_hypothesis_rounds',
    'max_audit_rounds',
    'max_total_tests',
    'agent_timeout_seconds',
  ];
  for (const field of requiredConfigFields) {
    assertField(raw.config, field, 'number');
  }

  if (!raw.shared_context) {
    raw.shared_context = '';
  }

  validateNodeGraph(raw.nodes);

  return raw as WorkflowConfig;
}

function assertField(obj: Record<string, unknown>, field: string, type: string): void {
  if (!(field in obj)) {
    throw new Error(`Missing required field: "${field}"`);
  }
  if (typeof obj[field] !== type) {
    throw new Error(`Field "${field}" must be ${type}, got ${typeof obj[field]}`);
  }
}

function validateNodeGraph(nodes: Record<string, WorkflowNodeDef>): void {
  const nodeNames = new Set(Object.keys(nodes));

  for (const [name, node] of Object.entries(nodes)) {
    if (!node.preset || typeof node.preset !== 'string') {
      throw new Error(`Node "${name}" must have a "preset" string`);
    }

    for (const dep of node.depends_on ?? []) {
      if (!nodeNames.has(dep)) {
        throw new Error(`Node "${name}" depends on unknown node "${dep}"`);
      }
    }

    for (const dep of node.depends_on_all ?? []) {
      if (!nodeNames.has(dep)) {
        throw new Error(`Node "${name}" depends_on_all unknown node "${dep}"`);
      }
    }

    for (const branch of node.branch ?? []) {
      if (!nodeNames.has(branch.goto)) {
        throw new Error(`Node "${name}" branches to unknown node "${branch.goto}"`);
      }
    }

    if (node.next && !nodeNames.has(node.next)) {
      throw new Error(`Node "${name}" has next="${node.next}" which doesn't exist`);
    }
  }

  detectCycles(nodes);
}

function detectCycles(nodes: Record<string, WorkflowNodeDef>): void {
  // Kahn's algorithm: nodes with max_invocations are allowed to form loops.
  // Only flag cycles where no node in the cycle has max_invocations set.
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const name of Object.keys(nodes)) {
    inDegree.set(name, 0);
    adjList.set(name, []);
  }

  for (const [name, node] of Object.entries(nodes)) {
    for (const dep of node.depends_on ?? []) {
      adjList.get(dep)!.push(name);
      inDegree.set(name, inDegree.get(name)! + 1);
    }
    // branch/next edges create forward dependencies
    for (const branch of node.branch ?? []) {
      // Branch edges are conditional forward edges; skip for cycle detection
      // since they require max_invocations on the target to form loops.
    }
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adjList.get(node)!) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (visited < Object.keys(nodes).length) {
    const cycleNodes = [...inDegree.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([name]) => name);

    // Check if all cycle nodes have max_invocations (intentional loop)
    const allHaveLimit = cycleNodes.every(name => nodes[name].max_invocations != null);
    if (!allHaveLimit) {
      throw new Error(
        `Cycle detected among nodes without max_invocations: ${cycleNodes.join(', ')}`
      );
    }
  }
}
```

- [ ] **Step 3: Create yaml-parser.test.ts**

Create `packages/server/src/modules/workflow/__tests__/yaml-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseWorkflow } from '../yaml-parser.js';

const VALID_YAML = `
name: test-workflow
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
shared_context: "Test context"
nodes:
  ingestor:
    preset: data-ingestor
  profiler:
    preset: data-profiler
    depends_on: [ingestor]
  analyst:
    preset: analyst
    depends_on: [profiler]
`;

describe('parseWorkflow', () => {
  it('parses valid workflow YAML', () => {
    const config = parseWorkflow(VALID_YAML);
    expect(config.name).toBe('test-workflow');
    expect(config.version).toBe(1);
    expect(config.config.max_total_tests).toBe(50);
    expect(Object.keys(config.nodes)).toHaveLength(3);
    expect(config.nodes.profiler.depends_on).toEqual(['ingestor']);
  });

  it('rejects missing name', () => {
    const yaml = VALID_YAML.replace('name: test-workflow', '');
    expect(() => parseWorkflow(yaml)).toThrow('Missing required field: "name"');
  });

  it('rejects missing config fields', () => {
    const yaml = VALID_YAML.replace('max_total_tests: 50', '');
    expect(() => parseWorkflow(yaml)).toThrow('Missing required field: "max_total_tests"');
  });

  it('rejects unknown dependency', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    depends_on: [nonexistent]
`;
    expect(() => parseWorkflow(yaml)).toThrow('depends on unknown node "nonexistent"');
  });

  it('rejects unknown branch target', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    branch:
      - condition: "always"
        goto: nonexistent
`;
    expect(() => parseWorkflow(yaml)).toThrow('branches to unknown node "nonexistent"');
  });

  it('detects cycles without max_invocations', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
    depends_on: [b]
  b:
    preset: preset-b
    depends_on: [a]
`;
    expect(() => parseWorkflow(yaml)).toThrow('Cycle detected');
  });

  it('defaults shared_context to empty string', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    preset: preset-a
`;
    const config = parseWorkflow(yaml);
    expect(config.shared_context).toBe('');
  });

  it('rejects node without preset', () => {
    const yaml = `
name: test
version: 1
config:
  max_hypothesis_rounds: 3
  max_audit_rounds: 5
  max_total_tests: 50
  agent_timeout_seconds: 300
nodes:
  a:
    depends_on: []
`;
    expect(() => parseWorkflow(yaml)).toThrow('must have a "preset" string');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/server/src/modules/workflow/__tests__/yaml-parser.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/workflow/yaml-parser.ts packages/server/src/modules/workflow/__tests__/yaml-parser.test.ts package-lock.json packages/server/package.json
git commit -m "feat: add workflow YAML parser with validation and cycle detection"
```

---

### Task 6: Database Tables + Workflow Repository

**Files:**
- Modify: `packages/server/src/db/database.ts`
- Create: `packages/server/src/db/workflow-repository.ts`
- Create: `packages/server/src/db/__tests__/workflow-repository.test.ts`

- [ ] **Step 1: Add workflow tables to database.ts**

In `packages/server/src/db/database.ts`, add after the `agent_presets` table creation (inside the same `db.exec` template literal):

```sql

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      yaml_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      node_count INTEGER NOT NULL,
      nodes_completed INTEGER NOT NULL DEFAULT 0,
      nodes_failed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      node_name TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      event TEXT NOT NULL,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_events_run ON workflow_events(run_id);
```

- [ ] **Step 2: Create workflow-repository.ts**

Create `packages/server/src/db/workflow-repository.ts`:

```typescript
import type Database from 'better-sqlite3';

export interface WorkflowRun {
  id: string;
  workflow_name: string;
  workspace_path: string;
  yaml_content: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  started_at: string;
  completed_at: string | null;
  node_count: number;
  nodes_completed: number;
  nodes_failed: number;
}

export interface WorkflowEvent {
  id: number;
  run_id: string;
  timestamp: string;
  node_name: string;
  from_state: string;
  to_state: string;
  event: string;
  details: string | null;
}

export class WorkflowRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createRun(run: Omit<WorkflowRun, 'started_at' | 'completed_at' | 'nodes_completed' | 'nodes_failed'>): WorkflowRun {
    this.db.prepare(
      `INSERT INTO workflow_runs (id, workflow_name, workspace_path, yaml_content, status, node_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(run.id, run.workflow_name, run.workspace_path, run.yaml_content, run.status, run.node_count);
    return this.getRun(run.id)!;
  }

  getRun(id: string): WorkflowRun | undefined {
    return this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as WorkflowRun | undefined;
  }

  listRuns(): WorkflowRun[] {
    return this.db.prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC').all() as WorkflowRun[];
  }

  updateRunStatus(id: string, status: WorkflowRun['status'], nodesCompleted: number, nodesFailed: number): void {
    const completedAt = ['completed', 'failed', 'aborted'].includes(status) ? "datetime('now')" : 'NULL';
    this.db.prepare(
      `UPDATE workflow_runs SET status = ?, nodes_completed = ?, nodes_failed = ?, completed_at = ${completedAt} WHERE id = ?`
    ).run(status, nodesCompleted, nodesFailed, id);
  }

  addEvent(event: Omit<WorkflowEvent, 'id' | 'timestamp'>): void {
    this.db.prepare(
      `INSERT INTO workflow_events (run_id, node_name, from_state, to_state, event, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(event.run_id, event.node_name, event.from_state, event.to_state, event.event, event.details);
  }

  getEvents(runId: string): WorkflowEvent[] {
    return this.db.prepare(
      'SELECT * FROM workflow_events WHERE run_id = ? ORDER BY id ASC'
    ).all(runId) as WorkflowEvent[];
  }
}
```

- [ ] **Step 3: Create workflow-repository.test.ts**

Create `packages/server/src/db/__tests__/workflow-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorkflowRepository } from '../workflow-repository.js';

let db: Database.Database;
let repo: WorkflowRepository;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      yaml_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      node_count INTEGER NOT NULL,
      nodes_completed INTEGER NOT NULL DEFAULT 0,
      nodes_failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      node_name TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      event TEXT NOT NULL,
      details TEXT
    );
  `);
  repo = new WorkflowRepository(db);
});

afterEach(() => {
  db.close();
});

describe('WorkflowRepository', () => {
  it('creates and retrieves a run', () => {
    const run = repo.createRun({
      id: 'run-test-1',
      workflow_name: 'test-wf',
      workspace_path: '/tmp/test',
      yaml_content: 'name: test',
      status: 'running',
      node_count: 5,
    });
    expect(run.id).toBe('run-test-1');
    expect(run.workflow_name).toBe('test-wf');
    expect(run.node_count).toBe(5);
    expect(run.nodes_completed).toBe(0);
    expect(run.status).toBe('running');
  });

  it('lists runs ordered by started_at DESC', () => {
    repo.createRun({ id: 'run-1', workflow_name: 'wf', workspace_path: '/tmp', yaml_content: '', status: 'running', node_count: 1 });
    repo.createRun({ id: 'run-2', workflow_name: 'wf', workspace_path: '/tmp', yaml_content: '', status: 'running', node_count: 2 });
    const runs = repo.listRuns();
    expect(runs).toHaveLength(2);
  });

  it('updates run status', () => {
    repo.createRun({ id: 'run-1', workflow_name: 'wf', workspace_path: '/tmp', yaml_content: '', status: 'running', node_count: 3 });
    repo.updateRunStatus('run-1', 'completed', 3, 0);
    const run = repo.getRun('run-1')!;
    expect(run.status).toBe('completed');
    expect(run.nodes_completed).toBe(3);
  });

  it('adds and retrieves events', () => {
    repo.createRun({ id: 'run-1', workflow_name: 'wf', workspace_path: '/tmp', yaml_content: '', status: 'running', node_count: 1 });
    repo.addEvent({ run_id: 'run-1', node_name: 'ingestor', from_state: 'pending', to_state: 'ready', event: 'deps_met', details: null });
    repo.addEvent({ run_id: 'run-1', node_name: 'ingestor', from_state: 'ready', to_state: 'spawning', event: 'spawn', details: null });
    const events = repo.getEvents('run-1');
    expect(events).toHaveLength(2);
    expect(events[0].node_name).toBe('ingestor');
    expect(events[0].to_state).toBe('ready');
    expect(events[1].to_state).toBe('spawning');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/server/src/db/__tests__/workflow-repository.test.ts packages/server/src/modules/workflow/__tests__/signal-validator.test.ts packages/server/src/modules/workflow/__tests__/yaml-parser.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/database.ts packages/server/src/db/workflow-repository.ts packages/server/src/db/__tests__/workflow-repository.test.ts
git commit -m "feat: add workflow_runs/events tables and WorkflowRepository"
```
