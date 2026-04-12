# UI Backend Implementation Plan: REST Endpoints + WebSocket Message Types

**Date:** 2026-04-12
**Status:** Ready for execution
**Spec:** `docs/superpowers/specs/2026-04-12-ui-backend-design.md`
**Branch:** `feat/ui-backend`

---

## Overview

18 tasks grouped into four categories:

- **Tasks 1–7**: Registry REST endpoints (13 new endpoints, RegistryClient extensions)
- **Tasks 8–12**: Run REST endpoints (alias + new)
- **Tasks 13–15**: WebSocket message types (5 new)
- **Tasks 16–17**: Findings REST endpoints
- **Task 18**: Integration sweep

All work is in `packages/server/`. No frontend changes.

---

## Task 1 — Add types to `types.ts` and extend RegistryClient public surface (Part 1)

**Category:** Registry endpoints
**Files:** `packages/server/src/modules/registry/types.ts`, `packages/server/src/modules/registry/registry-client.ts`
**Depends on:** nothing

### What to add to `types.ts`

```typescript
export interface CategorySummary {
  name: string;         // null category stored as 'Uncategorized'
  toolCount: number;
  versions: number;
}

export interface TestRunResult {
  toolName: string;
  version: number;
  passed: number;
  failed: number;
  errors: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}
```

### What to add to `RegistryClient`

Add `listTools(filters?: ListFilters): ToolRecord[]` as a thin public wrapper over the private `this.db.listTools(filters)`. The `RegistryDb.listTools` method already exists (used in tests) — verify its signature, then add the public pass-through.

```typescript
listTools(filters?: ListFilters): ToolRecord[] {
  this.assertInitialized();
  return this.db.listTools(filters ?? {});
}
```

Add `getTool(name: string, version: number): ToolRecord | null` — wraps existing `this.db.getTool(name, version)`.

```typescript
getTool(name: string, version: number): ToolRecord | null {
  this.assertInitialized();
  return this.db.getTool(name, version);
}
```

Add `getToolsByName(name: string): ToolRecord[]`:

```typescript
getToolsByName(name: string): ToolRecord[] {
  this.assertInitialized();
  return this.db.getToolsByName(name);
}
```

`RegistryDb.getToolsByName` must be added if absent (see Task 2).

### Verification

- TypeScript compiles without errors: `pnpm --filter server tsc --noEmit`
- Existing tests pass: `pnpm --filter server test`

---

## Task 2 — Add missing RegistryDb methods

**Category:** Registry endpoints
**Files:** `packages/server/src/modules/registry/storage/db.ts`
**Depends on:** Task 1 (to verify method signatures)

### Methods to add

Verify each of the following exists; add it if absent.

#### `getToolsByName(name: string): ToolRecord[]`

```typescript
getToolsByName(name: string): ToolRecord[] {
  const db = this.raw();
  const rows = db.prepare(
    `SELECT t.*, p.direction, p.port_name, p.schema_name, p.required, p.default_json, p.description, p.position
     FROM tools t
     LEFT JOIN tool_ports p ON p.tool_id = t.id
     WHERE t.name = ?
     ORDER BY t.version DESC, p.direction, p.position`
  ).all(name);
  return this.groupToolRows(rows as (ToolRow & PortRow)[]);
}
```

(Reuse the same row-grouping logic used by `getTool` / `listTools`.)

#### `listConverters(): ConverterRecord[]`

```typescript
listConverters(): ConverterRecord[] {
  return (this.raw()
    .prepare('SELECT source_schema, target_schema, tool_name, tool_version FROM converters ORDER BY source_schema, target_schema')
    .all() as Array<{ source_schema: string; target_schema: string; tool_name: string; tool_version: number }>)
    .map(r => ({ sourceSchema: r.source_schema, targetSchema: r.target_schema, toolName: r.tool_name, toolVersion: r.tool_version }));
}
```

#### `getConverter(sourceSchema: string, targetSchema: string): ConverterRecord | null`

```typescript
getConverter(sourceSchema: string, targetSchema: string): ConverterRecord | null {
  const row = this.raw()
    .prepare('SELECT source_schema, target_schema, tool_name, tool_version FROM converters WHERE source_schema = ? AND target_schema = ?')
    .get(sourceSchema, targetSchema) as { source_schema: string; target_schema: string; tool_name: string; tool_version: number } | undefined;
  if (!row) return null;
  return { sourceSchema: row.source_schema, targetSchema: row.target_schema, toolName: row.tool_name, toolVersion: row.tool_version };
}
```

#### `searchTools(query: string): ToolRecord[]`

```typescript
searchTools(query: string): ToolRecord[] {
  const q = `%${query}%`;
  const ids = (this.raw()
    .prepare(`SELECT DISTINCT id FROM tools WHERE name LIKE ? OR description LIKE ? OR tags_json LIKE ?`)
    .all(q, q, q) as Array<{ id: number }>).map(r => r.id);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = this.raw()
    .prepare(`SELECT t.*, p.direction, p.port_name, p.schema_name, p.required, p.default_json, p.description, p.position
              FROM tools t
              LEFT JOIN tool_ports p ON p.tool_id = t.id
              WHERE t.id IN (${placeholders})
              ORDER BY t.name, t.version DESC, p.direction, p.position`)
    .all(...ids);
  return this.groupToolRows(rows as (ToolRow & PortRow)[]);
}
```

