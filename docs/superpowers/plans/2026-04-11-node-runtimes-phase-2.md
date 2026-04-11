# Node Runtimes Phase 2 — Value Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the Plurics Value Store — an in-memory, per-run structured-value store that gives every `NumpyArray` / `DataFrame` tool output a stable string handle, resolves handles back into pickle envelopes when downstream tool nodes need them as inputs, and provides compact human-readable summaries alongside each handle.

**Architecture:** New file `execution/value-store.ts`. Extended `types.ts`, `schemas/builtin.ts`, `schemas/schema-registry.ts`, `execution/encoding.ts`, `execution/executor.ts`, `workflow/dag-executor.ts`, `python/runner.py`. The value store is created per workflow run by the DAG executor; there is no global singleton.

**Tech Stack:** TypeScript ESM (NodeNext), vitest, Node `crypto`, Node `fs/promises`. Python runner uses stdlib only (`json`, `base64`, `pickle`). No new npm dependencies.

**Source of truth:** `docs/superpowers/specs/2026-04-11-node-runtimes-phase-2-design.md`. When this plan and the spec disagree, the spec wins.

**Test discipline:** Every task follows red-green-commit: write the failing test, run it to confirm the right failure, implement the minimum to pass, run tests to confirm green, then commit. Integration tests use `describe.skipIf(!pythonAvailable() || !numpyAvailable)` so this Windows box (no numpy) self-skips integration tests cleanly.

**Working directory for all commands:** `C:/Users/aless/PycharmProjects/ClaudeAgentAutoManager`. The server package is at `packages/server`. Tests run via `cd packages/server && npx vitest run <path>`. Use `__dirname` in all test files — never `import.meta.url` (CJS compat).

**Baseline:** Tool Registry Phase 1+2 + TR Phase 3 pilot + Node Runtimes Phase 1 all merged on `main`.

---

## Task 1: New types in `types.ts`

**Files:**
- Extend: `packages/server/src/modules/registry/types.ts`

No dedicated test — types are validated structurally by the compiler when consumers use them. Run `tsc --noEmit` to confirm.

- [ ] **Step 1: Add `ValueRef`, `ValueEnvelope`, `ValueSummary`, `StoredValue` to `types.ts`**

Append after the existing `RegistryClientOptions` block:

`packages/server/src/modules/registry/types.ts` (append):

```typescript
// ---------- Value Store (Node Runtimes Phase 2) ----------

/**
 * An opaque reference to a structured value held in the run-level ValueStore.
 * This is what flows through the TypeScript workflow runtime instead of raw
 * pickle envelopes. Callers outside the execution layer never see ValueEnvelope.
 */
export interface ValueRef {
  _type: 'value_ref';
  /** "vs-{yyyyMMddTHHmmss}-{nodeName}-{portName}-{shortHash}" */
  _handle: string;
  /** Schema name, e.g. "DataFrame" or "NumpyArray". */
  _schema: string;
  /** Human-readable summary produced by the runner, if available. */
  _summary?: ValueSummary;
}

/**
 * The raw pickle envelope as emitted by the Python runner.
 * Lives only inside the execution layer and the value store.
 */
export interface ValueEnvelope {
  _schema: string;
  _encoding: 'pickle_b64';
  /** base64-encoded pickle bytes. */
  _data: string;
}

/**
 * Compact summary computed by the runner and stored alongside the envelope.
 * Provides a human-readable / LLM-readable view without unpickling.
 */
export interface ValueSummary {
  schema: string;
  // DataFrame-specific
  shape?: [number, number];
  columns?: string[];
  head?: Record<string, unknown>[];
  stats?: Record<string, unknown>;
  // NumpyArray-specific
  ndim?: number;
  size?: number;
  dtype?: string;
  sample?: unknown[];
}

/**
 * A stored value: envelope + optional summary, with provenance metadata.
 * Kept in the ValueStore's in-memory map and serialized to disk on flush().
 */
export interface StoredValue {
  handle: string;
  envelope: ValueEnvelope;
  summary: ValueSummary | null;
  schema: string;
  /** ISO-8601 UTC timestamp of when store() was called. */
  createdAt: string;
  nodeName: string;
  portName: string;
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/types.ts
git commit -m "nr-phase-2: add ValueRef, ValueEnvelope, ValueSummary, StoredValue types"
```

---

## Task 2: `ValueStore` scaffold — in-memory map + handle generation

**Files:**
- Create: `packages/server/src/modules/registry/execution/value-store.ts`
- Create: `packages/server/src/modules/registry/execution/__tests__/value-store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/execution/__tests__/value-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { ValueStore } from '../value-store.js';
import type { ValueEnvelope, ValueSummary } from '../../types.js';

const MOCK_ENVELOPE: ValueEnvelope = {
  _schema: 'NumpyArray',
  _encoding: 'pickle_b64',
  _data: 'AAAA',
};

const MOCK_SUMMARY: ValueSummary = {
  schema: 'NumpyArray',
  ndim: 1,
  size: 4,
  dtype: 'float64',
  sample: [1.0, 2.0, 3.0, 4.0],
};

describe('ValueStore — handle generation', () => {
  it('store() returns a handle matching the vs-{ts}-{node}-{port}-{hash} pattern', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const handle = store.store(MOCK_ENVELOPE, null, 'load_data', 'array');
    expect(handle).toMatch(/^vs-\d{8}T\d{6}-load_data-array-[0-9a-f]{8}$/);
  });

  it('handle embeds sanitized node and port names (dots become underscores)', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const handle = store.store(MOCK_ENVELOPE, null, 'my.node', 'out.port');
    expect(handle).toContain('-my_node-');
    expect(handle).toContain('-out_port-');
  });

  it('handle truncates long node/port names to 20 chars', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const handle = store.store(MOCK_ENVELOPE, null, 'a'.repeat(30), 'b'.repeat(30));
    const parts = handle.split('-');
    // parts: ['vs', timestamp, nodeName, portName, hash]
    expect(parts[2].length).toBeLessThanOrEqual(20);
    expect(parts[3].length).toBeLessThanOrEqual(20);
  });

  it('two store() calls on the same ms with different data produce distinct handles', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const env2: ValueEnvelope = { ...MOCK_ENVELOPE, _data: 'BBBB' };
    const h1 = store.store(MOCK_ENVELOPE, null, 'node', 'port');
    const h2 = store.store(env2, null, 'node', 'port');
    expect(h1).not.toEqual(h2);
  });
});

describe('ValueStore — storage and retrieval', () => {
  it('resolve() returns the stored value', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const handle = store.store(MOCK_ENVELOPE, MOCK_SUMMARY, 'load_data', 'array');
    const stored = store.resolve(handle);
    expect(stored).not.toBeNull();
    expect(stored!.envelope).toEqual(MOCK_ENVELOPE);
    expect(stored!.summary).toEqual(MOCK_SUMMARY);
    expect(stored!.schema).toBe('NumpyArray');
    expect(stored!.nodeName).toBe('load_data');
    expect(stored!.portName).toBe('array');
    expect(stored!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('resolve() returns null for unknown handle', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    expect(store.resolve('vs-doesnotexist')).toBeNull();
  });

  it('has() returns true for stored handles, false otherwise', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const h = store.store(MOCK_ENVELOPE, null, 'n', 'p');
    expect(store.has(h)).toBe(true);
    expect(store.has('vs-ghost')).toBe(false);
  });

  it('handles() lists all stored handles', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const h1 = store.store(MOCK_ENVELOPE, null, 'n', 'p1');
    const h2 = store.store({ ...MOCK_ENVELOPE, _data: 'ZZ' }, null, 'n', 'p2');
    expect(store.handles()).toContain(h1);
    expect(store.handles()).toContain(h2);
    expect(store.handles().length).toBe(2);
  });

  it('store() with null summary stores summary as null', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const h = store.store(MOCK_ENVELOPE, null, 'n', 'p');
    expect(store.resolve(h)!.summary).toBeNull();
  });
});

describe('ValueStore — disk flush and load', () => {
  it('flush() writes .pkl.b64 file and .summary.json sidecar', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));
    const store = new ValueStore('run-x', tmpDir);
    const handle = store.store(MOCK_ENVELOPE, MOCK_SUMMARY, 'node', 'port');

    await store.flush();

    const valuesDir = path.join(tmpDir, 'runs', 'run-x', 'values');
    expect(fs.existsSync(path.join(valuesDir, `${handle}.pkl.b64`))).toBe(true);
    expect(fs.existsSync(path.join(valuesDir, `${handle}.summary.json`))).toBe(true);

    const envelopeFile = JSON.parse(fs.readFileSync(path.join(valuesDir, `${handle}.pkl.b64`), 'utf-8'));
    expect(envelopeFile.envelope._data).toBe('AAAA');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('flush() does not write .summary.json when summary is null', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));
    const store = new ValueStore('run-x', tmpDir);
    const handle = store.store(MOCK_ENVELOPE, null, 'node', 'port');
    await store.flush();

    const valuesDir = path.join(tmpDir, 'runs', 'run-x', 'values');
    expect(fs.existsSync(path.join(valuesDir, `${handle}.pkl.b64`))).toBe(true);
    expect(fs.existsSync(path.join(valuesDir, `${handle}.summary.json`))).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadRunLevel() restores flushed envelopes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));

    const store1 = new ValueStore('run-x', tmpDir);
    const handle = store1.store(MOCK_ENVELOPE, MOCK_SUMMARY, 'node', 'port');
    await store1.flush();

    const store2 = new ValueStore('run-x', tmpDir);
    await store2.loadRunLevel();

    const stored = store2.resolve(handle);
    expect(stored).not.toBeNull();
    expect(stored!.envelope._data).toBe('AAAA');
    expect(stored!.summary?.ndim).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadRunLevel() skips malformed .pkl.b64 files without throwing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));
    const valuesDir = path.join(tmpDir, 'runs', 'run-x', 'values');
    fs.mkdirSync(valuesDir, { recursive: true });
    fs.writeFileSync(path.join(valuesDir, 'vs-bad.pkl.b64'), 'not json', 'utf-8');

    const store = new ValueStore('run-x', tmpDir);
    await expect(store.loadRunLevel()).resolves.not.toThrow();
    expect(store.handles().length).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Confirm test fails (file does not exist yet)**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/value-store.test.ts 2>&1 | tail -10
```

Expected: error about missing module `../value-store.js`.

- [ ] **Step 3: Implement `value-store.ts`**

