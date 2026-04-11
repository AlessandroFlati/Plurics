# Tool Registry — Phases 1 + 2 Design Spec

**Date:** 2026-04-11
**Status:** Approved for implementation
**Scope:** First implementation slice of the Plurics Tool Registry
**Parent documents:** `docs/design/tool-registry.md`, `docs/design/node-runtimes.md`, `HIGH_LEVEL_DESIGN.md`, `MANIFESTO.md`

---

## 1. Context and Purpose

The Plurics Manifesto commits the project to a model where LLMs reason and composed tools compute. The Tool Registry is the subsystem that makes this concrete: a persistent, indexed store of validated computational primitives that workflows invoke instead of generating code at runtime.

`docs/design/tool-registry.md` is the full subsystem specification, estimated at ~7 weeks of work across 7 phases. This spec narrows the first implementation slice to **Phases 1 + 2** (Core registry + Tool execution), estimated at ~2 weeks. At the end of this slice, a developer can write a `tool.yaml` + `tool.py` by hand, register it via a TypeScript API, and invoke it to receive a result. The registry is not yet wired into the workflow engine — that is deferred to a later slice covering Phase 5 of the design doc.

This spec is implementation-facing: it is intended to be read alongside the design doc, not in place of it. Where this spec diverges from the design doc, this spec is the authoritative source for *what to build first*, and any divergence is called out explicitly.

## 2. In Scope

The following are built in this slice:

- New server module at `packages/server/src/modules/registry/` with clean internal separation between manifest handling, storage, schema system, and execution.
- Filesystem layout rooted at `~/.plurics/registry/` (Windows: `%USERPROFILE%\.plurics\registry\`) with a single environment override `PLURICS_REGISTRY_ROOT` used exclusively by the test suite.
- SQLite index (`registry.db`) with the tables listed in Section 6: `tools`, `tool_ports`, `schemas`, `registration_log`, `registry_meta`. No `converters` table and no `invocation_cache`.
- `tool.yaml` parser and validator with structured error reporting.
- `RegistryClient` public API: `initialize`, `register`, `get`, `getAllVersions`, `list`, `findProducers`, `findConsumers`, `invoke`, `listSchemas`, `getSchema`, `rebuildFromFilesystem`, `close`.
- Atomic registration flow using a staging directory and SQLite transactions.
- Schema registry with built-in primitives and two built-in structured schemas (`NumpyArray`, `DataFrame`).
- Python runner script shipped with the server and copied to the registry root at first initialization.
- Subprocess execution with timeout, output size cap, exit-code dispatch, and typed error categories.
- JSON-over-stdio transport with `json_literal` encoding for primitives and `pickle_b64` encoding for structured outputs.
- Test fixtures (`test.echo_int`, `test.numpy_sum`, `test.always_fails`, `test.slow`, plus two error-path fixtures added during implementation of the error matrix) and corresponding unit + integration tests.
- `RegistryClient` instantiation in `packages/server/src/app.ts` at server startup with `initialize()` called before the server begins accepting connections.

## 3. Out of Scope (Deferred)

These are not built in this slice. Each is mapped to the phase of the design doc that covers it.

- **The 66 real seed tools** (design doc Phase 3). This slice uses small test fixtures only.
- **Type checker for compositions and automatic converter insertion** (Phase 4). No `converters` directory, no `converters` SQL table, no path finding.
- **Schema registration API for user-defined schemas** (Phase 4). Built-in schemas are hardcoded in `schemas/builtin.ts` and loaded at construction time; there is no way to register a new schema programmatically in this slice.
- **Full-text search and composition-goal search** (`search`, `find_path`). Only `get`, `list`, `findProducers`, `findConsumers`.
- **Workflow engine integration** (Phase 5). No new `kind: tool` field in YAML parser, no DAG executor dispatch to the registry, no `toolset` resolution. The registry is usable only via the programmatic `RegistryClient`.
- **Plugin hooks** `onToolProposal`, `onToolRegression` (Phase 6). The `caller: 'agent'` branch of the registration API exists in types and enforces `testsRequired: true`, but there is no wiring from signal handling to plugin invocation.
- **UI browser** (Phase 7). No REST/WS endpoints in this slice.
- **Invocation cache** (post-MVP). Every invocation runs fresh.
- **Regression testing on registration** (post-MVP).
- **Automatic dependency installation or per-tool virtualenvs** (open question).
- **MCP bridge** (open question).
- **Test runner at registration time**: tests are optional for `human` and `seed` callers and the `tests_required: true` path for `agent` caller is stubbed (registration fails with a clear "not implemented" error if invoked with `agent` + `testsRequired: true`). The real test runner is Phase 3 material.
- **Full TS↔Python pickle round-trip for inputs**: in this slice Python produces pickle envelopes for outputs and only Python consumes them. The TypeScript side treats pickle values as opaque envelopes. Full round-trip requires the value store, which is Phase 2 of the node-runtimes design doc.

## 4. Architecture and Module Layout

```
packages/server/src/modules/registry/
├── index.ts                     # Public re-exports
├── registry-client.ts           # RegistryClient — composes everything
├── types.ts                     # All public TS types
├── manifest/
│   ├── parser.ts                # parseToolManifest(yaml) → ToolManifest | throw
│   ├── validator.ts             # validateManifest(manifest, schemaRegistry)
│   └── __tests__/
├── storage/
│   ├── filesystem.ts            # Layout, staging, atomic move, hash, rebuild scan
│   ├── db.ts                    # SQLite schema + better-sqlite3 wrapper + migrations
│   └── __tests__/
├── schemas/
│   ├── schema-registry.ts       # In-memory SchemaDef map, encoding dispatch
│   ├── builtin.ts               # Hardcoded built-in primitives and structured schemas
│   └── __tests__/
├── execution/
│   ├── executor.ts              # invoke() orchestration
│   ├── encoding.ts              # TS-side input encoding, output decoding
│   ├── subprocess.ts            # spawn, timeout, output cap, exit code dispatch
│   └── __tests__/
└── python/
    └── runner.py                # Shipped with server, copied to registry root
```

**Dependency boundaries:**

- `manifest/` depends on `schemas/` (to resolve schema references during validation) but not on `storage/` or `execution/`.
- `storage/filesystem.ts` and `storage/db.ts` are independent of each other. The filesystem is the source of truth; the DB is a cache over it. `db.rebuildFromFilesystem()` is a first-class operation and is run at startup when the DB is missing or its `schema_version` does not match.
- `schemas/` has no internal dependencies on the registry; it is a leaf module.
- `execution/executor.ts` depends on `schemas/` (to know which encoding to use per port) and on `storage/filesystem.ts` (to locate the tool's version directory). It deliberately does **not** depend on `storage/db.ts` — if the DB is stale, invocation should still work if the caller provides the path directly. In this slice the caller always goes through `registry-client.ts` which uses the DB, but the execution layer remains decoupled.
- `registry-client.ts` is the only public entry point. Everything else is module-internal.

**External dependencies:**

- `better-sqlite3` for SQLite. If not already in the server package, added in this slice.
- `yaml` for `tool.yaml` parsing. If not already present, added.
- No pickle library on the Node side — pickle envelopes are opaque to TypeScript.
- No new Python dependencies for the runner beyond the standard library (`json`, `base64`, `pickle`, `importlib.util`, `pathlib`, `sys`, `traceback`). Test fixtures import `numpy` which must be available in the Python environment used for integration tests.

**Python interpreter resolution:**

`RegistryClient` accepts an optional `pythonPath`. If omitted, at `initialize()` time it probes in order: `python3`, `python`, `py -3` (Windows). The first that responds to `--version` is cached. If none respond, `initialize()` completes but sets an internal flag; subsequent `invoke()` calls return `python_unavailable` errors. Registration and discovery continue to work.

**Runner deployment:**

`packages/server/src/modules/registry/python/runner.py` is shipped with the server as a static asset. At `initialize()` time the runner file is copied to `~/.plurics/registry/runner.py` if absent or if its SHA-256 differs from the shipped version. This guarantees a stable absolute path for the subprocess launcher and allows server updates to ship a new runner transparently.

## 5. Filesystem Layout

```
~/.plurics/registry/
├── registry.db
├── runner.py
├── tools/
│   └── {tool.name}/                       # Dots preserved in directory names
│       └── v{N}/
│           ├── tool.yaml
│           ├── tool.py
│           ├── tests.py                   # Optional in this slice
│           └── README.md                  # Optional
├── schemas/
│   ├── NumpyArray.yaml                    # Copied from server assets at init
│   └── DataFrame.yaml
├── staging/
│   └── {uuid}/                            # Temporary; cleaned on success or failure
└── logs/
    └── registration.log                   # Append-only text mirror of registration_log table
```

The layout mirrors the design doc Section 4 but omits `converters/` (not built in this slice).

## 6. SQLite Schema

```sql
CREATE TABLE tools (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  version         INTEGER NOT NULL,
  description     TEXT,
  category        TEXT,
  tags_json       TEXT,
  entry_point     TEXT NOT NULL,
  language        TEXT NOT NULL,
  requires_json   TEXT,
  stability       TEXT,
  cost_class      TEXT,
  author          TEXT,
  created_at      TEXT NOT NULL,
  tool_hash       TEXT NOT NULL,
  tests_required  INTEGER NOT NULL,
  tests_passed    INTEGER,
  tests_run       INTEGER,
  status          TEXT NOT NULL DEFAULT 'active',
  UNIQUE(name, version)
);

CREATE INDEX idx_tools_name ON tools(name);
CREATE INDEX idx_tools_category ON tools(category);
CREATE INDEX idx_tools_status ON tools(status);

CREATE TABLE tool_ports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id      INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL,            -- 'input' | 'output'
  port_name    TEXT NOT NULL,
  schema_name  TEXT NOT NULL,
  required     INTEGER,                  -- NULL for outputs
  default_json TEXT,                     -- NULL unless input has explicit default
  description  TEXT,
  position     INTEGER NOT NULL,
  UNIQUE(tool_id, direction, port_name)
);