#### `listCategories(): CategorySummary[]`

```typescript
listCategories(): CategorySummary[] {
  return (this.raw()
    .prepare(`SELECT COALESCE(category, 'Uncategorized') as name, COUNT(DISTINCT name) as toolCount, COUNT(*) as versions
              FROM tools WHERE status = 'active' GROUP BY category ORDER BY name`)
    .all() as Array<{ name: string; toolCount: number; versions: number }>);
}
```

### Add public pass-throughs to RegistryClient

After Task 2 adds the db methods, add these to `registry-client.ts`:

```typescript
listConverters(): ConverterRecord[] {
  this.assertInitialized();
  return this.db.listConverters();
}

getConverter(src: string, tgt: string): ConverterRecord | null {
  this.assertInitialized();
  return this.db.getConverter(src, tgt);
}

searchTools(query: string): ToolRecord[] {
  this.assertInitialized();
  return this.db.searchTools(query);
}

listCategories(): CategorySummary[] {
  this.assertInitialized();
  return this.db.listCategories();
}
```

Import `CategorySummary` and `ConverterRecord` from `./types.js`.

### Verification

- `pnpm --filter server tsc --noEmit`
- `pnpm --filter server test` (all registry tests pass)

---

## Task 3 — Add `runTests` to RegistryClient

**Category:** Registry endpoints
**Files:** `packages/server/src/modules/registry/registry-client.ts`
**Depends on:** Task 1 (for `TestRunResult` type)

The `run_tests` endpoint (spec §4.6) needs to execute `pytest` or the runner against the tool's `tests.py`.

```typescript
async runTests(name: string, version: number): Promise<TestRunResult> {
  this.assertInitialized();
  const record = this.db.getTool(name, version);
  if (!record) throw new Error(`tool not found: ${name} v${version}`);
  const testsPath = path.join(record.directory, 'tests.py');
  if (!fs.existsSync(testsPath)) {
    return { toolName: name, version, passed: 0, failed: 0, errors: 0, durationMs: 0, stdout: '', stderr: 'tests.py not found' };
  }
  const python = this.resolvedPythonPath;
  if (!python) {
    throw new Error('python_unavailable');
  }
  const start = Date.now();
  const result = spawnSync(python, ['-m', 'pytest', testsPath, '--tb=short', '-q'], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: record.directory,
  });
  const durationMs = Date.now() - start;
  // Parse pytest summary line: "X passed, Y failed, Z error in N.NNs"
  const stdout = result.stdout ?? '';
  const passedMatch = stdout.match(/(\d+) passed/);
  const failedMatch = stdout.match(/(\d+) failed/);
  const errorsMatch = stdout.match(/(\d+) error/);
  return {
    toolName: name,
    version,
    passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
    failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
    errors: errorsMatch ? parseInt(errorsMatch[1], 10) : 0,
    durationMs,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
```

### Verification

- `pnpm --filter server tsc --noEmit`
- Manual test: `POST /api/registry/tools/descriptive_statistics.summary/1/run_tests` on a dev server

---

## Task 4 — Registry list/detail endpoints

**Category:** Registry endpoints
**Files:** `packages/server/src/app.ts` (or new `packages/server/src/routes/registry.ts`)
**Depends on:** Tasks 1, 2

Add the following endpoints using the `{ data: T }` envelope:

```
GET /api/registry/tools
GET /api/registry/tools/:name
GET /api/registry/tools/:name/:version
GET /api/registry/schemas
GET /api/registry/schemas/:name
GET /api/registry/converters
GET /api/registry/converters/:source/:target
GET /api/registry/categories
```

### Implementation pattern

Each handler follows:
1. Parse and validate path/query params (return 400 on invalid).
2. Call the appropriate `toolRegistry.*` method.
3. Return `res.json({ data: result })` on success or `res.status(404).json({ error: { code: 'not_found', message: '...' } })`.

### `GET /api/registry/tools` detail

```typescript
app.get('/api/registry/tools', (req, res) => {
  const filters: ListFilters = {};
  if (req.query.category) filters.category = req.query.category as string;
  if (req.query.tags) filters.tags = (req.query.tags as string).split(',');
  if (req.query.status) filters.statusIn = [(req.query.status as string) as ToolStatus];
  const tools = toolRegistry.listTools(filters);
  // Group by name, keep only latest version per name for the summary
  const byName = new Map<string, ToolRecord>();
  const versionCount = new Map<string, number>();
  for (const t of tools) {
    const existing = byName.get(t.name);
    if (!existing || t.version > existing.version) byName.set(t.name, t);
    versionCount.set(t.name, (versionCount.get(t.name) ?? 0) + 1);
  }
  const result = [...byName.values()].map(t => ({
    name: t.name, version: t.version, description: t.description,
    category: t.category, tags: t.tags, stability: t.stability,
    costClass: t.costClass, status: t.status,
    versionCount: versionCount.get(t.name) ?? 1,
  }));
  res.json({ data: { tools: result, total: result.length } });
});
```

