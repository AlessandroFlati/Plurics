# UI Backend Design: REST Endpoints + WebSocket Message Types

**Date:** 2026-04-12
**Status:** Approved for implementation
**Scope:** Backend-only work to unblock all frontend UI implementation
**Parent document:** `docs/design/ui.md` §5, §6
**Related documents:** `docs/design/tool-registry.md`, `docs/design/persistence.md`

---

## 1. Context and Motivation

The UI design (`docs/design/ui.md`) specifies a complete REST API surface and a WebSocket protocol. The current server (`packages/server/src/app.ts`) exposes runs under `/api/workflows/...`, has no registry endpoints, and its WebSocket message types (`packages/server/src/transport/protocol.ts`) do not match the spec format. This document specifies the gap-fill work.

No React components are touched. All deliverables are TypeScript in the server package.

---

## 2. Current State

### 2.1 Existing REST endpoints

```
GET  /api/health
POST /api/validate-path
GET  /api/list-dirs
GET  /api/list-files
GET/POST/PUT/DELETE  /api/workspaces
POST /api/workspaces/:id/select
GET/POST/PUT/DELETE  /api/agent-presets
POST /api/agent-presets/seed
GET  /api/workflows                        # -> will alias as GET /api/runs
GET  /api/workflows/:id                    # -> will alias as GET /api/runs/:runId
GET  /api/workflows/runs/:runId/log/:agent
GET  /api/workflows/runs/:runId/purpose/:agent
GET  /api/workflows/runs/:runId/metadata
GET  /api/workflow-files
GET  /api/workflow-files/:name
GET  /api/workflows/runs/resumable
GET  /api/workflows/runs/:runId/findings
```

### 2.2 Existing WebSocket message types (ServerMessage)

```typescript
'error' | 'workflow:started' | 'workflow:node-update' |
'workflow:completed' | 'workflow:paused' | 'workflow:resumed' | 'workflow:finding'
```

These do not match the spec envelope (`{ type, timestamp, runId?, payload }`).

### 2.3 RegistryClient public API (relevant methods)

`toolRegistry` is the singleton `RegistryClient` exported from `app.ts`.

Available reads:
- `toolRegistry.listSchemas(): SchemaDef[]`
- `toolRegistry.getSchema(name): SchemaDef | null`

The `RegistryDb` instance is private to `RegistryClient`. We will add public pass-through methods as needed in `registry-client.ts` rather than breaking encapsulation by exposing the db directly.

---

## 3. Response Envelope

All new endpoints return JSON using the envelope from `ui.md §6.3`:

```typescript
// Success
{ data: T }

// Error
{ error: { code: string; message: string; details?: object } }
```

HTTP status codes: `200` success, `202` accepted-but-pending, `400` bad request, `404` not found, `500` server error.

Existing endpoints are **not** retroactively wrapped to avoid breaking the current frontend. New endpoints use the envelope from day one.

---

## 4. Registry REST Endpoints (Section A)

Source: `ui.md §6.2`. All 13 endpoints read from `toolRegistry` and the filesystem at `~/.plurics/registry/`.

### 4.1 `GET /api/registry/tools`

List all tools. Supports query filters: `?category=`, `?tags=` (comma-separated), `?status=` (default `active`).

Response `data`:
```typescript
{
  tools: Array<{
    name: string;
    version: number;          // latest version
    description: string;
    category: string | null;
    tags: string[];
    stability: string | null;
    costClass: string | null;
    status: string;
    versionCount: number;
  }>;
  total: number;
}
```

Implementation: call `toolRegistry.listTools(filters)` — a new public method wrapping `RegistryDb.listTools`.

### 4.2 `GET /api/registry/tools/:name`

All registered versions of a named tool, newest first.

Response `data`:
```typescript
{
  name: string;
  versions: ToolRecord[];   // from types.ts
}
```

404 if no versions found.

### 4.3 `GET /api/registry/tools/:name/:version`

Full `ToolRecord` for a specific version.

Response `data`: `ToolRecord`

404 if not found. `version` is coerced to integer; 400 if not a valid integer.

### 4.4 `GET /api/registry/tools/:name/:version/source`

Python implementation source as plain text. Reads `tool.py` (or whichever file the entry point names) from the tool's `directory` field.

Response: `Content-Type: text/plain`, raw source bytes.

404 if tool not found or source file missing.