CREATE INDEX idx_ports_schema ON tool_ports(schema_name, direction);

CREATE TABLE schemas (
  name                  TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,   -- 'primitive' | 'structured'
  python_representation TEXT,
  encoding              TEXT NOT NULL,   -- 'json_literal' | 'pickle_b64'
  description           TEXT,
  source                TEXT NOT NULL    -- 'builtin' | 'user'
);

CREATE TABLE registration_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  version        INTEGER,
  caller         TEXT NOT NULL,          -- 'seed' | 'human' | 'agent'
  outcome        TEXT NOT NULL,          -- 'success' | 'failure'
  error_message  TEXT,
  tests_run      INTEGER,
  tests_passed   INTEGER,
  duration_ms    INTEGER
);

CREATE INDEX idx_registration_log_timestamp ON registration_log(timestamp);
CREATE INDEX idx_registration_log_tool ON registration_log(tool_name);

CREATE TABLE registry_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Initial row: ('schema_version', '1')
```

**Invariants:**

- The filesystem is the source of truth. The database is a cache. `rebuildFromFilesystem()` reconstructs `tools`, `tool_ports`, and `schemas` tables by scanning the disk. `registration_log` is not reconstructible — losing the DB loses historical audit, which is acceptable.
- Registration is atomic: either all SQL inserts succeed and the directory move from `staging/` completes, or neither. Partial failures leave neither filesystem nor DB changed.
- `tool_hash` is SHA-256 of a deterministic serialization of the version directory (file names + contents, sorted). It is used for drift detection at invocation time (warning only, not hard failure).

## 7. Public API

Full types in `packages/server/src/modules/registry/types.ts`. The surface exposed to the rest of the server:

```typescript
export class RegistryClient {
  constructor(options?: RegistryClientOptions);
  initialize(): Promise<void>;

  register(request: RegistrationRequest): Promise<RegistrationResult>;

  get(name: string, version?: number): ToolRecord | null;
  getAllVersions(name: string): ToolRecord[];
  list(filters?: ListFilters): ToolRecord[];
  findProducers(schemaName: string): ToolRecord[];
  findConsumers(schemaName: string): ToolRecord[];

  invoke(request: InvocationRequest): Promise<InvocationResult>;

  listSchemas(): SchemaDef[];
  getSchema(name: string): SchemaDef | null;