### Verification

- `pnpm --filter server tsc --noEmit`
- `curl http://localhost:11001/api/registry/tools` returns `{ data: { tools: [...], total: N } }`
- `curl http://localhost:11001/api/registry/schemas` returns schema list

---

## Task 5 — Registry source/tests file endpoints

**Category:** Registry endpoints
**Files:** `packages/server/src/app.ts` (or `routes/registry.ts`)
**Depends on:** Task 4

```typescript
app.get('/api/registry/tools/:name/:version/source', (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  const record = toolRegistry.getTool(req.params.name, version);
  if (!record) { res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return; }
  const [entryFile] = record.entryPoint.split(':');
  const sourcePath = path.join(record.directory, entryFile);
  try {
    const content = fs.readFileSync(sourcePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: { code: 'not_found', message: 'Source file not found' } });
  }
});

app.get('/api/registry/tools/:name/:version/tests', (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  const record = toolRegistry.getTool(req.params.name, version);
  if (!record) { res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return; }
  const testsPath = path.join(record.directory, 'tests.py');
  try {
    const content = fs.readFileSync(testsPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: { code: 'not_found', message: 'tests.py not found' } });
  }
});
```

### Verification

- `curl http://localhost:11001/api/registry/tools/descriptive_statistics.summary/1/source` returns Python source
- `curl http://localhost:11001/api/registry/tools/descriptive_statistics.summary/1/tests` returns test source or 404

---

## Task 6 — Registry run_tests and invocations endpoints

**Category:** Registry endpoints
**Files:** `packages/server/src/app.ts` (or `routes/registry.ts`)
**Depends on:** Task 3

```typescript
app.post('/api/registry/tools/:name/:version/run_tests', async (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  if (!toolRegistry.getTool(req.params.name, version)) {
    res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return;
  }
  try {
    const result = await toolRegistry.runTests(req.params.name, version);
    res.status(202).json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'python_unavailable') {
      res.status(503).json({ error: { code: 'python_unavailable', message: 'Python interpreter not available' } });
    } else {
      res.status(500).json({ error: { code: 'internal', message: msg } });
    }
  }
});

app.get('/api/registry/tools/:name/:version/invocations', (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  if (!toolRegistry.getTool(req.params.name, version)) {
    res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return;
  }
  res.json({ data: { toolName: req.params.name, version, invocations: [], note: 'invocation logging not yet enabled' } });
});
```

### Verification

- `POST /api/registry/tools/some_tool/1/run_tests` returns 202 with test result JSON
- `GET /api/registry/tools/some_tool/1/invocations` returns `{ data: { invocations: [], note: ... } }`

---

## Task 7 — Registry search and categories endpoints

**Category:** Registry endpoints
**Files:** `packages/server/src/app.ts` (or `routes/registry.ts`)
**Depends on:** Task 2

```typescript
app.get('/api/registry/search', (req, res) => {
  const q = (req.query.q as string) ?? '';
  if (q.length < 2) {
    res.status(400).json({ error: { code: 'bad_request', message: 'q must be at least 2 characters' } }); return;
  }
  const tools = toolRegistry.searchTools(q);
  const results = tools.map(t => ({
    name: t.name, version: t.version, description: t.description,
    category: t.category, tags: t.tags,
    matchedFields: ([
      t.name.includes(q) ? 'name' : null,
      t.description?.includes(q) ? 'description' : null,
      t.tags.some(tag => tag.includes(q)) ? 'tags' : null,
    ].filter(Boolean) as ('name' | 'description' | 'tags')[]),
  }));
  res.json({ data: { query: q, results, total: results.length } });
});

app.get('/api/registry/categories', (_req, res) => {
  const categories = toolRegistry.listCategories();
  res.json({ data: { categories, total: categories.length } });
});
```

### Verification

- `GET /api/registry/search?q=stat` returns matching tools
- `GET /api/registry/categories` returns category list with counts
- `GET /api/registry/search?q=x` returns 400

---

## Task 8 — `GET /api/runs` and `GET /api/runs/:runId` (alias)

**Category:** Run endpoints
**Files:** `packages/server/src/app.ts`
**Depends on:** nothing (reads from `workflowRepo`)

Add `/api/runs` and `/api/runs/:runId` as aliases alongside the existing `/api/workflows` routes. Do not remove the existing routes.

```typescript
// Alias: GET /api/runs
app.get('/api/runs', (req, res) => {
  let runs = workflowRepo.listRuns();
  if (req.query.status) runs = runs.filter(r => r.status === req.query.status);
  if (req.query.workflow) runs = runs.filter(r => r.workflow_name === req.query.workflow);
  const limit = parseInt((req.query.limit as string) ?? '100', 10);
  const offset = parseInt((req.query.offset as string) ?? '0', 10);
  const page = runs.slice(offset, offset + limit);
  res.json({ data: { runs: page, total: runs.length } });
});

// Alias: GET /api/runs/:runId
app.get('/api/runs/:runId', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: { code: 'not_found', message: 'Run not found' } }); return; }
  res.json({ data: { ...run, events: workflowRepo.getEvents(req.params.runId) } });
});
```