### 4.5 `GET /api/registry/tools/:name/:version/tests`

Tests source as plain text. Reads `tests.py` from the tool directory.

Response: `Content-Type: text/plain`.

404 if tool not found or tests file absent (not all tools have tests).

### 4.6 `POST /api/registry/tools/:name/:version/run_tests`

Execute the tool's test suite on demand. Spawns a Python subprocess running `pytest` (or the runner directly) against `tests.py`.

Request body: `{}` (no parameters in v1).

Response `data` (202 Accepted, synchronous execution with timeout):
```typescript
{
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

Timeout: 60 seconds. Returns 500 with error detail on subprocess crash.

Implementation note: use `toolRegistry.runTests(name, version)` — a new method wrapping the `executor.ts` test runner. If Python is unavailable (`toolRegistry.python === null`), return 503 with code `python_unavailable`.

### 4.7 `GET /api/registry/tools/:name/:version/invocations`

Invocation history for a specific tool version. Placeholder — logging infrastructure not yet wired at the per-tool level.

Response `data`:
```typescript
{
  toolName: string;
  version: number;
  invocations: [];           // always empty until logging infra lands
  note: string;              // "invocation logging not yet enabled"
}
```

Returns 200 (not 501) so the frontend can render the empty state gracefully.

### 4.8 `GET /api/registry/schemas`

List all schemas (builtin + user-defined).

Response `data`:
```typescript
{
  schemas: Array<{
    name: string;
    kind: SchemaKind;
    pythonRepresentation: string | null;
    encoding: SchemaEncoding;
    description: string | null;
    source: SchemaSource;
  }>;
  total: number;
}
```

Implementation: `toolRegistry.listSchemas()` already exists.

### 4.9 `GET /api/registry/schemas/:name`

Detail for a single schema.

Response `data`: `SchemaDef` (without `summarizer` function — not serializable).

404 if not found.

### 4.10 `GET /api/registry/converters`

List all converter tools.

Response `data`:
```typescript
{
  converters: Array<{
    sourceSchema: string;
    targetSchema: string;
    toolName: string;
    toolVersion: number;
  }>;
  total: number;
}
```

Implementation: `toolRegistry.listConverters()` — new public method wrapping `RegistryDb.listConverters`.

### 4.11 `GET /api/registry/converters/:source/:target`

Specific converter detail. Returns the full `ToolRecord` of the converter tool.

Response `data`: `ToolRecord`

404 if no converter exists for that schema pair.

### 4.12 `GET /api/registry/search`

Full-text search across tools (name, description, tags). Query parameter: `?q=` (required, min 2 chars).

Response `data`:
```typescript
{
  query: string;
  results: Array<{
    name: string;
    version: number;
    description: string;
    category: string | null;
    tags: string[];
    matchedFields: ('name' | 'description' | 'tags')[];
  }>;
  total: number;
}
```

Implementation: `toolRegistry.searchTools(query)` — new method doing SQL `LIKE` against name, description, and tags_json.

400 if `q` is absent or fewer than 2 characters.

### 4.13 `GET /api/registry/categories`

List categories with tool counts.

Response `data`:
```typescript
{
  categories: Array<{
    name: string;             // null category shown as "Uncategorized"
    toolCount: number;
    versions: number;
  }>;
  total: number;
}
```

Implementation: `toolRegistry.listCategories()` — new method doing GROUP BY category.

---

## 5. Run REST Endpoints (Section B)

Source: `ui.md §6.1`. Map the existing `/api/workflows/...` surface to `/api/runs/...` and add missing endpoints. Use aliasing (both paths work) to avoid breaking the existing frontend.

### 5.1 `GET /api/runs`

Alias for `GET /api/workflows`. Returns `workflowRepo.listRuns()`.

Query filters (new): `?status=`, `?workflow=`, `?limit=` (default 100), `?offset=` (default 0).

Response `data`:
```typescript
{
  runs: WorkflowRun[];
  total: number;
}
```

### 5.2 `GET /api/runs/:runId`

Full run metadata. Alias for `GET /api/workflows/:id`.

Response `data`: `WorkflowRun & { events: WorkflowEvent[] }`.

### 5.3 `GET /api/runs/:runId/nodes`

All node states for a run. Reads from the run snapshot on disk (`run-metadata.json`) if available; falls back to an empty array.

Response `data`:
```typescript
{
  runId: string;
  nodes: Array<{
    name: string;
    state: string;
    scope: string | null;
    attempt: number;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}
```

### 5.4 `GET /api/runs/:runId/nodes/:nodeName`

Single node detail. Reads the node's section from the run snapshot.

Response `data`: single node object with same fields as above plus `error` if failed.

404 if node not found in the snapshot.

### 5.5 `GET /api/runs/:runId/signals`

All signals emitted during the run. Reads signal files from the run directory (`~/.plurics/runs/:runId/signals/`).

Response `data`:
```typescript
{
  runId: string;
  signals: Array<{
    signalId: string;
    nodeName: string;
    scope: string | null;
    timestamp: string;
    status: string;
    outputCount: number;
  }>;
}
```

### 5.6 `GET /api/runs/:runId/events`

Event log for the run. Already partially served by `GET /api/workflows/:id` (embedded); this endpoint returns events only.

Response `data`:
```typescript
{
  runId: string;
  events: WorkflowEvent[];
}
```

### 5.7 `POST /api/runs/start`

Start a new run via REST (alternative to WebSocket `workflow:start`).

Request body:
```typescript
{
  yamlContent: string;
  workspacePath: string;
  yamlPath?: string;
}
```

Response: `202 Accepted`, `data: { runId: string }`. The executor is launched asynchronously. State updates flow over WebSocket.

Implementation: extract the executor-creation logic from `websocket.ts` into a shared `startWorkflow()` function in a new `run-controller.ts` file; call it from both the REST endpoint and the WS handler.

### 5.8 `POST /api/runs/:runId/pause`

Pause a running workflow.

Response: `202 Accepted`, `data: { runId: string; status: 'paused' }`.

404 if run not in `activeExecutors`. 409 if run is not currently running.

### 5.9 `POST /api/runs/:runId/resume`

Resume a paused workflow.

Same pattern as pause. 409 if run is not paused.

### 5.10 `POST /api/runs/:runId/abort`

Abort a running workflow.

Same pattern. Sets status to `aborted` in the DB.

---

## 6. WebSocket Message Types (Section C)

Source: `ui.md §5.2`. The spec defines a common envelope that the current `ServerMessage` union does not follow. We add the five new message types in the spec envelope format without removing existing types (backwards-compatible addition).

The new types are added to `packages/server/src/transport/protocol.ts` and emitted from the appropriate callsites.

### 6.1 Envelope

```typescript
interface SpecMessage {
  type: string;
  timestamp: string;    // ISO 8601 UTC — new().toISOString()
  runId?: string;
  payload: unknown;
}
```

New message types use this envelope. Existing types remain as-is.

### 6.2 `signal:received`

Emitted from `dag-executor.ts` after signal validation (in `processSignal()` or equivalent).

```typescript
{
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
```

Emission callsite: wherever `validateSignalOutputs` result is processed in the executor.

### 6.3 `tool:invoked`

Emitted from `dag-executor.ts` after each tool-node invocation resolves.

```typescript
{
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

Emission callsite: after `toolRegistry.invoke(...)` returns in the tool-node execution branch.

### 6.4 `registry:tool_registered`

Emitted by `app.ts` after `loadSeedTools` succeeds for each tool, and at runtime when `toolRegistry.register()` is called.

```typescript
{
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

Requires the WebSocket server to be accessible at registration time. The `wss` instance is passed (or the broadcast helper is passed) to a `RegistryEventEmitter` singleton that `app.ts` wires at startup.

### 6.5 `node:state_changed`

Spec-format consolidation of the existing `workflow:node-update` type. Emitted alongside (not replacing) the old type for backwards compatibility.

```typescript
{
  type: 'node:state_changed';
  timestamp: string;
  runId: string;
  payload: {
    nodeName: string;
    scope: string | null;
    previousState: string;
    newState: string;
    attempt: number;
    details?: {
      error?: string;
      dispatchHandle?: string;
    };
  };
}
```

Emission callsite: the `setStateChangeHandler` callback in `websocket.ts`.

### 6.6 `workflow:state_changed`

Explicit run-level status transition message. Emitted when run status changes to `running`, `paused`, `completed`, `failed`, or `aborted`.

```typescript
{
  type: 'workflow:state_changed';
  timestamp: string;
  runId: string;
  payload: {
    status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'interrupted';
    previousStatus: string;
  };
}
```

Emission callsites: `setCompleteHandler`, `workflow:pause` handler, `workflow:resume` handler in `websocket.ts`.

---

## 7. Findings Endpoints (Section D)

Source: `ui.md §6.1`. These serve the findings dashboard (Section 3.10).

### 7.1 `GET /api/findings`

Cross-run findings query. Scans `workflow_findings` in `plurics.db` if the table exists; falls back to scanning run directories.

Query parameters: `?verdict=confirmed|falsified|inconclusive`, `?workflow=`, `?limit=` (default 50), `?offset=`.

Response `data`:
```typescript
{
  findings: Array<{
    findingId: string;
    runId: string;
    workflowName: string;
    nodeName: string;
    scope: string | null;
    verdict: string;
    summary: string;
    timestamp: string;
    filePath: string;
  }>;
  total: number;
}
```

Note: the `workflow_findings` table does not yet exist. The endpoint returns an empty array with a `note` field (`"workflow_findings table not yet populated"`) rather than 501, so the frontend can display a graceful empty state.

### 7.2 `GET /api/findings/search`

Full-text search across findings. Query parameter: `?q=`.

Response `data`:
```typescript
{
  query: string;
  results: Array<{ /* same fields as 7.1 */ }>;
  total: number;
}
```

Same placeholder behavior as 7.1 when the table is absent.

### 7.3 `POST /api/findings/:findingId/promote`

Promote a finding to the workspace-level archive (`~/.plurics/{workspace}/findings/`).

Request body: `{ workspacePath: string }` (optional; defaults to the workspace associated with the finding's run).

Response `data`:
```typescript
{
  findingId: string;
  promoted: boolean;
  archivePath: string;
}
```

Implementation: look up the finding's file path via run metadata; copy the `.md` file to `{workspacePath}/shared/findings/`; return the destination path.

400 if finding not found. 409 if already promoted (file already exists at destination).

---

## 8. RegistryClient Extension Methods

The following public methods must be added to `RegistryClient` (`packages/server/src/modules/registry/registry-client.ts`) to support the endpoints above. All delegate to `RegistryDb` or the filesystem.

| Method | Returns | Notes |
|--------|---------|-------|
| `listTools(filters?: ListFilters): ToolRecord[]` | `ToolRecord[]` | wraps `RegistryDb.listTools` |
| `getTool(name, version): ToolRecord \| null` | `ToolRecord \| null` | wraps `RegistryDb.getTool` |
| `getToolsByName(name): ToolRecord[]` | `ToolRecord[]` | all versions |
| `listConverters(): ConverterRecord[]` | `ConverterRecord[]` | wraps db |
| `getConverter(src, tgt): ConverterRecord \| null` | `ConverterRecord \| null` | wraps db |
| `searchTools(query: string): ToolRecord[]` | `ToolRecord[]` | SQL LIKE |
| `listCategories(): CategorySummary[]` | `CategorySummary[]` | GROUP BY category |
| `runTests(name, version): TestRunResult` | `TestRunResult` | spawns pytest |

`CategorySummary` and `TestRunResult` are new types added to `types.ts`.

---

## 9. File Locations

| File | Action |
|------|--------|
| `packages/server/src/app.ts` | Add all registry, run, and findings endpoints (or delegate to route files) |
| `packages/server/src/modules/registry/registry-client.ts` | Add 8 new public methods |
| `packages/server/src/modules/registry/types.ts` | Add `CategorySummary`, `TestRunResult` |
| `packages/server/src/transport/protocol.ts` | Add 5 new WS message types to `ServerMessage` union |
| `packages/server/src/transport/websocket.ts` | Emit `node:state_changed`, `workflow:state_changed`, `signal:received`, `tool:invoked` |
| `packages/server/src/modules/workflow/dag-executor.ts` | Add signal/tool-invocation emission hooks |

Route files are optional: if `app.ts` grows beyond ~500 lines with the additions, extract registry routes to `packages/server/src/routes/registry.ts` and run/findings routes to `packages/server/src/routes/runs.ts`.

---

## 10. Out of Scope

- React components (frontend work)
- `workflow_findings` table migration (tracked separately in persistence plan)
- Per-tool invocation logging in `registry.db` (tracked in tool-registry Phase 4+)
- Authentication / multi-user support
- OpenAPI / Swagger generation