`packages/server/src/modules/registry/execution/value-store.ts`:

```typescript
/**
 * ValueStore — in-memory per-run store for structured Python values (pickle envelopes).
 *
 * Phase 2 scope: single in-memory Map<handle, StoredValue>. All values go to the
 * same map regardless of whether they originate from a tool node or a reasoning node
 * (stub). The scope-local / run-level distinction is plumbed in the API surface but
 * has no behavioral difference until NR Phase 3 adds the tool-calling loop.
 *
 * Disk layout (per flush):
 *   {runsDir}/runs/{runId}/values/{handle}.pkl.b64      — JSON: envelope + provenance
 *   {runsDir}/runs/{runId}/values/{handle}.summary.json — JSON: ValueSummary (if present)
 *
 * See: docs/superpowers/specs/2026-04-11-node-runtimes-phase-2-design.md §7
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ValueEnvelope, ValueSummary, StoredValue } from '../types.js';

export class ValueStore {
  /** In-memory map from handle → StoredValue. */
  private readonly map: Map<string, StoredValue> = new Map();

  /**
   * @param runId    Identifier for the current workflow run.
   * @param runsDir  Root directory under which run data is stored.
   *                 Values directory: {runsDir}/runs/{runId}/values/
   */
  constructor(
    private readonly runId: string,
    private readonly runsDir: string,
  ) {}

  /**
   * Store an envelope and return a new handle.
   *
   * Handle format: vs-{yyyyMMddTHHmmss}-{sanitizedNode}-{sanitizedPort}-{sha256[:8]}
   *
   * The timestamp and hash together guarantee uniqueness even if two ports in the
   * same node produce the same bytes at the same millisecond (hash covers _data).
   *
   * Phase 2 note: scope-local and run-level are the same tier. Phase 3 will
   * introduce a scope-local store that the tool-calling loop writes to; run-level
   * handles persist across scope boundaries within a run.
   */
  store(
    envelope: ValueEnvelope,
    summary: ValueSummary | null,
    nodeName: string,
    portName: string,
  ): string {
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', 'T').slice(0, 15);
    const sanNode = sanitize(nodeName);
    const sanPort = sanitize(portName);
    const hash = crypto.createHash('sha256').update(envelope._data).digest('hex').slice(0, 8);
    const handle = `vs-${ts}-${sanNode}-${sanPort}-${hash}`;

    const stored: StoredValue = {
      handle,
      envelope,
      summary,
      schema: envelope._schema,
      createdAt: new Date().toISOString(),
      nodeName,
      portName,
    };
    this.map.set(handle, stored);
    return handle;
  }

  /** Resolve a handle to its stored value, or null if not found. */
  resolve(handle: string): StoredValue | null {
    return this.map.get(handle) ?? null;
  }

  /** True if the handle exists in this store. */
  has(handle: string): boolean {
    return this.map.has(handle);
  }

  /** Return all handles currently held in memory. */
  handles(): string[] {
    return [...this.map.keys()];
  }

  /**
   * Persist all in-memory envelopes to disk.
   * Each stored value becomes two files in {runsDir}/runs/{runId}/values/:
   *   {handle}.pkl.b64      — JSON with envelope + provenance fields
   *   {handle}.summary.json — JSON ValueSummary (only if summary is non-null)
   *
   * Idempotent: re-flushing an already-persisted handle overwrites the files.
   */
  async flush(): Promise<void> {
    const valuesDir = this.valuesDir();
    await fs.mkdir(valuesDir, { recursive: true });

    const writes: Promise<void>[] = [];
    for (const [handle, stored] of this.map) {
      const envelopeFile: Record<string, unknown> = {
        handle: stored.handle,
        schema: stored.schema,
        nodeName: stored.nodeName,
        portName: stored.portName,
        createdAt: stored.createdAt,
        envelope: stored.envelope,
      };
      writes.push(
        fs.writeFile(
          path.join(valuesDir, `${handle}.pkl.b64`),
          JSON.stringify(envelopeFile),
          'utf-8',
        ),
      );
      if (stored.summary !== null) {
        writes.push(
          fs.writeFile(
            path.join(valuesDir, `${handle}.summary.json`),
            JSON.stringify(stored.summary),
            'utf-8',
          ),
        );
      }
    }
    await Promise.all(writes);
  }

  /**
   * Load previously-flushed envelopes from disk into the in-memory map.
   * Files with malformed JSON are skipped with a console.warn; they do not
   * abort loading. Call this once at workflow resume / cold-start.
   */
  async loadRunLevel(): Promise<void> {
    const valuesDir = this.valuesDir();
    let entries: import('node:fs').Dirent[];
    try {
      const { readdir } = await import('node:fs/promises');
      entries = await readdir(valuesDir, { withFileTypes: true });
    } catch {
      // Directory doesn't exist — first run, nothing to load.
      return;
    }

    for (const entry of entries) {
      if (!entry.name.endsWith('.pkl.b64')) continue;
      const handle = entry.name.slice(0, -'.pkl.b64'.length);
      const filePath = path.join(valuesDir, entry.name);

      let parsed: Record<string, unknown>;
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        console.warn(`[ValueStore] Skipping malformed file: ${filePath}`);
        continue;
      }

      const envelope = parsed.envelope as ValueEnvelope | undefined;
      if (!envelope || envelope._encoding !== 'pickle_b64') {
        console.warn(`[ValueStore] Skipping invalid envelope in: ${filePath}`);
        continue;
      }

      // Load optional summary sidecar
      let summary: ValueSummary | null = null;
      const summaryPath = path.join(valuesDir, `${handle}.summary.json`);
      try {
        const raw = await fs.readFile(summaryPath, 'utf-8');
        summary = JSON.parse(raw) as ValueSummary;
      } catch {
        // No sidecar — summary stays null
      }

      const stored: StoredValue = {
        handle,
        envelope,
        summary,
        schema: (parsed.schema as string) ?? envelope._schema,
        createdAt: (parsed.createdAt as string) ?? new Date().toISOString(),
        nodeName: (parsed.nodeName as string) ?? '',
        portName: (parsed.portName as string) ?? '',
      };
      this.map.set(handle, stored);
    }
  }

  private valuesDir(): string {
    return path.join(this.runsDir, 'runs', this.runId, 'values');
  }
}

/** Sanitize a name for embedding in a handle: replace non-alphanumeric with _, truncate to 20. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
}
```

- [ ] **Step 4: Run tests — confirm green**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/value-store.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/registry/execution/value-store.ts \
        packages/server/src/modules/registry/execution/__tests__/value-store.test.ts
git commit -m "nr-phase-2: add ValueStore — in-memory handle store with disk flush/load"
```

---

## Task 3: Schema summarizers

**Files:**
- Extend: `packages/server/src/modules/registry/schemas/builtin.ts`
- Extend: `packages/server/src/modules/registry/schemas/schema-registry.ts`
- Extend: `packages/server/src/modules/registry/types.ts` (add `Summarizer` type alias + `summarizer` field to `SchemaDef`)
- Create: `packages/server/src/modules/registry/schemas/__tests__/builtin.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/schemas/__tests__/builtin.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '../schema-registry.js';

describe('SchemaRegistry — summarizers', () => {
  const schemas = new SchemaRegistry();

  it('getSummarizer("DataFrame") returns a function', () => {
    expect(typeof schemas.getSummarizer('DataFrame')).toBe('function');
  });

  it('getSummarizer("NumpyArray") returns a function', () => {
    expect(typeof schemas.getSummarizer('NumpyArray')).toBe('function');
  });

  it('getSummarizer("Float") returns null', () => {
    expect(schemas.getSummarizer('Float')).toBeNull();
  });

  it('getSummarizer("Unknown") returns null', () => {
    expect(schemas.getSummarizer('Unknown')).toBeNull();
  });

  it('DataFrame summarizer produces shape, columns, head from valid payload', () => {
    const summarizer = schemas.getSummarizer('DataFrame')!;
    const payload = {
      shape: [100, 3],
      columns: ['a', 'b', 'c'],
      head: [{ a: 1, b: 2, c: 3 }],
      stats: { a: { mean: 1.5 } },
    };
    const summary = summarizer(payload);
    expect(summary).not.toBeNull();
    expect(summary!.schema).toBe('DataFrame');
    expect(summary!.shape).toEqual([100, 3]);
    expect(summary!.columns).toEqual(['a', 'b', 'c']);
    expect(summary!.head).toEqual([{ a: 1, b: 2, c: 3 }]);
    expect(summary!.stats).toEqual({ a: { mean: 1.5 } });
  });

  it('DataFrame summarizer returns partial summary if stats is missing', () => {
    const summarizer = schemas.getSummarizer('DataFrame')!;
    const payload = { shape: [10, 2], columns: ['x', 'y'], head: [] };
    const summary = summarizer(payload);
    expect(summary).not.toBeNull();
    expect(summary!.shape).toEqual([10, 2]);
    expect(summary!.stats).toBeUndefined();
  });

  it('DataFrame summarizer does not throw on empty/null payload', () => {
    const summarizer = schemas.getSummarizer('DataFrame')!;
    expect(() => summarizer(null)).not.toThrow();
    expect(() => summarizer({})).not.toThrow();
    expect(() => summarizer(undefined)).not.toThrow();
  });

  it('NumpyArray summarizer produces ndim, size, dtype, sample from valid payload', () => {
    const summarizer = schemas.getSummarizer('NumpyArray')!;
    const payload = { shape: [4], ndim: 1, size: 4, dtype: 'float64', sample: [1, 2, 3, 4] };
    const summary = summarizer(payload);
    expect(summary).not.toBeNull();
    expect(summary!.schema).toBe('NumpyArray');
    expect(summary!.ndim).toBe(1);
    expect(summary!.size).toBe(4);
    expect(summary!.dtype).toBe('float64');
    expect(summary!.sample).toEqual([1, 2, 3, 4]);
  });

  it('NumpyArray summarizer does not throw on empty payload', () => {
    const summarizer = schemas.getSummarizer('NumpyArray')!;
    expect(() => summarizer(null)).not.toThrow();
    expect(() => summarizer({})).not.toThrow();
  });
});
```

- [ ] **Step 2: Confirm test fails**

```bash
cd packages/server && npx vitest run src/modules/registry/schemas/__tests__/builtin.test.ts 2>&1 | tail -10
```

Expected: error — `getSummarizer` does not exist on `SchemaRegistry`.

- [ ] **Step 3: Add `Summarizer` type and `summarizer` field to `SchemaDef` in `types.ts`**

Append after the `SchemaSource` line in the `types.ts` schema section (before the existing `SchemaDef` interface), and extend `SchemaDef`:

```typescript
// In the "Schemas" section of types.ts:

/** Function that turns a runner-computed payload into a typed summary. */
export type Summarizer = (payload: unknown) => ValueSummary | null;
```

Also add `summarizer?: Summarizer;` as an optional field to the `SchemaDef` interface:

```typescript
export interface SchemaDef {
  name: string;
  kind: SchemaKind;
  pythonRepresentation: string | null;
  encoding: SchemaEncoding;
  description: string | null;
  source: SchemaSource;
  /** Optional: convert runner-emitted summary payload to a typed ValueSummary. */
  summarizer?: Summarizer;
}
```

Note: `Summarizer` references `ValueSummary` which is declared later in the same file — TypeScript hoists interface/type declarations within a file, so this works. If the compiler objects, move the `Summarizer` alias after `ValueSummary`.

- [ ] **Step 4: Add summarizer implementations to `builtin.ts`**

Replace the `NumpyArray` and `DataFrame` entries in `BUILTIN_SCHEMAS` to include summarizers. Keep all other entries unchanged.

`packages/server/src/modules/registry/schemas/builtin.ts` — replace the two structured schema entries:

```typescript
  {
    name: 'NumpyArray',
    kind: 'structured',
    pythonRepresentation: 'numpy.ndarray',
    encoding: 'pickle_b64',
    description: 'Multi-dimensional numeric array.',
    source: 'builtin',
    summarizer(payload: unknown) {
      try {
        if (!payload || typeof payload !== 'object') return null;
        const p = payload as Record<string, unknown>;
        return {
          schema: 'NumpyArray',
          ndim: typeof p['ndim'] === 'number' ? p['ndim'] : undefined,
          size: typeof p['size'] === 'number' ? p['size'] : undefined,
          dtype: typeof p['dtype'] === 'string' ? p['dtype'] : undefined,
          shape: Array.isArray(p['shape']) ? (p['shape'] as [number, number]) : undefined,
          sample: Array.isArray(p['sample']) ? (p['sample'] as unknown[]) : undefined,
        };
      } catch {
        return null;
      }
    },
  },
  {
    name: 'DataFrame',
    kind: 'structured',
    pythonRepresentation: 'pandas.DataFrame',
    encoding: 'pickle_b64',
    description: 'Generic pandas DataFrame.',
    source: 'builtin',
    summarizer(payload: unknown) {
      try {
        if (!payload || typeof payload !== 'object') return null;
        const p = payload as Record<string, unknown>;
        return {
          schema: 'DataFrame',
          shape: Array.isArray(p['shape']) ? (p['shape'] as [number, number]) : undefined,
          columns: Array.isArray(p['columns']) ? (p['columns'] as string[]) : undefined,
          head: Array.isArray(p['head']) ? (p['head'] as Record<string, unknown>[]) : undefined,
          stats: p['stats'] && typeof p['stats'] === 'object'
            ? (p['stats'] as Record<string, unknown>)
            : undefined,
        };
      } catch {
        return null;
      }
    },
  },
```

Also add the `Summarizer` import to `builtin.ts` (it is already imported transitively through `SchemaDef` — no additional import needed since `SchemaDef` now carries the `summarizer` field).

- [ ] **Step 5: Add `getSummarizer()` to `SchemaRegistry`**

In `packages/server/src/modules/registry/schemas/schema-registry.ts`, add:

```typescript
import type { SchemaDef, SchemaEncoding, Summarizer } from '../types.js';

// ... existing class body ...

  getSummarizer(name: string): Summarizer | null {
    const s = this.byName.get(name);
    return s?.summarizer ?? null;
  }
```

- [ ] **Step 6: Run tests — confirm green**

```bash
cd packages/server && npx vitest run src/modules/registry/schemas/__tests__/builtin.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/types.ts \
        packages/server/src/modules/registry/schemas/builtin.ts \
        packages/server/src/modules/registry/schemas/schema-registry.ts \
        packages/server/src/modules/registry/schemas/__tests__/builtin.test.ts
git commit -m "nr-phase-2: add schema summarizers for NumpyArray and DataFrame"
```

---

## Task 4: `encodeInputs` / `decodeOutputs` — ValueStore threading

**Files:**
- Extend: `packages/server/src/modules/registry/execution/encoding.ts`
- Extend: `packages/server/src/modules/registry/execution/__tests__/encoding.test.ts`

This task lifts the blanket pickle rejection for `ValueRef` inputs and wires `decodeOutputs` to register envelopes into the value store, returning `ValueRef` to the caller.

- [ ] **Step 1: Write failing tests (append to existing `encoding.test.ts`)**

Append the following to `packages/server/src/modules/registry/execution/__tests__/encoding.test.ts`:

```typescript
import * as os from 'node:os';
import { ValueStore } from '../value-store.js';
import type { ValueRef, ValueEnvelope } from '../../types.js';

// Helpers shared across new describes
function makeStore(): ValueStore {
  return new ValueStore('test-run', os.tmpdir());
}

describe('encodeInputs — Phase 2 ValueRef handling', () => {
  const schemas = new SchemaRegistry();

  it('passes a ValueRef through unchanged when valueStore is provided', () => {
    const store = makeStore();
    const ref: ValueRef = { _type: 'value_ref', _handle: 'vs-test', _schema: 'NumpyArray' };
    // Preload the handle
    const env: ValueEnvelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'AAAA' };
    store.store(env, null, 'node', 'port'); // side effect: handle is stored, but we use our own ref
    // For this test we just verify encodeInputs passes the ref through as-is
    // (the value_refs map building is tested separately)
    const inputSchemas = { arr: 'NumpyArray' };
    // We supply the ref — encodeInputs must not throw
    const result = encodeInputs({ arr: ref }, inputSchemas, schemas, store);
    expect(result.encoded['arr']).toEqual(ref);
  });

  it('rejects a ValueRef when valueStore is null', () => {
    const ref: ValueRef = { _type: 'value_ref', _handle: 'vs-test', _schema: 'NumpyArray' };
    const inputSchemas = { arr: 'NumpyArray' };
    expect(() => encodeInputs({ arr: ref }, inputSchemas, schemas, null)).toThrow(EncodingError);
  });

  it('rejects a raw JS value for a pickle schema (unchanged behavior)', () => {
    const inputSchemas = { arr: 'NumpyArray' };
    expect(() => encodeInputs({ arr: [1, 2, 3] }, inputSchemas, schemas, null)).toThrow(EncodingError);
    expect(() => encodeInputs({ arr: [1, 2, 3] }, inputSchemas, schemas, makeStore())).toThrow(EncodingError);
  });

  it('builds value_refs map from ValueRef inputs using the store', () => {
    const store = makeStore();
    const env: ValueEnvelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'BBBB' };
    const handle = store.store(env, null, 'upstream', 'arr');
    const ref: ValueRef = { _type: 'value_ref', _handle: handle, _schema: 'NumpyArray' };

    const inputSchemas = { arr: 'NumpyArray' };
    const result = encodeInputs({ arr: ref }, inputSchemas, schemas, store);
    expect(result.valueRefs).toBeDefined();
    expect(result.valueRefs![handle]).toEqual(env);
  });

  it('throws validation error when ValueRef handle is not in store', () => {
    const store = makeStore();
    const ref: ValueRef = { _type: 'value_ref', _handle: 'vs-ghost', _schema: 'NumpyArray' };
    const inputSchemas = { arr: 'NumpyArray' };
    expect(() => encodeInputs({ arr: ref }, inputSchemas, schemas, store)).toThrow(
      /handle_not_found/,
    );
  });
});

describe('decodeOutputs — Phase 2 ValueStore registration', () => {
  const schemas = new SchemaRegistry();

  it('returns a ValueRef when valueStore is provided and output is pickle_b64', () => {
    const store = makeStore();
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'CCCC' };
    const outputSchemas = { arr: 'NumpyArray' };
    const result = decodeOutputs({ arr: envelope }, outputSchemas, schemas, store, 'myNode', 'myPort');
    expect((result['arr'] as ValueRef)._type).toBe('value_ref');
    expect((result['arr'] as ValueRef)._schema).toBe('NumpyArray');
    expect(typeof (result['arr'] as ValueRef)._handle).toBe('string');
  });

  it('stores the envelope in the value store after decodeOutputs', () => {
    const store = makeStore();
    const envelope = { _schema: 'DataFrame', _encoding: 'pickle_b64', _data: 'DDDD' };
    const outputSchemas = { df: 'DataFrame' };
    const result = decodeOutputs({ df: envelope }, outputSchemas, schemas, store, 'myNode', 'df');
    const handle = (result['df'] as ValueRef)._handle;
    expect(store.has(handle)).toBe(true);
    expect(store.resolve(handle)!.envelope._data).toBe('DDDD');
  });

  it('extracts _summary from envelope and stores it', () => {
    const store = makeStore();
    const summary = { schema: 'NumpyArray', ndim: 1, size: 3 };
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'EEEE', _summary: summary };
    const outputSchemas = { arr: 'NumpyArray' };
    decodeOutputs({ arr: envelope }, outputSchemas, schemas, store, 'n', 'p');
    const handles = store.handles();
    expect(handles.length).toBe(1);
    expect(store.resolve(handles[0])!.summary).toEqual(summary);
  });

  it('returns raw envelope when valueStore is null (backward compat)', () => {
    const schemas = new SchemaRegistry();
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'FFFF' };
    const outputSchemas = { arr: 'NumpyArray' };
    const result = decodeOutputs({ arr: envelope }, outputSchemas, schemas, null, 'n', 'p');
    expect(result['arr']).toEqual(envelope);
  });

  it('primitive outputs are unchanged regardless of valueStore', () => {
    const store = makeStore();
    const outputSchemas = { r: 'Integer' };
    const result = decodeOutputs({ r: 42 }, outputSchemas, schemas, store, 'n', 'p');
    expect(result['r']).toBe(42);
  });
});
```

- [ ] **Step 2: Confirm tests fail**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/encoding.test.ts 2>&1 | tail -15
```

Expected: failures on `encodeInputs` signature mismatch and missing `valueRefs` field.

- [ ] **Step 3: Implement encoding changes**

Replace `packages/server/src/modules/registry/execution/encoding.ts` entirely:

```typescript
import type { SchemaRegistry } from '../schemas/schema-registry.js';
import type { ValueRef, ValueEnvelope } from '../types.js';
import type { ValueStore } from './value-store.js';

export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodingError';
  }
}

export interface EncodeInputsResult {
  /** The encoded inputs to send to the runner. ValueRefs pass through as-is. */
  encoded: Record<string, unknown>;
  /**
   * Map of handle → envelope for every ValueRef found in `encoded`.
   * The runner receives this as the `value_refs` top-level field.
   * Null when valueStore is null (legacy callers).
   */
  valueRefs: Record<string, ValueEnvelope> | null;
}

/**
 * Encode tool inputs for dispatch to the Python runner.
 *
 * Phase 2 changes:
 * - If valueStore is non-null and an input value is a ValueRef, it is
 *   passed through as-is, AND the corresponding envelope is added to the
 *   returned valueRefs map so the runner can resolve it.
 * - If valueStore is non-null and an input value is a raw JS value for a
 *   pickle_b64 schema, throw "raw pickle inputs not supported".
 * - If valueStore is null, a ValueRef input also throws (cannot resolve
 *   without a store). This preserves Phase 1+2 behavior for legacy callers.
 * - Handle not found in store: throw "handle_not_found: {handle}".
 */
export function encodeInputs(
  values: Record<string, unknown>,
  inputSchemas: Record<string, string>,
  schemas: SchemaRegistry,
  valueStore: ValueStore | null,
): EncodeInputsResult {
  const encoded: Record<string, unknown> = {};
  const valueRefs: Record<string, ValueEnvelope> = {};

  for (const [name, value] of Object.entries(values)) {
    const schemaName = inputSchemas[name];
    if (!schemaName) {
      throw new EncodingError(`input "${name}" has no declared schema`);
    }
    if (!schemas.has(schemaName)) {
      throw new EncodingError(`unknown schema "${schemaName}" on input "${name}"`);
    }

    if (isValueRef(value)) {
      if (valueStore === null) {
        throw new EncodingError(
          `ValueRef input "${name}" cannot be resolved without a ValueStore (no store provided)`,
        );
      }
      const stored = valueStore.resolve(value._handle);
      if (!stored) {
        throw new EncodingError(`handle_not_found: ${value._handle} (input "${name}")`);
      }
      encoded[name] = value;
      valueRefs[value._handle] = stored.envelope;
      continue;
    }

    if (schemas.encodingOf(schemaName) === 'pickle_b64') {
      throw new EncodingError(
        `raw pickle inputs are not supported — use a value handle (input "${name}" has schema "${schemaName}")`,
      );
    }

    encoded[name] = value;
  }

  return {
    encoded,
    valueRefs: valueStore !== null ? valueRefs : null,
  };
}

/**
 * Decode raw runner outputs, optionally registering structured values in the store.
 *
 * Phase 2 changes:
 * - If valueStore is non-null and an output entry is a pickle_b64 envelope,
 *   strip the optional _summary field, store the envelope, and return a ValueRef.
 * - If valueStore is null, pickle envelopes are returned as-is (Phase 1+2 compat).
 */
export function decodeOutputs(
  raw: Record<string, unknown>,
  outputSchemas: Record<string, string>,
  schemas: SchemaRegistry,
  valueStore: ValueStore | null,
  nodeName: string,
  portName: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const schemaName = outputSchemas[name] ?? 'JsonObject';
    if (
      valueStore !== null &&
      schemas.has(schemaName) &&
      schemas.encodingOf(schemaName) === 'pickle_b64' &&
      isPickleEnvelope(value)
    ) {
      // Extract optional runner-computed summary
      const rawEnv = value as Record<string, unknown>;
      const summaryPayload = rawEnv['_summary'];
      const envelope: ValueEnvelope = {
        _schema: rawEnv['_schema'] as string,
        _encoding: 'pickle_b64',
        _data: rawEnv['_data'] as string,
      };

      // Use summarizer from schema registry if available
      let summary = null;
      if (summaryPayload !== undefined) {
        const summarizer = schemas.getSummarizer(schemaName);
        summary = summarizer ? summarizer(summaryPayload) : (summaryPayload as import('../types.js').ValueSummary);
      }

      const handle = valueStore.store(envelope, summary, nodeName, name);
      const ref: ValueRef = { _type: 'value_ref', _handle: handle, _schema: schemaName };
      if (summary) ref._summary = summary;
      out[name] = ref;
    } else {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Build the JSON envelope string sent to the runner on stdin.
 * Includes the value_refs map when it is non-null and non-empty.
 */
export function buildEnvelope(
  inputs: Record<string, unknown>,
  inputSchemas: Record<string, string>,
  outputSchemas: Record<string, string>,
  valueRefs?: Record<string, ValueEnvelope> | null,
): string {
  const payload: Record<string, unknown> = {
    inputs,
    input_schemas: inputSchemas,
    output_schemas: outputSchemas,
  };
  if (valueRefs && Object.keys(valueRefs).length > 0) {
    payload['value_refs'] = valueRefs;
  }
  return JSON.stringify(payload);
}

function isValueRef(v: unknown): v is ValueRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>)['_type'] === 'value_ref' &&
    typeof (v as Record<string, unknown>)['_handle'] === 'string'
  );
}

function isPickleEnvelope(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>)['_encoding'] === 'pickle_b64' &&
    typeof (v as Record<string, unknown>)['_data'] === 'string'
  );
}
```

- [ ] **Step 4: Run encoding tests — confirm green**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/encoding.test.ts 2>&1 | tail -20
```

Expected: all tests pass (including pre-existing tests). Note: the existing test "rejects pickle schema on inputs" must still pass — raw arrays for pickle schemas are still rejected regardless of valueStore.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/execution/encoding.ts \
        packages/server/src/modules/registry/execution/__tests__/encoding.test.ts
git commit -m "nr-phase-2: extend encodeInputs/decodeOutputs for ValueRef and value_refs map"
```

---

## Task 5: `executor.ts` — thread `ValueStore` through invocation

**Files:**
- Extend: `packages/server/src/modules/registry/execution/executor.ts`

No new test file here — the executor is tested via `executor.test.ts` (existing integration tests). The existing tests must continue to pass (they call `invokeTool` without a `valueStore`, verifying backward compat). New integration tests for handle round-trip are in Task 7.

- [ ] **Step 1: Update `executor.ts` to accept optional `valueStore`**

The changes are:
1. Add `valueStore?: ValueStore | null` to `ExecutorDeps`.
2. Pass `deps.valueStore ?? null` to `encodeInputs` and `decodeOutputs`.
3. Update `buildEnvelope` call to include `valueRefs`.
4. The `nodeName` for `decodeOutputs` comes from `request.callerContext?.nodeName ?? tool.name`.

`packages/server/src/modules/registry/execution/executor.ts` — full replacement:

```typescript
import type { InvocationRequest, InvocationResult, ToolRecord } from '../types.js';
import type { SchemaRegistry } from '../schemas/schema-registry.js';
import type { ValueStore } from './value-store.js';
import { runSubprocess } from './subprocess.js';
import { buildEnvelope, encodeInputs, decodeOutputs, EncodingError } from './encoding.js';

export interface ExecutorDeps {
  schemas: SchemaRegistry;
  runnerPath: string;
  pythonPath: string | null;
  /**
   * Optional value store for the current workflow run.
   * If null (the default), pickle inputs are rejected and pickle outputs
   * are returned as raw envelopes — preserving Phase 1+2 behavior.
   * Phase 2 note: pass the run-level ValueStore from the DAG executor to
   * enable handle generation and resolution.
   */
  valueStore?: ValueStore | null;
}

export async function invokeTool(
  deps: ExecutorDeps,
  tool: ToolRecord,
  request: InvocationRequest,
): Promise<InvocationResult> {
  const start = Date.now();
  const durationMs = () => Date.now() - start;

  if (deps.pythonPath === null) {
    return {
      success: false,
      error: { category: 'python_unavailable', message: 'no Python interpreter was found at initialize time' },
      metrics: { durationMs: durationMs() },
    };
  }

  // Validate inputs against declared ports.
  const inputValidation = validateInputs(tool, request.inputs);
  if (inputValidation) {
    return {
      success: false,
      error: { category: 'validation', message: inputValidation },
      metrics: { durationMs: durationMs() },
    };
  }

  // Apply defaults for omitted optional ports.
  const mergedInputs: Record<string, unknown> = {};
  for (const port of tool.inputs) {
    if (port.name in request.inputs) {
      mergedInputs[port.name] = request.inputs[port.name];
    } else if (port.default !== undefined) {
      mergedInputs[port.name] = port.default;
    }
  }

  const inputSchemas = Object.fromEntries(tool.inputs.map((p) => [p.name, p.schemaName]));
  const outputSchemas = Object.fromEntries(tool.outputs.map((p) => [p.name, p.schemaName]));
  const valueStore = deps.valueStore ?? null;

  let envelope: string;
  try {
    const encodeResult = encodeInputs(mergedInputs, inputSchemas, deps.schemas, valueStore);
    envelope = buildEnvelope(encodeResult.encoded, inputSchemas, outputSchemas, encodeResult.valueRefs);
  } catch (err) {
    if (err instanceof EncodingError) {
      return {
        success: false,
        error: { category: 'validation', message: err.message },
        metrics: { durationMs: durationMs() },
      };
    }
    throw err;
  }

  const args = deps.pythonPath === 'py'
    ? ['-3', deps.runnerPath, tool.directory, tool.entryPoint]
    : [deps.runnerPath, tool.directory, tool.entryPoint];
  const command = deps.pythonPath === 'py' ? 'py' : deps.pythonPath;

  const sub = await runSubprocess({
    command,
    args,
    stdin: envelope,
    timeoutMs: request.timeoutMs ?? 300_000,
    maxOutputBytes: 100 * 1024 * 1024,
  });

  if (sub.kind === 'timeout') {
    return {
      success: false,
      error: { category: 'timeout', message: 'tool exceeded timeout' },
      metrics: { durationMs: durationMs() },
    };
  }
  if (sub.kind === 'spawn_error') {
    return {
      success: false,
      error: { category: 'subprocess_crash', message: sub.message },
      metrics: { durationMs: durationMs() },
    };
  }
  if (sub.kind === 'output_too_large') {
    return {
      success: false,
      error: { category: 'output_mismatch', message: 'stdout exceeded 100 MB cap', stderr: sub.stderr },
      metrics: { durationMs: durationMs() },
    };
  }

  if (sub.exitCode !== 0 && sub.exitCode !== 1) {
    return {
      success: false,
      error: {
        category: 'subprocess_crash',
        message: `runner exited with code ${sub.exitCode}`,
        stderr: sub.stderr,
      },
      metrics: { durationMs: durationMs() },
    };
  }

  let parsed: { ok: boolean; outputs?: Record<string, unknown>; error?: { message: string; type: string } };
  try {
    parsed = JSON.parse(sub.stdout);
  } catch {
    return {
      success: false,
      error: {
        category: 'output_mismatch',
        message: `runner stdout is not valid JSON (exit ${sub.exitCode})`,
        stderr: sub.stderr,
      },
      metrics: { durationMs: durationMs() },
    };
  }

  if (sub.exitCode === 1 || parsed.ok === false) {
    return {
      success: false,
      error: {
        category: 'runtime',
        message: parsed.error?.message ?? 'tool raised an error',
        stderr: sub.stderr,
      },
      metrics: { durationMs: durationMs() },
    };
  }

  const rawOutputs = parsed.outputs ?? {};
  const missing = tool.outputs.filter((p) => !(p.name in rawOutputs));
  if (missing.length > 0) {
    return {
      success: false,
      error: {
        category: 'output_mismatch',
        message: `runner omitted output ports: ${missing.map((p) => p.name).join(', ')}`,
      },
      metrics: { durationMs: durationMs() },
    };
  }
  const extras = Object.keys(rawOutputs).filter((k) => !tool.outputs.some((p) => p.name === k));
  if (extras.length > 0) {
    return {
      success: false,
      error: {
        category: 'output_mismatch',
        message: `runner emitted unknown output ports: ${extras.join(', ')}`,
      },
      metrics: { durationMs: durationMs() },
    };
  }

  // Use the requesting node name for handle provenance, fall back to tool name.
  const nodeNameForHandles = request.callerContext?.nodeName ?? tool.name;
  const outputs = decodeOutputs(rawOutputs, outputSchemas, deps.schemas, valueStore, nodeNameForHandles, '');
  return { success: true, outputs, metrics: { durationMs: durationMs() } };
}

function validateInputs(tool: ToolRecord, inputs: Record<string, unknown>): string | null {
  const declared = new Set(tool.inputs.map((p) => p.name));
  for (const port of tool.inputs) {
    if (port.required && !(port.name in inputs) && port.default === undefined) {
      return `required input "${port.name}" is missing`;
    }
  }
  for (const name of Object.keys(inputs)) {
    if (!declared.has(name)) {
      return `unknown input port: ${name}`;
    }
  }
  return null;
}
```