### Verification

- `GET /api/runs` returns `{ data: { runs: [...], total: N } }`
- `GET /api/runs?status=completed` filters correctly
- `GET /api/runs/nonexistent` returns 404 with error envelope

---

## Task 9 — Node state endpoints

**Category:** Run endpoints
**Files:** `packages/server/src/app.ts`
**Depends on:** Task 8 (pattern established)

Node state is read from the run snapshot on disk. The snapshot is `run-metadata.json` in the run directory.

```typescript
app.get('/api/runs/:runId/nodes', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: { code: 'not_found', message: 'Run not found' } }); return; }
  const metaPath = resolvePluricsPath(run.workspace_path, 'runs', req.params.runId, 'run-metadata.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const nodes = (meta.nodes ?? []) as Array<Record<string, unknown>>;
    res.json({ data: { runId: req.params.runId, nodes } });
  } catch {
    res.json({ data: { runId: req.params.runId, nodes: [] } });
  }
});

app.get('/api/runs/:runId/nodes/:nodeName', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: { code: 'not_found', message: 'Run not found' } }); return; }
  const metaPath = resolvePluricsPath(run.workspace_path, 'runs', req.params.runId, 'run-metadata.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const node = (meta.nodes ?? []).find((n: Record<string, unknown>) => n.name === req.params.nodeName);
    if (!node) { res.status(404).json({ error: { code: 'not_found', message: 'Node not found' } }); return; }
    res.json({ data: node });
  } catch {
    res.status(404).json({ error: { code: 'not_found', message: 'Run metadata not available' } });
  }
});
```

### Verification

- `GET /api/runs/:runId/nodes` returns node array from disk or empty array
- `GET /api/runs/:runId/nodes/nonexistent` returns 404

---

## Task 10 — Signals endpoint

**Category:** Run endpoints
**Files:** `packages/server/src/app.ts`
**Depends on:** Task 8

Read signal summary files from the run directory. Signal files are stored as JSON in `~/.plurics/runs/:runId/signals/`.

```typescript
app.get('/api/runs/:runId/signals', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: { code: 'not_found', message: 'Run not found' } }); return; }
  const signalsDir = resolvePluricsPath(run.workspace_path, 'runs', req.params.runId, 'signals');
  try {
    const files = fs.readdirSync(signalsDir).filter(f => f.endsWith('.json'));
    const signals = files.map(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(signalsDir, f), 'utf-8'));
        return {
          signalId: raw.signal_id ?? f.replace('.json', ''),
          nodeName: raw.node_name ?? '',
          scope: raw.scope ?? null,
          timestamp: raw.timestamp ?? '',
          status: raw.status ?? 'unknown',
          outputCount: Array.isArray(raw.outputs) ? raw.outputs.length : 0,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
    res.json({ data: { runId: req.params.runId, signals } });
  } catch {
    res.json({ data: { runId: req.params.runId, signals: [] } });
  }
});
```

### Verification

- `GET /api/runs/:runId/signals` returns signal list or empty array

---

## Task 11 — Events endpoint and run control endpoints

**Category:** Run endpoints
**Files:** `packages/server/src/app.ts`
**Depends on:** Task 8

#### Events

```typescript
app.get('/api/runs/:runId/events', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: { code: 'not_found', message: 'Run not found' } }); return; }
  const events = workflowRepo.getEvents(req.params.runId);
  res.json({ data: { runId: req.params.runId, events } });
});
```

#### Control endpoints

These delegate to `activeExecutors` which lives in `websocket.ts`. Export it or move it to a shared `run-controller.ts` module accessible to both `app.ts` and `websocket.ts`.

The simplest approach (minimal refactor): export `activeExecutors` from `websocket.ts` and import it in `app.ts`.

```typescript
// websocket.ts — change to named export
export const activeExecutors = new Map<string, DagExecutor>();
```

Then in `app.ts`:

```typescript
import { activeExecutors } from './transport/websocket.js';

app.post('/api/runs/start', async (req, res) => {
  const { yamlContent, workspacePath, yamlPath } = req.body;
  if (!yamlContent || !workspacePath) {
    res.status(400).json({ error: { code: 'bad_request', message: 'yamlContent and workspacePath required' } }); return;
  }
  // Reuse parseWorkflow + DagExecutor construction pattern from websocket.ts
  // (extract to shared helper in follow-up refactor)
  res.status(202).json({ data: { runId: 'not_yet_implemented', note: 'Use WebSocket workflow:start for now' } });
});

app.post('/api/runs/:runId/pause', (req, res) => {
  const executor = activeExecutors.get(req.params.runId);
  if (!executor) { res.status(404).json({ error: { code: 'not_found', message: 'Run not active' } }); return; }
  executor.pause();
  workflowRepo.updateRunStatus(req.params.runId, 'running', 0, 0); // status stays running until paused
  res.status(202).json({ data: { runId: req.params.runId, status: 'paused' } });
});

app.post('/api/runs/:runId/resume', (req, res) => {
  const executor = activeExecutors.get(req.params.runId);
  if (!executor) { res.status(404).json({ error: { code: 'not_found', message: 'Run not active' } }); return; }
  executor.resume();
  res.status(202).json({ data: { runId: req.params.runId, status: 'running' } });
});

app.post('/api/runs/:runId/abort', async (req, res) => {
  const executor = activeExecutors.get(req.params.runId);
  if (!executor) { res.status(404).json({ error: { code: 'not_found', message: 'Run not active' } }); return; }
  await executor.abort();
  workflowRepo.updateRunStatus(req.params.runId, 'aborted', 0, 0);
  activeExecutors.delete(req.params.runId);
  res.status(202).json({ data: { runId: req.params.runId, status: 'aborted' } });
});
```