  rebuildFromFilesystem(): Promise<void>;
  close(): void;
}
```

**Design notes on the API shape:**

- Discovery methods (`get`, `list`, `findProducers`, `findConsumers`, `listSchemas`, `getSchema`) are **synchronous**. `better-sqlite3` exposes a synchronous API and discovery queries are fast; using sync here keeps call sites clean. Only `register` and `invoke` — which perform subprocess or filesystem I/O — are async.
- `initialize()` is separate from the constructor so that all I/O is explicit and awaitable. The constructor is pure and cannot fail.
- Errors are typed via discriminated union results (`RegistrationResult`, `InvocationResult`). Exceptions are reserved for programmer errors (null deref, broken invariants). Domain errors are values.
- No `update` or `delete` operations. Tools are immutable. A new version is a new row. Soft-delete via `status: 'archived'` is reserved for a future slice.
- `caller: 'agent'` + `testsRequired: true` is accepted by the type but returns a registration failure with category `internal` and message `"agent-caller tests not implemented in phase 1+2"`. The path exists to make adding the test runner in Phase 3 a non-breaking change.
- `callerContext` on `InvocationRequest` is optional and currently only written to logs. It becomes load-bearing when the value store ships.

## 8. Registration Flow

1. Parse `tool.yaml` at `request.manifestPath`. On syntactic error, return `RegistrationResult` with `manifest_parse` error.
2. Validate manifest: required fields present, schema references resolve in the `SchemaRegistry`, no duplicate port names, no conflict between input and output port names within the tool. Return `manifest_validation` or `schema_unknown` errors on failure.
3. Check version conflict: query `tools` where `name = ? AND version = ?`. If present, return `version_conflict`.
4. Verify entry point: open the implementation file, check it exists. Full AST verification is deferred to Phase 3; in this slice the runner will surface entry point errors at first invocation.
5. If `testsRequired === true` and `caller !== 'agent'`: (stub, currently a no-op — `tests_run = 0`, `tests_passed = 0`). If `testsRequired === true` and `caller === 'agent'`: return `internal` error "not implemented".
6. Create `staging/{uuid}/` and copy `tool.yaml` + `tool.py` (+ `tests.py`, `README.md` if present) into it.
7. Compute `tool_hash` over the staging directory contents.
8. Open a SQLite transaction:
   - Insert row into `tools` with all metadata.
   - Insert rows into `tool_ports` for every input and output port, preserving declared order in `position`.
   - Insert row into `registration_log` with outcome `success`.
9. Move `staging/{uuid}` to `tools/{name}/v{N}` using `fs.rename` (atomic on the same filesystem).
10. Commit the SQL transaction.
11. Append a line to `logs/registration.log` mirroring the `registration_log` row.
12. Return `RegistrationResult` with `success: true`.

**On any failure between steps 6 and 10:** delete `staging/{uuid}`, roll back the SQL transaction, append a failure row to `registration_log` outside the transaction, return a failure result. The tools directory and the DB are both left unchanged.

## 9. Execution Flow

1. `get(name, version)` to resolve the `ToolRecord`. On miss: `tool_not_found`.
2. Validate inputs against the tool's input ports: required ports present, schema names known, no extras. On failure: `validation`.
3. Apply defaults for omitted optional inputs by reading `default_json` from `tool_ports`.
4. Build `input_schemas` and `output_schemas` maps from port names to schema names.
5. Encode inputs TS-side:
   - `json_literal` schemas: passthrough the native JS value.
   - `pickle_b64` schemas as inputs: **not supported in this slice**. If an input port declares a `pickle_b64` schema, return `validation` with message `"pickle input schemas not supported in phase 1+2"`.
6. Assemble the JSON envelope `{ inputs, input_schemas, output_schemas }`.
7. Spawn the subprocess: `pythonPath runner.py tool.directory tool.entryPoint`, write the envelope to stdin, close stdin, read stdout/stderr with a 100 MB cap.
8. Wait for exit or timeout. On timeout: SIGTERM, wait 5 seconds, SIGKILL, return `timeout`.
9. Dispatch on exit code:
   - `0`: parse stdout as `{ ok: true, outputs: {...} }`, decode outputs, validate against declared output ports, return success.
   - `1`: parse stdout as `{ ok: false, error: {...} }`, return `runtime` with the Python exception type and message.
   - any other: return `subprocess_crash` with stderr contents.
10. Decode outputs TS-side:
    - `json_literal` schemas: passthrough.
    - `pickle_b64` schemas: preserve the envelope object unchanged. It is returned to the caller as an opaque value. The caller (a future value store) will be responsible for round-tripping it back to Python.
11. Validate that every declared output port is present in the result dict, no extras. On mismatch: `output_mismatch`.
12. Return `InvocationResult` with `success: true`, decoded outputs, and timing metrics.

## 10. Python Runner Protocol

Invocation: `python runner.py <tool_dir> <entry_point>`

- `tool_dir`: absolute path to the version directory containing `tool.py`.
- `entry_point`: string of the form `file.py:function` (matches `tool.yaml`).

Stdin: a single JSON envelope `{ "inputs": {...}, "input_schemas": {...}, "output_schemas": {...} }`.

Stdout:
- On success: `{ "ok": true, "outputs": {...} }` where structured-schema outputs are wrapped as `{ "_schema": name, "_encoding": "pickle_b64", "_data": base64 }`.
- On tool error: `{ "ok": false, "error": { "type": str, "message": str, "traceback": str } }`.

Exit codes:
- `0`: success envelope on stdout.
- `1`: tool-level error envelope on stdout (exception in user code, output encode/decode failure, output type error).
- `2`: runner-level error (malformed stdin, import failure, missing entry point, bad arguments). stderr carries details. Stdout is empty.

Structured schemas requiring pickle are currently hardcoded to the set `{"NumpyArray", "DataFrame"}` in the runner, kept in sync with `schemas/builtin.ts` on the TypeScript side. When the schema registry grows beyond built-ins (Phase 4), the runner will receive the encoding map from the TS side via the envelope instead of hardcoding it.

## 11. Error Matrix

| Category | Triggered by |
|---|---|
| `tool_not_found` | `invoke()` with unknown name or missing version |
| `validation` | missing required input, unknown schema ref, extras, pickle input attempt |
| `timeout` | tool runs longer than `timeoutMs`; SIGTERM then SIGKILL |
| `runtime` | Python exception in tool entry point |
| `output_mismatch` | result dict missing declared ports or containing extras; malformed stdout JSON |
| `subprocess_crash` | exit code other than 0 or 1; spawn failure |
| `python_unavailable` | no working Python found during `initialize()` |

| Registration category | Triggered by |
|---|---|
| `manifest_parse` | YAML syntax error |
| `manifest_validation` | missing required fields, duplicate ports, structural issues |
| `schema_unknown` | port references a schema not in the registry |
| `entry_point_missing` | `tool.py` absent (runtime entry-point function verification is deferred) |
| `version_conflict` | `(name, version)` already in `tools` |
| `test_failure` | reserved; no code path reaches it in this slice |
| `filesystem` | staging, copy, rename, or log write failures |
| `database` | SQLite errors outside the transaction |
| `internal` | stub paths (`agent` caller with `testsRequired`), unexpected invariant breaks |

Every category in the matrix has at least one test.

## 12. Test Plan

**Fixtures** (`packages/server/src/modules/registry/__tests__/fixtures/`):

- `test.echo_int/v1` — primitive in, primitive out.
- `test.numpy_sum/v1` — `JsonArray` in, `NumpyArray` + `Float` out. Exercises pickle output.
- `test.always_fails/v1` — raises `RuntimeError`. Exercises `runtime` error.
- `test.slow/v1` — `time.sleep(seconds)`. Exercises timeout.
- `test.bad_output/v1` — returns a dict that omits a declared output. Exercises `output_mismatch`.
- `test.crash/v1` — calls `os._exit(99)`. Exercises `subprocess_crash`.

These fixtures are not shipped to users. They are registered into temporary registries during tests via `PLURICS_REGISTRY_ROOT=<tmpdir>`.

**Unit tests** (no Python required):

- `manifest/parser.test.ts` — valid and malformed YAML.
- `manifest/validator.test.ts` — schema refs, missing fields, duplicate ports, version conflict preflight.
- `storage/filesystem.test.ts` — staging → commit, rebuild-from-disk, hash determinism, concurrent registration rejection, rename atomicity.
- `storage/db.test.ts` — schema bootstrap, CRUD, transaction rollback, `rebuildFromFilesystem` idempotence.
- `schemas/schema-registry.test.ts` — built-in load, lookup, encoding dispatch.
- `execution/subprocess.test.ts` — timeout (SIGTERM/SIGKILL), output cap, exit code dispatch using a fake Node runner.
- `registry-client.test.ts` — register → get → list → findProducers → findConsumers with fixture manifests, without invoke.

**Integration tests** (`python` in PATH required, `describe.skipIf(!pythonAvailable)`):

- `execution/executor.integration.test.ts` — register each fixture, exercise every row of the error matrix, verify metrics are populated.

**Smoke test in `packages/server/src/app.ts`:**

- On server startup, `RegistryClient` is constructed and `initialize()` is awaited before the server accepts connections. A startup smoke test asserts that `initialize()` completes, the directory structure is present, and `listSchemas()` returns the built-ins.

## 13. Rollout Steps

Six incremental, committable steps. Each has tests that must pass before the next step begins.

1. **Skeleton + types + schema registry built-ins.** Create the module tree, write `types.ts`, implement `schemas/builtin.ts` and `schemas/schema-registry.ts`. Test: `schema-registry.test.ts`.
2. **Manifest parser + validator.** Implement `manifest/parser.ts` and `manifest/validator.ts`. Test: parser + validator unit tests using inline YAML fixtures.
3. **Storage layer.** Implement `storage/filesystem.ts` and `storage/db.ts`. Test: filesystem + db unit tests against tmpdirs. `rebuildFromFilesystem` verified here.
4. **RegistryClient registration + discovery.** Compose manifest + storage + schemas. Implement `register`, `get`, `getAllVersions`, `list`, `findProducers`, `findConsumers`, `listSchemas`, `getSchema`, `rebuildFromFilesystem`, `close`. Test: `registry-client.test.ts` register/query roundtrip.
5. **Python runner + subprocess + executor.** Implement `python/runner.py`, `execution/subprocess.ts`, `execution/encoding.ts`, `execution/executor.ts`, and the `invoke` method on `RegistryClient`. Test: subprocess unit tests + executor integration tests against the fixtures, with skipIf on Python availability.
6. **Server integration.** Instantiate a singleton `RegistryClient` in `packages/server/src/app.ts`, call `initialize()` before the HTTP/WS server starts accepting connections. No routes added in this slice. Smoke test: server boots with registry initialized and built-in schemas visible.

Each step is independently committable. Breaking step N does not break steps 1..N-1.

**Estimated effort:** ~2 weeks. Steps 1-4 ≈ 1 week; step 5 ≈ 3-4 days (the subprocess path on Windows needs care); step 6 ≈ half a day.

## 14. Open Questions Deferred

These are not blockers for this slice but should be revisited before the next one.

- **Tool hash algorithm stability across operating systems.** File ordering, newline handling, and symlink treatment need to be defined precisely. The initial implementation hashes `(relative_path, content_bytes)` pairs sorted lexicographically by path, skipping directories. Revisit when drift detection becomes load-bearing.
- **Python interpreter mismatch between registration time and invocation time.** If the user changes Python versions between registering a tool and invoking it, pickle formats can diverge. This slice ignores the issue; the next slice should at least record the Python version in tool metadata so mismatches are detectable.
- **Registry root on multi-user systems.** `~/.plurics/` assumes a single user. When Plurics grows to multi-tenant, the root moves into a per-tenant directory. Not relevant for this slice.

## 15. Relationship to Subsequent Slices

This slice unblocks:

- **Tool Registry Phase 3** — writing the real seed tools once the `RegistryClient.register` path is stable.
- **Tool Registry Phase 4** — extending the schema registry with user-defined schemas and adding the converter infrastructure. The `SchemaRegistry` abstraction introduced here has a stable internal API that Phase 4 extends without breaking.
- **Tool Registry Phase 5** — workflow engine integration. The `RegistryClient` API is the integration point; the YAML parser gets new handling for `kind: tool` and dispatches to `invoke()`.
- **Node Runtimes Phase 2** — the value store. Pickle envelopes produced by this slice are directly consumable by the value store; the round-trip path from TS to Python is added there, not here.
- **Node Runtimes Phase 3** — tool dispatch in reasoning nodes. The backend refactor will use `listSchemas`, `get`, and the tool manifest to generate Anthropic/OpenAI tool definitions from this slice's data.

Nothing in this slice locks design decisions that would make subsequent slices harder.

---

*Approved for implementation on 2026-04-11. Next step: hand off to the writing-plans skill to produce a concrete step-by-step implementation plan.*