- [ ] **Step 2: Run existing executor tests — confirm no regression**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/executor.test.ts 2>&1 | tail -20
```

Expected: all pre-existing tests pass. Integration tests self-skip if Python unavailable.

- [ ] **Step 3: Typecheck**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/registry/execution/executor.ts
git commit -m "nr-phase-2: thread ValueStore through invokeTool (optional, backward compat)"
```

---

## Task 6: Update `RegistryClient.invoke()` to accept and pass `valueStore`

**Files:**
- Extend: `packages/server/src/modules/registry/registry-client.ts`

`RegistryClient.invoke()` currently does not take a value store. Phase 2 adds an optional second parameter so the DAG executor can pass the run-level store.

- [ ] **Step 1: Extend `InvocationRequest` or add an overload**

The cleanest approach is to add `valueStore?: ValueStore | null` directly to `InvocationRequest` in `types.ts` — but that would leak an internal class into the public type. Instead, add an optional second parameter to `invoke()` in `registry-client.ts` only.

In `packages/server/src/modules/registry/registry-client.ts`:

1. Import `ValueStore`.
2. Change the signature of `invoke` to:
   ```typescript
   async invoke(request: InvocationRequest, valueStore?: ValueStore | null): Promise<InvocationResult>
   ```
3. Pass `valueStore ?? null` into `invokeTool` via `ExecutorDeps`.

Find and update the `invoke` method (around line 379):

```typescript
import { ValueStore } from './execution/value-store.js';

// ... existing imports ...

  async invoke(request: InvocationRequest, valueStore?: ValueStore | null): Promise<InvocationResult> {
    const tool = this.get(request.toolName, request.version);
    if (!tool) {
      return {
        success: false,
        error: {
          category: 'tool_not_found',
          message: `tool ${request.toolName}${request.version ? ` v${request.version}` : ''} not found`,
        },
        metrics: { durationMs: 0 },
      };
    }
    return invokeTool(
      {
        schemas: this.schemas,
        runnerPath: this.layout.runnerPath,
        pythonPath: this.resolvedPythonPath,
        valueStore: valueStore ?? null,
      },
      tool,
      request,
    );
  }
```

- [ ] **Step 2: Run existing tests — confirm no regression**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/executor.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/registry/registry-client.ts
git commit -m "nr-phase-2: add optional valueStore param to RegistryClient.invoke()"
```

---

## Task 7: Runner protocol — `value_refs` input + `_summary` output

**Files:**
- Extend: `packages/server/src/modules/registry/python/runner.py`

This task updates the Python runner to:
1. Read `value_refs: {handle: envelope}` from the stdin envelope.
2. When decoding inputs: if an input value is `{_type: "value_ref", _handle: "..."}`, look up the handle in `value_refs` and use that envelope.
3. When encoding outputs for pickle schemas: compute a small summary and emit it as `_summary`.

No TypeScript tests for this — it is validated end-to-end in Task 8 (integration tests). The runner changes are isolated to `runner.py`.

- [ ] **Step 1: Replace `runner.py` with the extended version**

`packages/server/src/modules/registry/python/runner.py`:

```python
#!/usr/bin/env python3
"""
Plurics tool runner.

Usage: python runner.py <tool_dir> <entry_point>
  tool_dir    - absolute path to a tool version directory (contains tool.py)
  entry_point - "tool.py:run" (module file + function name)

Protocol:
  stdin  - JSON envelope:
             {
               "inputs":         { port_name: value, ... },
               "input_schemas":  { port_name: schema_name, ... },
               "output_schemas": { port_name: schema_name, ... },
               "value_refs":     { handle: { "_schema":..., "_encoding":"pickle_b64", "_data":... }, ... }
             }
             Inputs whose value is { "_type": "value_ref", "_handle": "..." } are resolved
             by looking up the handle in value_refs before calling the tool function.

  stdout - JSON envelope:
             on success (exit 0):    { "ok": true, "outputs": { ... } }
             on tool error (exit 1): { "ok": false, "error": {...} }
             on runner error (exit 2): empty stdout, stderr carries details

Structured schemas listed in PICKLE_SCHEMAS are transported as
  { "_schema": name, "_encoding": "pickle_b64", "_data": base64 }
on both sides. For output ports with structured schemas, the runner also
emits a compact summary as "_summary" (computed by _make_summary).

This file is shipped with the Plurics server and copied to
~/.plurics/registry/runner.py at first initialization. Do not edit the
copy; edit the source in packages/server/src/modules/registry/python/.
"""

import sys
import json
import base64
import pickle
import traceback
import importlib.util
from pathlib import Path


PICKLE_SCHEMAS = {"NumpyArray", "DataFrame"}


def _make_summary(schema_name, value):
    """Compute a compact human-readable summary of a structured value.

    Returns a dict or None. Never raises — any failure returns None so that
    a summary failure does not fail the tool invocation.
    """
    try:
        if schema_name == "NumpyArray":
            return {
                "shape": list(value.shape),
                "ndim": int(value.ndim),
                "size": int(value.size),
                "dtype": str(value.dtype),
                "sample": value.flat[:5].tolist(),
            }
        if schema_name == "DataFrame":
            return {
                "shape": list(value.shape),
                "columns": list(value.columns),
                "head": value.head(5).to_dict("records"),
                "stats": value.describe().to_dict(),
            }
    except Exception:
        return None
    return None


def decode_value(raw, schema_name, value_refs):
    """Decode a single input value.

    If raw is a value_ref, look up the handle in value_refs and decode from
    the resolved envelope. Otherwise fall through to the standard path.
    """
    if isinstance(raw, dict) and raw.get("_type") == "value_ref":
        handle = raw.get("_handle", "")
        envelope = value_refs.get(handle)
        if envelope is None:
            raise ValueError("handle_not_found: %s" % handle)
        if not isinstance(envelope, dict) or envelope.get("_encoding") != "pickle_b64":
            raise ValueError(
                "value_ref envelope for handle %s is not a valid pickle_b64 envelope" % handle
            )
        return pickle.loads(base64.b64decode(envelope["_data"]))

    if schema_name in PICKLE_SCHEMAS:
        if not isinstance(raw, dict) or raw.get("_encoding") != "pickle_b64":
            raise ValueError(
                "port with schema %s expects pickle_b64 envelope, got: %s"
                % (schema_name, type(raw).__name__)
            )
        return pickle.loads(base64.b64decode(raw["_data"]))
    return raw


def encode_value(value, schema_name):
    if schema_name in PICKLE_SCHEMAS:
        encoded = {
            "_schema": schema_name,
            "_encoding": "pickle_b64",
            "_data": base64.b64encode(pickle.dumps(value)).decode("ascii"),
        }
        summary = _make_summary(schema_name, value)
        if summary is not None:
            encoded["_summary"] = summary
        return encoded
    return value


def load_entry_point(tool_dir, entry_point):
    if ":" not in entry_point:
        raise ValueError("entry_point must be 'file.py:function', got: %s" % entry_point)
    module_file, func_name = entry_point.split(":", 1)
    module_path = tool_dir / module_file
    if not module_path.is_file():
        raise FileNotFoundError("entry point file not found: %s" % module_path)
    spec = importlib.util.spec_from_file_location("plurics_tool", module_path)
    if spec is None or spec.loader is None:
        raise ImportError("cannot load spec from %s" % module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, func_name):
        raise AttributeError("%s has no function %r" % (module_file, func_name))
    return getattr(module, func_name)