Note: `POST /api/runs/start` is a stub returning a clear message. Full implementation (extracting the executor factory from `websocket.ts`) is deferred to Task 12.

### Verification

- `POST /api/runs/:runId/pause` on an active run calls `executor.pause()`
- `POST /api/runs/:runId/abort` on an active run calls `executor.abort()` and removes from map
- `GET /api/runs/:runId/events` returns events array

---

## Task 12 — Full `POST /api/runs/start` implementation

**Category:** Run endpoints
**Files:** `packages/server/src/transport/websocket.ts`, `packages/server/src/app.ts`
**Depends on:** Task 11

Extract the executor-creation logic from the `workflow:start` WS case into a shared function.

Create `packages/server/src/modules/workflow/run-controller.ts`:

```typescript
import { DagExecutor } from './dag-executor.js';
import { parseWorkflow } from './yaml-parser.js';
import { validateInputManifest } from './input-validator.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { AgentBootstrap } from '../knowledge/agent-bootstrap.js';
import type { PresetRepository } from '../../db/preset-repository.js';
import type { WorkflowRepository } from '../../db/workflow-repository.js';
import type { RegistryClient } from '../registry/index.js';
import type { InputManifest } from './input-types.js';

export interface StartRunOptions {
  yamlContent: string;
  workspacePath: string;
  yamlPath?: string;
  inputManifest?: InputManifest;
}

export interface StartRunResult {
  runId: string;
  nodeCount: number;
  nodes: Array<{ name: string; state: string; scope: string | null }>;
}

export type BroadcastFn = (msg: object) => void;

export function createAndStartExecutor(
  opts: StartRunOptions,
  broadcast: BroadcastFn,
  registry: AgentRegistry,
  bootstrap: AgentBootstrap,
  presetRepo: PresetRepository,
  workflowRepo: WorkflowRepository,
  projectRoot: string,
  registryClient: RegistryClient | undefined,
  activeExecutors: Map<string, DagExecutor>,
): StartRunResult {
  if (opts.inputManifest) {
    const errs = validateInputManifest(opts.inputManifest, opts.workspacePath);
    if (errs.length > 0) throw new Error(`Input manifest errors: ${errs.map(e => e.message).join('; ')}`);
  }
  const config = parseWorkflow(opts.yamlContent);
  if (opts.yamlPath) config._yamlPath = opts.yamlPath;
  if (opts.inputManifest?.config_overrides) {
    config.config = { ...config.config, ...opts.inputManifest.config_overrides } as typeof config.config;
  }
  const executor = new DagExecutor(config, opts.workspacePath, projectRoot, registry, bootstrap, presetRepo, registryClient);

  executor.setStateChangeHandler((runId, node, fromState, toState, event, terminalId) => {
    broadcast({ type: 'workflow:node-update', runId, node, fromState, toState, event, terminalId });
    broadcast({ type: 'node:state_changed', timestamp: new Date().toISOString(), runId, payload: { nodeName: node, scope: null, previousState: fromState, newState: toState, attempt: 1, details: {} } });
  });

  executor.setCompleteHandler((runId, summary) => {
    workflowRepo.updateRunStatus(runId, summary.failed > 0 ? 'failed' : 'completed', summary.completed, summary.failed);
    broadcast({ type: 'workflow:completed', runId, summary });
    broadcast({ type: 'workflow:state_changed', timestamp: new Date().toISOString(), runId, payload: { status: summary.failed > 0 ? 'failed' : 'completed', previousStatus: 'running' } });
    activeExecutors.delete(runId);
  });

  executor.setFindingHandler((runId, hypothesisId, content) => {
    broadcast({ type: 'workflow:finding', runId, hypothesisId, content });
  });

  activeExecutors.set(executor.runId, executor);
  const nodeCount = Object.keys(config.nodes).length;
  workflowRepo.createRun({
    id: executor.runId, workflow_name: config.name, workspace_path: opts.workspacePath,
    yaml_content: opts.yamlContent, status: 'running', node_count: nodeCount,
  });

  const initialNodes = Object.keys(config.nodes).map(name => ({ name, state: 'pending' as const, scope: null }));
  executor.start(opts.inputManifest ?? null).catch(err => {
    console.error(`[run-controller] executor failed: ${err}`);
  });

  return { runId: executor.runId, nodeCount, nodes: initialNodes };
}
```

Update `websocket.ts` to use `createAndStartExecutor` in the `workflow:start` and `workflow:resume-run` cases. Update `app.ts` `POST /api/runs/start` to call it with a broadcast function that fans out to all connected WebSocket clients.

### Verification

- `POST /api/runs/start` with valid YAML returns `202 { data: { runId, nodeCount, nodes } }`
- WebSocket clients receive `workflow:started` and subsequent `node:state_changed` events
- Existing `workflow:start` WS handler still works

---

## Task 13 — `node:state_changed` and `workflow:state_changed` WebSocket messages

**Category:** WebSocket messages
**Files:** `packages/server/src/transport/protocol.ts`, `packages/server/src/transport/websocket.ts`
**Depends on:** Task 12 (run-controller already emits these)

### Add to `protocol.ts`

Extend the `ServerMessage` union with the spec-envelope types:

```typescript
export type ServerMessage =
  // ... existing types ...
  | {
      type: 'node:state_changed';
      timestamp: string;
      runId: string;
      payload: {
        nodeName: string;
        scope: string | null;
        previousState: string;
        newState: string;
        attempt: number;
        details?: { error?: string; dispatchHandle?: string };
      };
    }
  | {
      type: 'workflow:state_changed';
      timestamp: string;
      runId: string;
      payload: {
        status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'interrupted';
        previousStatus: string;
      };
    };
```

### Emission in `websocket.ts`

If Task 12 already handles emission inside `run-controller.ts`, verify the messages are sent. If `websocket.ts` still has inline handlers, add emission alongside the existing `workflow:node-update` send:

```typescript
// In stateChangeHandler:
sendMessage(ws, {
  type: 'node:state_changed',
  timestamp: new Date().toISOString(),
  runId,
  payload: { nodeName: node, scope: null, previousState: fromState, newState: toState, attempt: 1 },
});

// In completeHandler, alongside workflow:completed:
sendMessage(ws, {
  type: 'workflow:state_changed',
  timestamp: new Date().toISOString(),
  runId,
  payload: { status: summary.failed > 0 ? 'failed' : 'completed', previousStatus: 'running' },
});

// In pause handler:
sendMessage(ws, {
  type: 'workflow:state_changed',
  timestamp: new Date().toISOString(),
  runId: msg.runId,
  payload: { status: 'paused', previousStatus: 'running' },
});
```

### Verification

- Connect a WebSocket client; start a workflow; observe `node:state_changed` messages in addition to `workflow:node-update`
- `pnpm --filter server tsc --noEmit`

---

## Task 14 — `signal:received` and `tool:invoked` WebSocket messages

**Category:** WebSocket messages
**Files:** `packages/server/src/modules/workflow/dag-executor.ts`, `packages/server/src/transport/protocol.ts`, `packages/server/src/transport/websocket.ts`
**Depends on:** Task 13 (pattern established)

### Add to `protocol.ts`

```typescript
  | {
      type: 'signal:received';
      timestamp: string;
      runId: string;
      payload: {
        signalId: string;
        nodeName: string;
        scope: string | null;
        status: 'success' | 'failure' | 'partial';
        decisionSummary?: string;
        outputCount: number;
      };
    }
  | {
      type: 'tool:invoked';
      timestamp: string;
      runId: string;
      payload: {
        toolName: string;
        toolVersion: number;
        invokingNode: string;
        scope: string | null;
        success: boolean;
        durationMs: number;
      };
    }
```

### Add hooks to `DagExecutor`

Add two optional callbacks to the executor, analogous to `setStateChangeHandler`:

```typescript
// In dag-executor.ts — new type and field
type SignalReceivedCallback = (
  runId: string,
  signalId: string,
  nodeName: string,
  scope: string | null,
  status: 'success' | 'failure' | 'partial',
  decisionSummary: string | undefined,
  outputCount: number,
) => void;

type ToolInvokedCallback = (
  runId: string,
  toolName: string,
  toolVersion: number,
  invokingNode: string,
  scope: string | null,
  success: boolean,
  durationMs: number,
) => void;

private signalReceivedHandler?: SignalReceivedCallback;
private toolInvokedHandler?: ToolInvokedCallback;

setSignalReceivedHandler(fn: SignalReceivedCallback): void { this.signalReceivedHandler = fn; }
setToolInvokedHandler(fn: ToolInvokedCallback): void { this.toolInvokedHandler = fn; }
```

Call `this.signalReceivedHandler?.(...)` after signal validation completes (search for `validateSignalOutputs` in `dag-executor.ts` — emit after the call).

Call `this.toolInvokedHandler?.(...)` after `toolRegistry.invoke(...)` returns (search for the tool-node execution branch).

### Wire in `websocket.ts` (and `run-controller.ts` if Task 12 was done)

```typescript
executor.setSignalReceivedHandler((runId, signalId, nodeName, scope, status, decisionSummary, outputCount) => {
  sendMessage(ws, { type: 'signal:received', timestamp: new Date().toISOString(), runId,
    payload: { signalId, nodeName, scope, status, decisionSummary, outputCount } });
});

executor.setToolInvokedHandler((runId, toolName, toolVersion, invokingNode, scope, success, durationMs) => {
  sendMessage(ws, { type: 'tool:invoked', timestamp: new Date().toISOString(), runId,
    payload: { toolName, toolVersion, invokingNode, scope, success, durationMs } });
});
```