def emit_error(exc_type, message, tb):
    sys.stdout.write(json.dumps({
        "ok": False,
        "error": {"type": exc_type, "message": message, "traceback": tb},
    }))


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: runner.py <tool_dir> <entry_point>\n")
        return 2

    tool_dir = Path(sys.argv[1])
    entry_point = sys.argv[2]

    try:
        envelope = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        sys.stderr.write("malformed stdin JSON: %s\n" % e)
        return 2

    raw_inputs = envelope.get("inputs") or {}
    input_schemas = envelope.get("input_schemas") or {}
    output_schemas = envelope.get("output_schemas") or {}
    # Phase 2: map of handle -> pickle_b64 envelope for resolving value_refs in inputs
    value_refs = envelope.get("value_refs") or {}

    try:
        fn = load_entry_point(tool_dir, entry_point)
    except Exception as e:
        sys.stderr.write("load failed: %s\n%s" % (e, traceback.format_exc()))
        return 2

    try:
        decoded = {
            name: decode_value(raw_inputs[name], input_schemas.get(name, "JsonObject"), value_refs)
            for name in raw_inputs
        }
    except Exception as e:
        emit_error("input_decode_error", str(e), traceback.format_exc())
        return 1

    try:
        result = fn(**decoded)
    except Exception as e:
        emit_error(type(e).__name__, str(e), traceback.format_exc())
        return 1

    if not isinstance(result, dict):
        emit_error(
            "output_type_error",
            "tool must return dict, got %s" % type(result).__name__,
            "",
        )
        return 1

    try:
        encoded = {
            name: encode_value(result[name], output_schemas.get(name, "JsonObject"))
            for name in result
        }
    except Exception as e:
        emit_error("output_encode_error", str(e), traceback.format_exc())
        return 1

    sys.stdout.write(json.dumps({"ok": True, "outputs": encoded}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run existing Python-backed executor integration tests**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/executor.test.ts 2>&1 | tail -15
```

Expected: all existing tests pass (integration tests self-skip if Python unavailable). No regressions.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/python/runner.py
git commit -m "nr-phase-2: extend runner with value_refs input resolution and _summary output"
```

---

## Task 8: Integration test — `numpy_identity` fixture + value store round-trip

**Files:**
- Create: `packages/server/src/modules/registry/__tests__/fixtures/numpy_identity/tool.yaml`
- Create: `packages/server/src/modules/registry/__tests__/fixtures/numpy_identity/tool.py`
- Create: `packages/server/src/modules/registry/execution/__tests__/value-store.integration.test.ts`

This task adds the minimal fixture needed to exercise the full handle round-trip (pickle output → handle → pickle input) and verifies it with an integration test that self-skips when numpy is absent.

- [ ] **Step 1: Create `numpy_identity` fixture**

`packages/server/src/modules/registry/__tests__/fixtures/numpy_identity/tool.yaml`:

```yaml
name: test.numpy_identity
version: 1
description: Pass a NumpyArray through unchanged. Used for value-store round-trip testing.
category: testing
inputs:
  arr:
    schema: NumpyArray
    required: true
outputs:
  arr:
    schema: NumpyArray
implementation:
  language: python
  entry_point: tool.py:run
  requires:
    - numpy
```

`packages/server/src/modules/registry/__tests__/fixtures/numpy_identity/tool.py`:

```python
def run(arr):
    # Identity pass-through — returns the NumpyArray unchanged.
    return {"arr": arr}
```

- [ ] **Step 2: Write the integration test**

`packages/server/src/modules/registry/execution/__tests__/value-store.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RegistryClient } from '../../registry-client.js';
import { ValueStore } from '../value-store.js';
import type { ValueRef } from '../../types.js';

// Use __dirname to avoid CJS/import.meta.url compat issues
const FIXTURES = path.resolve(__dirname, '..', '..', '__tests__', 'fixtures');

function pythonAvailable(): boolean {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

const numpyAvailable = ((): boolean => {
  if (!pythonAvailable()) return false;
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-c', 'import numpy'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
})();

describe.skipIf(!pythonAvailable() || !numpyAvailable)(
  'ValueStore integration — NumpyArray handle round-trip',
  () => {
    let tmpRoot: string;
    let rc: RegistryClient;
    let store: ValueStore;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-vs-int-'));
      rc = new RegistryClient({ rootDir: tmpRoot });
      await rc.initialize();
      store = new ValueStore('test-run', tmpRoot);

      // Register test.numpy_sum
      const sumReg = await rc.register({
        manifestPath: path.join(FIXTURES, 'numpy_sum', 'tool.yaml'),
        caller: 'human',
      });
      expect(sumReg.success).toBe(true);

      // Register test.numpy_identity
      const idReg = await rc.register({
        manifestPath: path.join(FIXTURES, 'numpy_identity', 'tool.yaml'),
        caller: 'human',
      });
      expect(idReg.success).toBe(true);
    });

    afterEach(() => {
      rc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('numpy_sum with valueStore returns a ValueRef, not a raw envelope', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [1, 2, 3, 4] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const arrayOutput = result.outputs['array'];
      expect((arrayOutput as ValueRef)._type).toBe('value_ref');
      expect((arrayOutput as ValueRef)._schema).toBe('NumpyArray');
      expect(typeof (arrayOutput as ValueRef)._handle).toBe('string');
      // Float output is unaffected
      expect(typeof result.outputs['sum']).toBe('number');
    });

    it('resolved handle contains the pickle envelope', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [10, 20, 30] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const ref = result.outputs['array'] as ValueRef;
      const stored = store.resolve(ref._handle);
      expect(stored).not.toBeNull();
      expect(stored!.envelope._encoding).toBe('pickle_b64');
      expect(typeof stored!.envelope._data).toBe('string');
    });

    it('runner emits _summary; ValueRef carries summary with ndim and size', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [1, 2, 3] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const ref = result.outputs['array'] as ValueRef;
      expect(ref._summary).toBeDefined();
      expect(ref._summary!.ndim).toBe(1);
      expect(ref._summary!.size).toBe(3);
    });

    it('numpy_identity accepts a ValueRef and returns a new ValueRef', async () => {
      // Step 1: produce a handle via numpy_sum
      const sumResult = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [5, 10, 15] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(sumResult.success).toBe(true);
      if (!sumResult.success) return;
      const handle1 = (sumResult.outputs['array'] as ValueRef)._handle;

      // Step 2: feed the handle into numpy_identity
      const ref: ValueRef = { _type: 'value_ref', _handle: handle1, _schema: 'NumpyArray' };
      const idResult = await rc.invoke(
        {
          toolName: 'test.numpy_identity',
          inputs: { arr: ref },
          callerContext: { workflowRunId: 'test-run', nodeName: 'id_node', scope: null },
        },
        store,
      );
      expect(idResult.success).toBe(true);
      if (!idResult.success) return;

      const outRef = idResult.outputs['arr'] as ValueRef;
      expect(outRef._type).toBe('value_ref');
      // The identity returns a new handle (new pickle of the same array)
      expect(typeof outRef._handle).toBe('string');
    });

    it('flush then loadRunLevel restores the handle', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [100, 200] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const ref = result.outputs['array'] as ValueRef;
      await store.flush();

      // New store, same runId — should load from disk
      const store2 = new ValueStore('test-run', tmpRoot);
      await store2.loadRunLevel();
      expect(store2.has(ref._handle)).toBe(true);
      expect(store2.resolve(ref._handle)!.envelope._encoding).toBe('pickle_b64');
    });

    it('passing a raw array to a pickle-schema port fails with validation error', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_identity',
          inputs: { arr: [1, 2, 3] },
        },
        store,
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.category).toBe('validation');
      expect(result.error.message).toMatch(/raw pickle/i);
    });

    it('passing an unknown handle fails with validation error', async () => {
      const ghostRef: ValueRef = { _type: 'value_ref', _handle: 'vs-ghost', _schema: 'NumpyArray' };
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_identity',
          inputs: { arr: ghostRef },
        },
        store,
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.category).toBe('validation');
      expect(result.error.message).toMatch(/handle_not_found/i);
    });

    it('numpy_sum without valueStore still returns raw envelope (backward compat)', async () => {
      const result = await rc.invoke({
        toolName: 'test.numpy_sum',
        inputs: { values: [1, 2] },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      // Without valueStore, pickle outputs come back as raw envelopes
      const arrayOutput = result.outputs['array'] as Record<string, unknown>;
      expect(arrayOutput['_encoding']).toBe('pickle_b64');
    });
  },
);
```

- [ ] **Step 3: Run the test — confirm self-skip on this machine**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/value-store.integration.test.ts 2>&1 | tail -10
```

Expected on this Windows machine (no numpy): `0 tests` or all skipped. No failures.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/registry/__tests__/fixtures/numpy_identity/ \
        packages/server/src/modules/registry/execution/__tests__/value-store.integration.test.ts
git commit -m "nr-phase-2: add numpy_identity fixture + value-store integration tests (skipIf no numpy)"
```

---

## Task 9: DAG executor — `ValueStore` per run, `resolveUpstreamRefs`, `flush`

**Files:**
- Extend: `packages/server/src/modules/workflow/dag-executor.ts`

This task wires the value store into the workflow execution loop:
1. Instantiate a `ValueStore` per run in `start()` and `resumeFrom()`.
2. Add `resolveUpstreamRefs()` helper.
3. Pass the store to `registryClient.invoke()` in `dispatchToolNode()`.
4. Call `store.flush()` after each successful tool node.
5. Write `value_ref` and `summary` fields into signal output entries.

- [ ] **Step 1: Import and instantiate ValueStore**

At the top of `dag-executor.ts`, add the import:

```typescript
import { ValueStore } from '../registry/execution/value-store.js';
```

Add a private field to `DagExecutor`:

```typescript
private valueStore: ValueStore | null = null;
```

In the `start()` method, after `this.startedAt = Date.now();` and before `buildNodeGraph()`:

```typescript
this.valueStore = new ValueStore(this.runId, this.workspacePath);
// No-op on first run; loads existing handles on resume (called explicitly there).
```

In `resumeFrom()`, after `(this as { runId: string }).runId = existingRunId;`:

```typescript
this.valueStore = new ValueStore(this.runId, this.workspacePath);
await this.valueStore.loadRunLevel();
```

- [ ] **Step 2: Add `resolveUpstreamRefs()` helper**

Add a private method to `DagExecutor`. This method is called in `dispatchToolNode()` before `registryClient.invoke()` to resolve `${A.outputs.port}` references from upstream signal files into `ValueRef` objects.

```typescript
/**
 * Resolve tool node inputs by substituting ${upstream.outputs.port} references
 * with concrete values (or ValueRef objects) from upstream signals.
 *
 * Phase 2: only handles the case where an upstream signal's output entry has
 * a value_ref field. Literal values and {{CONFIG}} substitutions pass through.
 * Full template resolution (arbitrary expressions) is deferred.
 */
private resolveUpstreamRefs(
  rawInputs: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawInputs)) {
    if (typeof val === 'string' && val.startsWith('${') && val.endsWith('}')) {
      // Parse ${nodeName.outputs.portName}
      const inner = val.slice(2, -1); // "nodeName.outputs.portName"
      const parts = inner.split('.');
      if (parts.length >= 3 && parts[1] === 'outputs') {
        const upstreamNodeName = parts[0];
        const portName = parts.slice(2).join('.');
        const upstreamNode = this.nodes.get(upstreamNodeName);
        if (upstreamNode?.signal?.outputs) {
          const portEntry = upstreamNode.signal.outputs.find(
            (o) => o.path.endsWith(`/${portName}`) || o.path === portName,
          );
          if (portEntry && (portEntry as Record<string, unknown>)['value_ref']) {
            const handle = (portEntry as Record<string, unknown>)['value_ref'] as string;
            const schema = (portEntry as Record<string, unknown>)['schema'] as string ?? 'JsonObject';
            const summary = (portEntry as Record<string, unknown>)['summary'] as import('../registry/types.js').ValueSummary | undefined;
            const ref: import('../registry/types.js').ValueRef = {
              _type: 'value_ref',
              _handle: handle,
              _schema: schema,
            };
            if (summary) ref._summary = summary;
            resolved[key] = ref;
            continue;
          }
        }
      }
    }
    resolved[key] = val;
  }
  return resolved;
}
```

- [ ] **Step 3: Update `dispatchToolNode()` to use store and resolved inputs**

Replace the body of `dispatchToolNode()` with the Phase 2 version:

```typescript
private async dispatchToolNode(
  nodeName: string,
  node: DagNode,
  agentName: string,
  nodeDef: import('./types.js').WorkflowNodeDef | undefined,
): Promise<void> {
  if (!this.registryClient) {
    throw new Error(
      `Node "${nodeName}" has kind:tool but DagExecutor was constructed without a RegistryClient. ` +
      `Pass the registryClient parameter to enable tool node dispatch.`
    );
  }

  const toolName = nodeDef?.tool;
  if (!toolName) {
    throw new Error(`Node "${nodeName}": kind is 'tool' but no tool field in YAML`);
  }

  const rawToolInputs = (nodeDef?.toolInputs as Record<string, unknown>) ?? {};
  // Phase 2: resolve upstream value_ref references
  const toolInputs = this.resolveUpstreamRefs(rawToolInputs);

  let invocationResult;
  try {
    invocationResult = await this.registryClient.invoke(
      {
        toolName,
        inputs: toolInputs,
        callerContext: {
          workflowRunId: this.runId,
          nodeName,
          scope: node.scope,
        },
      },
      this.valueStore,   // Phase 2: pass run-level store
    );
  } catch (err) {
    invocationResult = {
      success: false as const,
      error: {
        category: 'runtime' as const,
        message: (err as Error).message,
        stderr: '',
      },
      metrics: { durationMs: 0 },
    };
  }

  // Phase 2: flush new handles to disk after each tool node
  if (invocationResult.success && this.valueStore) {
    await this.valueStore.flush().catch((e) => {
      console.warn(`[DagExecutor] ValueStore flush failed for node ${nodeName}:`, e);
    });
  }

  const runDir = path.join(this.workspacePath, '.plurics', 'runs', this.runId);
  const signalDir = path.join(runDir, 'signals');
  await fs.mkdir(signalDir, { recursive: true });

  // Phase 2: build output entries that include value_ref + summary for ValueRef outputs
  const outputEntries = invocationResult.success
    ? Object.entries(invocationResult.outputs).map(([k, v]) => {
        const isRef = (v as Record<string, unknown>)?._type === 'value_ref';
        if (isRef) {
          const ref = v as import('../registry/types.js').ValueRef;
          return {
            path: `tool-outputs/${agentName}/${k}`,
            sha256: 'tool-node-phase2-handle',
            size_bytes: 0,
            schema: ref._schema,
            value_ref: ref._handle,
            ...(ref._summary ? { summary: ref._summary } : {}),
          };
        }
        return {
          path: `tool-outputs/${agentName}/${k}`,
          sha256: 'tool-node-phase2-no-hash',
          size_bytes: JSON.stringify(v).length,
        };
      })
    : [];

  const signal: SignalFile = {
    schema_version: 1,
    signal_id: `sig-${Date.now()}-${agentName}-${randomHex(2)}`,
    agent: node.name.split('.')[0],
    scope: node.scope,
    status: invocationResult.success ? 'success' : 'failure',
    decision: null,
    outputs: outputEntries,
    metrics: {
      duration_seconds: invocationResult.metrics.durationMs / 1000,
      retries_used: node.retryCount,
    },
    error: invocationResult.success ? null : {
      category: invocationResult.error.category,
      message: invocationResult.error.message,
      recoverable: false,
    },
  };

  const filename = `${agentName}.done.json`;
  // (rest of the method is unchanged — write signal file, etc.)
```

Note: the rest of the method after the signal construction is unchanged from Phase 1; keep the existing `writeJsonAtomic` / `this.handleSignal` calls as-is.

- [ ] **Step 2: Run full module sweep to check for regressions**

```bash
cd packages/server && npx vitest run src/modules/registry src/modules/workflow src/modules/agents 2>&1 | tail -30
```

Expected: all non-integration tests pass. Integration tests self-skip cleanly.

- [ ] **Step 3: Typecheck**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/workflow/dag-executor.ts
git commit -m "nr-phase-2: wire ValueStore per run into DagExecutor — resolveUpstreamRefs, flush, value_ref signals"
```

---

## Task 10: DAG executor two-node workflow test

**Files:**
- Extend: `packages/server/src/modules/workflow/__tests__/dag-executor.test.ts` (or create if absent)

This test exercises the full two-node chain: `kind: tool` node A (`test.numpy_sum`) → `kind: tool` node B (`test.numpy_identity`) with an upstream ref, verifying that B receives a ValueRef and the signal file contains `value_ref` and `summary` fields.

- [ ] **Step 1: Locate existing DAG executor test file**

```bash
ls packages/server/src/modules/workflow/__tests__/
```

If a `dag-executor.test.ts` or similar exists, append to it. If not, create it.

- [ ] **Step 2: Write the two-node workflow test**

Append (or create) in `packages/server/src/modules/workflow/__tests__/dag-executor-tool-nodes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DagExecutor } from '../dag-executor.js';
import { RegistryClient } from '../../registry/registry-client.js';
import type { WorkflowConfig } from '../types.js';

// Use __dirname — avoid import.meta.url for CJS compat
const FIXTURES = path.resolve(__dirname, '..', '..', 'registry', '__tests__', 'fixtures');

function pythonAvailable(): boolean {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

const numpyAvailable = ((): boolean => {
  if (!pythonAvailable()) return false;
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-c', 'import numpy'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
})();

describe.skipIf(!pythonAvailable() || !numpyAvailable)(
  'DagExecutor — kind:tool two-node value_ref chain (integration)',
  () => {
    let tmpRoot: string;
    let workspacePath: string;
    let rc: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-tool-'));
      workspacePath = path.join(tmpRoot, 'workspace');
      fs.mkdirSync(workspacePath, { recursive: true });

      rc = new RegistryClient({ rootDir: path.join(tmpRoot, 'registry') });
      await rc.initialize();

      await rc.register({ manifestPath: path.join(FIXTURES, 'numpy_sum', 'tool.yaml'), caller: 'human' });
      await rc.register({ manifestPath: path.join(FIXTURES, 'numpy_identity', 'tool.yaml'), caller: 'human' });
    });

    afterEach(() => {
      rc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('node A produces value_ref signal; node B consumes it and produces its own value_ref', async () => {
      // Minimal workflow config with two tool nodes
      const workflowConfig: WorkflowConfig = {
        name: 'test-chain',
        nodes: {
          sum_node: {
            kind: 'tool',
            tool: 'test.numpy_sum',
            toolInputs: { values: [1, 2, 3, 4, 5] },
            dependsOn: [],
          },
          id_node: {
            kind: 'tool',
            tool: 'test.numpy_identity',
            toolInputs: { arr: '${sum_node.outputs.array}' },
            dependsOn: ['sum_node'],
          },
        },
        _yamlPath: '',
      } as unknown as WorkflowConfig;

      // We need stubs for AgentRegistry, AgentBootstrap, PresetRepository
      // Use minimal no-op stubs (same pattern as other dag-executor tests)
      const agentRegistry = { getAgentConfig: () => null } as unknown as import('../../agents/agent-registry.js').AgentRegistry;
      const bootstrap = { setCwd: () => {}, getSystemPrompt: async () => '' } as unknown as import('../../knowledge/agent-bootstrap.js').AgentBootstrap;
      const presetRepo = { findByPath: async () => null } as unknown as import('../../../db/preset-repository.js').PresetRepository;

      const executor = new DagExecutor(
        workflowConfig,
        workspacePath,
        tmpRoot,
        agentRegistry,
        bootstrap,
        presetRepo,
        rc,
      );

      let completed = false;
      executor.setCompleteHandler(() => { completed = true; });

      await executor.start();

      // Wait up to 15s for completion
      const deadline = Date.now() + 15_000;
      while (!completed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(completed).toBe(true);

      // Verify signal file for sum_node contains value_ref
      const runId = executor.runId;
      const signalDir = path.join(workspacePath, '.plurics', 'runs', runId, 'signals');
      const sumSignalPath = path.join(signalDir, 'sum_node.done.json');
      expect(fs.existsSync(sumSignalPath)).toBe(true);
      const sumSignal = JSON.parse(fs.readFileSync(sumSignalPath, 'utf-8'));
      const arrayOutput = sumSignal.outputs.find((o: Record<string, unknown>) =>
        (o['path'] as string).endsWith('/array'),
      );
      expect(arrayOutput).toBeDefined();
      expect(arrayOutput['value_ref']).toBeDefined();
      expect(typeof arrayOutput['value_ref']).toBe('string');
      expect(arrayOutput['summary']).toBeDefined();

      // Verify signal file for id_node also contains value_ref
      const idSignalPath = path.join(signalDir, 'id_node.done.json');
      expect(fs.existsSync(idSignalPath)).toBe(true);
      const idSignal = JSON.parse(fs.readFileSync(idSignalPath, 'utf-8'));
      const idOutput = idSignal.outputs.find((o: Record<string, unknown>) =>
        (o['path'] as string).endsWith('/arr'),
      );
      expect(idOutput).toBeDefined();
      expect(idOutput['value_ref']).toBeDefined();
    });
  },
);
```

- [ ] **Step 3: Run the test — confirm self-skip**

```bash
cd packages/server && npx vitest run src/modules/workflow/__tests__/dag-executor-tool-nodes.test.ts 2>&1 | tail -10
```

Expected: skipped (no numpy on this machine).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/workflow/__tests__/dag-executor-tool-nodes.test.ts
git commit -m "nr-phase-2: add two-node DAG executor tool-node integration test (skipIf no numpy)"
```

---

## Task 11: Phase 2 documentation notes — inline comments

**Files:**
- Extend: `packages/server/src/modules/registry/execution/value-store.ts`
- Extend: `packages/server/src/modules/registry/execution/executor.ts`

No tests — documentation only.

- [ ] **Step 1: Add Phase 2 / Phase 3 note to `value-store.ts`**

The file-level JSDoc comment already mentions Phase 2 scope. Add a targeted comment to the `store()` method noting the stub:

```typescript
// Phase 2 stub: scope-local and run-level are the same Map. Phase 3 will
// introduce a distinct scope-local tier that the tool-calling loop writes to,
// distinct from the run-level tier that persists across scope boundaries within
// a run. The API surface (store() as the single write path) is designed to
// accept a 'scope' parameter in Phase 3 without changing callers.
```

- [ ] **Step 2: Add Phase 2 note to `executor.ts`**

In the `ExecutorDeps` interface JSDoc comment for `valueStore`:

```typescript
// Phase 2: tool nodes pass the run-level ValueStore from DagExecutor.
// Phase 3: reasoning nodes will pass a scope-local store aliased to the
// run-level store (no behavioral change until NR Phase 3's tool-calling loop).
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/execution/value-store.ts \
        packages/server/src/modules/registry/execution/executor.ts
git commit -m "nr-phase-2: add inline Phase 2 scope-stub comments pointing at Phase 3"
```

---

## Task 12: Full module sweep — regression gate

**Files:** None (test run only)

- [ ] **Step 1: Run the full registry + workflow + agents module sweep**

```bash
cd packages/server && npx vitest run src/modules/registry src/modules/workflow src/modules/agents 2>&1 | tail -40
```

Expected: all unit tests pass; integration tests self-skip cleanly on this machine. Zero unexpected failures.

- [ ] **Step 2: Run TypeScript compilation check**

```bash
cd packages/server && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: If any failure — investigate and fix before marking complete**

Do not proceed to commit if there are failures. Apply `superpowers:systematic-debugging` for any unexpected failure.

- [ ] **Step 4: Commit sweep result note**

If the sweep passes cleanly:

```bash
git commit --allow-empty -m "nr-phase-2: full module sweep green — no regressions"
```

---

## Task 13: Seed tools smoke test — pandas tools now invokable (skipIf)

**Files:**
- Create: `packages/server/src/modules/registry/execution/__tests__/pandas-tools.integration.test.ts`

The four seed tools that accept `DataFrame` inputs (`pandas.load_csv`, `pandas.describe`, `pandas.filter_rows`, `pandas.select_columns`) should now be invokable end-to-end. This test verifies the chain: `pandas.load_csv` → `pandas.describe` using handle passing. Self-skips if pandas is absent.

- [ ] **Step 1: Check that seed tool fixtures are registered on initialize**

```bash
grep -r "pandas\." packages/server/src/modules/registry/ --include="*.ts" -l | head -5
```

The seed tools should be auto-registered at `initialize()`. Confirm by reading `registry-client.ts` init logic if needed.

- [ ] **Step 2: Write the integration test**

`packages/server/src/modules/registry/execution/__tests__/pandas-tools.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RegistryClient } from '../../registry-client.js';
import { ValueStore } from '../value-store.js';
import type { ValueRef } from '../../types.js';

function pythonAvailable(): boolean {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

function libAvailable(lib: string): boolean {
  if (!pythonAvailable()) return false;
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-c', `import ${lib}`], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

const pandasAvailable = libAvailable('pandas');

describe.skipIf(!pythonAvailable() || !pandasAvailable)(
  'Seed tools — pandas handle chain (integration)',
  () => {
    let tmpRoot: string;
    let rc: RegistryClient;
    let store: ValueStore;
    let csvPath: string;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-pandas-'));
      // Write a small CSV fixture
      csvPath = path.join(tmpRoot, 'test.csv');
      fs.writeFileSync(csvPath, 'a,b,c\n1,2,3\n4,5,6\n7,8,9\n', 'utf-8');

      rc = new RegistryClient({ rootDir: path.join(tmpRoot, 'registry') });
      await rc.initialize();
      store = new ValueStore('test-run', tmpRoot);
    });

    afterEach(() => {
      rc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('pandas.load_csv returns a ValueRef with DataFrame summary', async () => {
      const result = await rc.invoke(
        {
          toolName: 'pandas.load_csv',
          inputs: { path: csvPath },
          callerContext: { workflowRunId: 'test-run', nodeName: 'load_csv', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error('pandas.load_csv failed:', result.error);
        return;
      }
      const dfRef = result.outputs['df'] as ValueRef;
      expect(dfRef._type).toBe('value_ref');
      expect(dfRef._schema).toBe('DataFrame');
      expect(dfRef._summary?.shape).toEqual([3, 3]);
      expect(dfRef._summary?.columns).toContain('a');
    });

    it('pandas.load_csv → pandas.describe handle chain succeeds', async () => {
      // Step 1: load CSV
      const loadResult = await rc.invoke(
        {
          toolName: 'pandas.load_csv',
          inputs: { path: csvPath },
          callerContext: { workflowRunId: 'test-run', nodeName: 'load_csv', scope: null },
        },
        store,
      );
      expect(loadResult.success).toBe(true);
      if (!loadResult.success) return;

      const dfRef = loadResult.outputs['df'] as ValueRef;

      // Step 2: describe using the handle
      const descResult = await rc.invoke(
        {
          toolName: 'pandas.describe',
          inputs: { df: dfRef },
          callerContext: { workflowRunId: 'test-run', nodeName: 'describe', scope: null },
        },
        store,
      );
      expect(descResult.success).toBe(true);
      if (!descResult.success) {
        console.error('pandas.describe failed:', descResult.error);
        return;
      }
      // describe() returns a DataFrame (stats)
      const statsRef = descResult.outputs['description'] as ValueRef;
      expect(statsRef._type).toBe('value_ref');
      expect(statsRef._schema).toBe('DataFrame');
    });
  },
);
```

- [ ] **Step 3: Run — confirm self-skip**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/pandas-tools.integration.test.ts 2>&1 | tail -10
```

Expected: all skipped (no pandas on this machine).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/registry/execution/__tests__/pandas-tools.integration.test.ts
git commit -m "nr-phase-2: add pandas seed tool handle-chain integration test (skipIf no pandas)"
```

---

## Task 14: Final sweep and PR readiness

**Files:** None (verification only)

- [ ] **Step 1: Full test suite**

```bash
cd packages/server && npx vitest run 2>&1 | tail -40
```

Expected: no failures. Integration suites self-skip.

- [ ] **Step 2: TypeScript clean**

```bash
cd packages/server && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Summarize changed files for review**

Key files changed in this slice:

| File | Change |
|---|---|
| `registry/types.ts` | + `ValueRef`, `ValueEnvelope`, `ValueSummary`, `StoredValue`, `Summarizer` |
| `registry/execution/value-store.ts` | NEW — `ValueStore` class |
| `registry/schemas/builtin.ts` | + `summarizer` on `NumpyArray`, `DataFrame` |
| `registry/schemas/schema-registry.ts` | + `getSummarizer()` |
| `registry/execution/encoding.ts` | Extended `encodeInputs`, `decodeOutputs`, `buildEnvelope` |
| `registry/execution/executor.ts` | + optional `valueStore` in `ExecutorDeps`, threaded through |
| `registry/registry-client.ts` | + optional `valueStore` param on `invoke()` |
| `registry/python/runner.py` | + `value_refs` resolution, `_make_summary`, `_summary` in outputs |
| `workflow/dag-executor.ts` | + `ValueStore` per run, `resolveUpstreamRefs`, flush, value_ref signals |
| Test fixtures | + `numpy_identity/` |
| Tests | + `value-store.test.ts`, `.integration.test.ts`, `builtin.test.ts`, `pandas-tools.integration.test.ts`, `dag-executor-tool-nodes.test.ts` |

- [ ] **Step 4: Invoke `superpowers:verification-before-completion` before marking done**

---

## Appendix: Error Matrix Additions

Two new errors are introduced in Phase 2 (both category `validation`):

| Trigger | Message |
|---|---|
| Raw JS value passed for a `pickle_b64`-schema port | `"raw pickle inputs are not supported — use a value handle (input \"...\" has schema \"...\")"` |
| `ValueRef` with a handle not found in the provided `ValueStore` | `"handle_not_found: {handle} (input \"...\")"` |

Both are caught in `encodeInputs` before the subprocess is spawned, so they surface as `validation` errors (not `subprocess_crash`), consistent with the spec §13.

---

## Appendix: Backward Compatibility Checklist

- `RegistryClient.invoke(request)` with no `valueStore` — pickle outputs come back as raw envelopes. Unchanged from Phase 1+2. ✓
- `invokeTool(deps, tool, request)` with `deps.valueStore` absent — same as passing `null`. ✓
- Runner `stdin` without `value_refs` — defaults to `{}`, no change to existing tools. ✓
- Runner `stdout` gains optional `_summary` — existing TypeScript parsers must tolerate unknown keys (they do). ✓
- Signal files gain optional `value_ref`/`summary` fields on output entries — existing consumers must tolerate new fields (they do). ✓
- `encodeInputs` signature changes from `(values, schemas, registry)` to `(values, schemas, registry, valueStore|null)` — callers that do not pass `valueStore` must be updated or will get a TypeScript error. Affected callers: `executor.ts` only (internal). The public API is through `RegistryClient.invoke()`. ✓

---

*Plan written: 2026-04-11 22:02 UTC. Source of truth: `docs/superpowers/specs/2026-04-11-node-runtimes-phase-2-design.md`.*