### Verification

- Start a workflow with tool nodes; observe `tool:invoked` messages in WebSocket stream
- Start a workflow that produces signals; observe `signal:received` messages
- `pnpm --filter server tsc --noEmit`

---

## Task 15 — `registry:tool_registered` WebSocket message

**Category:** WebSocket messages
**Files:** `packages/server/src/app.ts`, `packages/server/src/transport/protocol.ts`, `packages/server/src/transport/websocket.ts`
**Depends on:** Task 13

### Add to `protocol.ts`

```typescript
  | {
      type: 'registry:tool_registered';
      timestamp: string;
      payload: {
        toolName: string;
        toolVersion: number;
        category: string | null;
        registeredBy: 'seed' | 'human' | 'agent';
        runId?: string;
      };
    }
```

### Broadcast helper

The WebSocket server (`wss`) is created inside `createWebSocketServer` which returns the `WebSocketServer`. Store the reference in `app.ts` and expose a `broadcastAll` helper:

```typescript
// app.ts — after createWebSocketServer call
const wss = createWebSocketServer(server, registry, bootstrap, presetRepo, workflowRepo, projectRoot, toolRegistry);

function broadcastAll(msg: object): void {
  const raw = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1 /* OPEN */) client.send(raw);
  });
}
```

### Emit after seed loading

In `app.ts`, after `loadSeedTools`:

```typescript
if (seedResult.registered > 0) {
  // Emit one message per registered tool via registration log
  // (details available only if loadSeedTools returns per-tool results)
  broadcastAll({
    type: 'registry:tool_registered',
    timestamp: new Date().toISOString(),
    payload: { toolName: '(seed batch)', toolVersion: 0, category: null, registeredBy: 'seed' },
  });
}
```

For granular per-tool emission, `loadSeedTools` must return the list of registered tool names/versions. Check `seeds/loader.ts` — if `SeedLoadResult` includes per-tool details, iterate and emit individually. If not, a batch message is acceptable for startup.

### Verification

- On server start, WebSocket clients receive `registry:tool_registered`
- `pnpm --filter server tsc --noEmit`

---

## Task 16 — Findings REST endpoints

**Category:** Findings endpoints
**Files:** `packages/server/src/app.ts`
**Depends on:** Task 8 (pattern established)

### `GET /api/findings`

```typescript
app.get('/api/findings', (req, res) => {
  // workflow_findings table does not exist yet — return empty with note
  const note = 'workflow_findings table not yet populated; findings available per-run via GET /api/runs/:runId/findings';
  res.json({ data: { findings: [], total: 0, note } });
});
```

### `GET /api/findings/search`

```typescript
app.get('/api/findings/search', (req, res) => {
  const q = (req.query.q as string) ?? '';
  if (!q) { res.status(400).json({ error: { code: 'bad_request', message: 'q parameter required' } }); return; }
  res.json({ data: { query: q, results: [], total: 0, note: 'workflow_findings table not yet populated' } });
});
```

### `POST /api/findings/:findingId/promote`

Promote a finding from a run directory to the workspace-level shared findings archive.

```typescript
app.post('/api/findings/:findingId/promote', (req, res) => {
  const { findingId } = req.params;
  const { workspacePath, runId } = req.body;
  if (!workspacePath || !runId) {
    res.status(400).json({ error: { code: 'bad_request', message: 'workspacePath and runId required' } }); return;
  }
  const run = workflowRepo.getRun(runId);
  if (!run) { res.status(404).json({ error: { code: 'not_found', message: 'Run not found' } }); return; }

  const sourcePath = resolvePluricsPath(run.workspace_path, 'runs', runId, 'findings', `${findingId}-finding.md`);
  const archiveDir = resolvePluricsPath(workspacePath, 'shared', 'findings');
  const destPath = path.join(archiveDir, `${findingId}-finding.md`);

  try {
    if (!fs.existsSync(sourcePath)) {
      res.status(404).json({ error: { code: 'not_found', message: 'Finding file not found' } }); return;
    }
    if (fs.existsSync(destPath)) {
      res.status(409).json({ error: { code: 'conflict', message: 'Finding already promoted' } }); return;
    }
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
    res.json({ data: { findingId, promoted: true, archivePath: destPath } });
  } catch (err) {
    res.status(500).json({ error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } });
  }
});
```

### Verification

- `GET /api/findings` returns `{ data: { findings: [], total: 0, note: ... } }`
- `GET /api/findings/search?q=test` returns empty results with note
- `POST /api/findings/:id/promote` with valid runId+workspacePath copies the finding file

---

## Task 17 — Wire `GET /api/runs/:runId/findings` to new envelope

**Category:** Findings endpoints
**Files:** `packages/server/src/app.ts`
**Depends on:** Task 8

The existing `GET /api/workflows/runs/:runId/findings` returns a bare array. Add a new route at `GET /api/runs/:runId/findings` using the envelope format, distinct from the existing route.

```typescript
app.get('/api/runs/:runId/findings', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: { code: 'not_found', message: 'Run not found' } }); return; }
  const findingsDir = resolvePluricsPath(run.workspace_path, 'runs', req.params.runId, 'findings');
  try {
    const files = fs.readdirSync(findingsDir).filter(f => f.endsWith('.md'));
    const findings = files.map(f => {
      const content = fs.readFileSync(path.join(findingsDir, f), 'utf-8');
      return { findingId: f.replace('-finding.md', ''), content };
    });
    res.json({ data: { runId: req.params.runId, findings, total: findings.length } });
  } catch {
    res.json({ data: { runId: req.params.runId, findings: [], total: 0 } });
  }
});
```

Note: Express route matching — ensure the `:runId/findings` pattern does not conflict with the existing `/runs/resumable` or `/runs/start` paths. Register `start`, `resumable`, and other literal-segment routes **before** the `:runId` parameterized routes.

### Verification

- `GET /api/runs/:runId/findings` returns `{ data: { runId, findings, total } }`
- Existing `GET /api/workflows/runs/:runId/findings` still works (old frontend)

---

## Task 18 — Integration sweep and route ordering audit

**Category:** Full sweep
**Files:** `packages/server/src/app.ts`
**Depends on:** Tasks 1–17

### Route ordering audit

Express matches routes top-to-bottom. The current `app.ts` has the pattern:

```
GET /api/workflows/runs/resumable   ← literal
GET /api/workflows/:id              ← parameterized
GET /api/workflows/runs/:runId/...  ← parameterized with sub-path
```

The new `/api/runs/` routes must follow the same ordering principle:

```
POST /api/runs/start                ← literal — register FIRST
GET  /api/runs/resumable            ← literal — register BEFORE :runId
GET  /api/runs                      ← no param
GET  /api/runs/:runId               ← parameterized
GET  /api/runs/:runId/nodes         ← sub-path
GET  /api/runs/:runId/nodes/:nodeName
GET  /api/runs/:runId/signals
GET  /api/runs/:runId/events
GET  /api/runs/:runId/findings
POST /api/runs/:runId/pause
POST /api/runs/:runId/resume
POST /api/runs/:runId/abort
```

Similarly for `/api/registry/`:

```
GET  /api/registry/search           ← literal — before :name
GET  /api/registry/categories       ← literal — before :name
GET  /api/registry/tools            ← literal
GET  /api/registry/tools/:name      ← parameterized
GET  /api/registry/tools/:name/:version
GET  /api/registry/tools/:name/:version/source
GET  /api/registry/tools/:name/:version/tests
POST /api/registry/tools/:name/:version/run_tests
GET  /api/registry/tools/:name/:version/invocations
GET  /api/registry/schemas
GET  /api/registry/schemas/:name
GET  /api/registry/converters
GET  /api/registry/converters/:source/:target
```

### Final TypeScript check

```bash
pnpm --filter server tsc --noEmit
```

Zero type errors required before marking this task complete.

### Full test suite

```bash
pnpm --filter server test
```

All pre-existing tests must continue to pass. New endpoints are not unit-tested in this plan (they are integration-tested manually or in a follow-up plan).

### Manual smoke test checklist

Run the server with `pnpm --filter server dev` and verify each endpoint group:

- [ ] `GET /api/registry/tools` returns tool list
- [ ] `GET /api/registry/tools/:name/:version` returns single tool
- [ ] `GET /api/registry/tools/:name/:version/source` returns Python source
- [ ] `GET /api/registry/search?q=stat` returns results
- [ ] `GET /api/registry/categories` returns categories
- [ ] `GET /api/registry/schemas` returns schema list
- [ ] `GET /api/registry/converters` returns converter list
- [ ] `GET /api/runs` returns run list (same as before)
- [ ] `GET /api/runs/:runId` returns run detail
- [ ] `GET /api/runs/:runId/nodes` returns node array
- [ ] `GET /api/runs/:runId/events` returns events
- [ ] `GET /api/runs/:runId/findings` returns findings
- [ ] `GET /api/findings` returns empty array with note
- [ ] WebSocket: start a run, observe `node:state_changed` alongside `workflow:node-update`
- [ ] WebSocket: observe `workflow:state_changed` on completion

---

## Dependency Graph

```
Task 1 (types + RegistryClient stubs)
  └── Task 2 (RegistryDb methods + RegistryClient pass-throughs)
        ├── Task 4 (list/detail endpoints)
        │     ├── Task 5 (source/tests endpoints)
        │     └── Task 7 (search + categories)
        └── Task 3 (runTests)
              └── Task 6 (run_tests + invocations endpoints)

Task 8 (runs alias)
  ├── Task 9 (node endpoints)
  ├── Task 10 (signals endpoint)
  ├── Task 11 (events + control stubs)
  │     └── Task 12 (full /runs/start)
  │           ├── Task 13 (node:state_changed, workflow:state_changed)
  │           │     ├── Task 14 (signal:received, tool:invoked)
  │           │     └── Task 15 (registry:tool_registered)
  └── Task 17 (runs/:runId/findings with envelope)

Task 16 (findings endpoints) — independent

Task 18 (sweep) — depends on all above
```

Tasks 1–7 and Tasks 8–17 are independent tracks that can run in parallel.
