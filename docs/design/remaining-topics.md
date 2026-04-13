# Plurics — Remaining Topics, Open Questions, and Architectural Decisions

**Date:** 2026-04-11
**Scope:** Comprehensive inventory of deferred features, open design questions, cross-document inconsistencies, undocumented decisions, missing documentation, and known gaps across the entire Plurics project
**Status:** Living document — update as items are resolved or new ones are discovered
**Audience:** Contributors, maintainers, future design sessions

---

## 1. Explicitly Deferred Features

Items that are described in design documents but deliberately excluded from the current implementation. Each is tagged with its source document and target phase.

### 1.1 Tool Registry

| Feature | Source | Target | Description |
|---|---|---|---|
| Multi-hop converter path finding | `tool-registry.md` §12 | Post-MVP | Single-hop conversion only. Multi-hop search through the converter graph deferred due to combinatorial risk and ambiguous path selection. Workaround: register a direct converter or insert an intermediate tool node. |
| Automatic regression testing | `tool-registry.md` §12 | Post-MVP | Registering a new tool does not re-run tests of dependent tools. A regression in tool B caused by updating tool A is not caught automatically. |
| Shared registries | `tool-registry.md` §12 | Post-MVP | Each Plurics installation has its own registry. No git-sync, export/import, or hosted registry. Teams share tools by copying directories. |
| Dynamic virtualenv management | `tool-registry.md` §12 | Post-MVP | Tools declare `requires` but the user installs dependencies manually. No automatic `pip install`, no per-tool virtualenv isolation. |
| MCP server bridge | `tool-registry.md` §12 | Post-MVP | Registry tools are not exposed via the Model Context Protocol. A thin MCP adapter over the registry API is architecturally straightforward but unbuilt. |
| Invocation cache | `tool-registry.md` §9.4 | Post-MVP | Every `invoke()` runs the tool fresh. Caching by `(name, version, inputs_hash)` is designed but unimplemented. The cache directory exists in the layout spec but is empty. The REST endpoint `GET /api/registry/tools/:name/:version/invocations` exists but returns an empty array stub. |
| Agent test runner | `tool-registry.md` §3.3 | Phase 6 | `RegistryClient.register({caller: 'agent', testsRequired: true})` returns a stub error. The code path exists but the test execution subprocess is not wired. The `onToolProposal` hook is implemented (Plugin SDK compliance) but the downstream test execution subprocess it depends on remains a stub. |

### 1.2 Type System

| Feature | Source | Target | Description |
|---|---|---|---|
| Structural subtyping | `type-system.md` §1 | Rejected | Nominal typing is a permanent architectural commitment, not a deferral. Two schemas with identical structure but different names are distinct types. |
| Parametrized structured types | `type-system.md` §3.2 | Post-MVP | `List[OhlcFrame]` is not allowed. Only `List[T]` where T is a primitive schema. Supporting structured type parameters would require recursive type checking. |
| Schema versioning | `type-system.md` §2.3 | Rejected | Schemas are immutable identities. A new schema version means a new name (`OhlcFrameV2`). This is deliberate, not a gap. |

### 1.3 Node Runtimes

| Feature | Source | Target | Description |
|---|---|---|---|
| Context window compaction | `node-runtimes.md` §4.2 | Post-MVP | When a reasoning node's LLM context fills up, the runtime fails with `context_exceeded`. No automatic summarization or context pruning. |
| Value handle signing | `node-runtimes.md` §5.4 | Future (multi-user) | Handles are opaque strings with no cryptographic protection. Acceptable in single-user local mode; needs signed tokens if Plurics becomes multi-user. |
| Scope-local ValueStore isolation | `node-runtimes.md` §5.3 | Phase 3b | Scope-local store is aliased to run-level store. The API surface distinguishes them but the runtime behavior is identical. True isolation (scope created at reasoning node start, destroyed at end) is deferred. |

### 1.4 Evolutionary Pool

The evolutionary pool compliance work addressed the 8 implementation gaps identified in the audit (content-hash IDs, 6-status lifecycle, `stats()`, `list(filters)`, descendants lineage, custom strategy registration, deduplication, `onEvaluationResult` auto-update). The remaining deferred items are:

| Feature | Source | Target | Description |
|---|---|---|---|
| Multi-population (island model) | `evolutionary-pool.md` §10 | Post-MVP | Single population per workflow run. No migration between populations, no parallel evolution. |
| Cross-run pool sharing | `evolutionary-pool.md` §10 | Post-MVP | No export/import of pool snapshots across runs. Each run starts with an empty pool (or one restored from its own interrupted snapshot). |
| Pool size limits and eviction | `evolutionary-pool.md` §10 | Post-MVP | No configurable maximum population size. No automatic eviction of low-fitness candidates. Pool grows unbounded within a run. |
| Generation boundary events | `evolutionary-pool.md` §10 | Post-MVP | No workflow-level event when a generation N ends and generation N+1 begins. Plugins track generation boundaries manually. |

### 1.5 Plugin SDK

| Feature | Source | Target | Description |
|---|---|---|---|
| Plugin sandboxing | `plugin-sdk.md` §8 | Future (multi-user) | Plugins run in the same Node.js process with full system access. No isolation, no capability restriction. Acceptable for single-user local; needs worker threads or separate processes for multi-user. |
| `onToolRegression` live wiring | `plugin-sdk.md` §7.3 | Post-MVP | The hook is defined and the type exists, but the regression testing engine that would invoke it does not exist. The hook is a commented-out stub. |

### 1.6 UI and Observability

The UI is now ~90% compliant with `ui.md`. The remaining gap is the Findings Dashboard (§3.10), which is lower priority per the design doc.

| Feature | Source | Target | Description |
|---|---|---|---|
| Converter graph visualization | `type-system.md` Phase 4e | Post-MVP | The DAG visualizer update includes a toggle for converter ghost nodes (implemented in `DagVisualization.tsx` augmentation). Cross-converter path visualization (multi-hop chains) remains unimplemented. |
| Workflow findings dashboard | `HIGH_LEVEL_DESIGN.md` §10 | Unscheduled | A findings panel exists in the frontend but cross-run aggregation, filtering, and comparison are not implemented. This is the last major gap between the current UI and full `ui.md` compliance. |

---

## 2. Open Design Questions

Questions raised in design documents that have not been answered. Each requires a design decision before implementation can proceed.

### 2.1 Tool Registry

**Q1. Tool versioning propagation.** ~~Resolved in commit applying `docs/q1.patch.md`.~~ The `version_policy` block in workflow YAML governs version resolution timing (`pin_at_start` / `always_latest` / per-tool `dynamic_tools`) and reaction to destructive changes (`invalidate_and_continue` / `abort` / `ignore`). Full specification in `docs/design/tool-registry.md` §8.4. No longer open.

**Q2. Cross-language tool support.** Should Plurics commit to Python-only tools, or design for polyglot (Python + TypeScript + compiled binaries)? The runner protocol (`stdin JSON → subprocess → stdout JSON`) is language-agnostic in principle, but the `pickle_b64` encoding and the `PICKLE_SCHEMAS` set are Python-specific. Source: `HIGH_LEVEL_DESIGN.md` §12.

**Q3. System tools vs. workflow tools.** Some tools are universally useful (data I/O, basic stats) and should be available to every workflow. Others are domain-specific and should be opt-in. How to formalize this distinction? Currently all 80 seed tools are always available. Source: `HIGH_LEVEL_DESIGN.md` §12.

**Q4. Automatic dependency installation.** Should `RegistryClient.register()` inspect a tool's `requires` field and offer to install missing packages? Or should the registry remain dependency-agnostic and leave installation to the user? Current behavior: `requires` is informational only. Source: `tool-registry.md` §12.

**Q9. LLM-caused errors and retroactive invalidation.** The destructive change protocol (§8.4 of `tool-registry.md`) catches tool-caused contamination: when a tool is corrected, findings produced with the buggy version are retroactively invalidated. However, a reasoning node could misuse a correct tool — for example, misinterpreting the output of a valid computation — and produce a finding that is contaminated by reasoning error rather than tool error. No mechanism exists to retroactively invalidate findings caused by LLM mistakes in prior nodes. A plugin hook (e.g., `onReasoningRevision`) that could trigger targeted invalidation would address this, but the design is undefined. This question becomes relevant when workflows produce findings that later analyses contradict — the gap is that there is no structured way to trace the contamination back and invalidate dependents. Deferred until a workflow demonstrates the concrete need.

### 2.2 Multi-User and Deployment

**Q5. Concurrent workflow execution.** Plurics currently assumes one workflow runs at a time. What happens if a user starts two workflows concurrently? SQLite locking, registry contention, port conflicts on localhost:11001, and signal directory races are all unaddressed. Source: `HIGH_LEVEL_DESIGN.md` §12.

**Q6. Multi-user access.** If Plurics becomes a team tool (shared server, multiple users), every trust assumption changes: plugins need sandboxing, registries need ACLs, value handles need signing, run directories need isolation. No design exists for this transition. Source: `HIGH_LEVEL_DESIGN.md` §12.

### 2.3 Persistence

**Q7. Database migration strategy.** The registry DB migrated from schema v1 to v2 (added `converters` table) using an inline `ALTER TABLE` approach. As the schema evolves further, should Plurics adopt a migration framework (e.g., numbered SQL files in a `migrations/` directory), or continue with inline migration code? Source: `persistence.md` §6.1.

**Q8. Run directory retention policy.** The design doc mentions 7-day default retention for run-level values, but no cleanup mechanism is implemented. Who deletes old runs? A cron job? A startup sweep? A manual command? Source: `node-runtimes.md` §5.3.

---

## 3. Cross-Document Inconsistencies

Places where two design documents describe the same concept differently, or where the implementation diverged from the spec without reconciliation.

### 3.1 Tool Node YAML Syntax

- **`workflow-engine.md` and `node-runtimes.md`** specify `kind: tool` nodes with a `tool: name` field and an `inputs:` block mapping port names to literal values or upstream references (`${node.outputs.port}`).
- **Current implementation** has `kind: tool` parsed by the YAML parser and dispatched by the DAG executor, but tool nodes are rare in practice. The five existing workflows use only `kind: reasoning` nodes. No real workflow exercises the `kind: tool` path end-to-end with upstream value references.
- **Impact:** This is not a cross-document inconsistency — both docs agree on the syntax. The gap is that the `kind: tool` path is implemented but under-exercised in real workflows. All five existing workflows use only `kind: reasoning` nodes. The tool-node dispatch path should be stressed when `sequence-explorer` or `math-discovery` are built, as that will surface any integration issues. The DAG executor's `resolveUpstreamRefs` for tool node inputs has only been tested with one integration test.

All previously identified cross-document inconsistencies (§3.2 signal schema, §3.3 selection strategy naming, §3.4 stats.describe output) have been resolved. See commit `c610b4c` for the reconciliation.

---

## 4. Undocumented Architectural Decisions

Implementation choices made during development that are not recorded in any design document but are load-bearing for the codebase's behavior.

**Note:** Items 4.4 (signal files) and 4.5 (pickle transport) from the original version of this document were removed because they ARE documented in `persistence.md` §4 and `tool-registry.md` §9.2 / `node-runtimes.md` §5 respectively. They were incorrectly classified as undocumented.

### 4.1 Build System: CJS/ESM Compatibility

**Decision:** All TypeScript source files use `__dirname` (a CommonJS global) instead of `import.meta.url` (an ESM construct) for path resolution.

**Rationale:** The `packages/server/package.json` does not declare `"type": "module"`, so `tsc` compiles to CommonJS. `import.meta.url` is invalid in CJS output and causes `tsc --noEmit` errors. However, vitest (the test runner) uses `tsx`/esbuild which compiles as ESM and provides a `__dirname` shim. Using `__dirname` satisfies both the build tool (tsc, CJS) and the test runner (vitest, ESM-shimmed).

**Impact:** If `"type": "module"` is ever added to `package.json`, `__dirname` will need to be replaced with `import.meta.url` throughout (or a polyfill). This is the reverse of the typical ESM migration path.

This is an implementation detail that belongs in a future `docs/development/build-system.md` guide, not in the architectural design documents. Tracked as backlog.

### 4.2 Python Interpreter Probing — RESOLVED

This decision is now documented in `tool-registry.md` §9.5 (added in the design doc reconciliation commit `c610b4c`). It is no longer undocumented. Summary: at `RegistryClient.initialize()`, the system probes `python3` → `python` (Unix) or `python` → `py` (Windows); the Windows `py` launcher prepends `-3` to all subsequent spawn arguments. See `tool-registry.md` §9.5 for the authoritative description.

### 4.3 Synchronous SQLite via `better-sqlite3`

**Decision:** The registry database uses `better-sqlite3`, which provides a synchronous API, rather than an async driver like `better-sqlite3/async` or `sql.js`.

**Rationale:** All registry discovery operations (`get`, `list`, `findProducers`, `findConsumers`) are fast lookups against a local SQLite file. Making them async would add complexity (promises, error handling) without performance benefit — the queries complete in microseconds. Only `register()` and `invoke()` are async (they do filesystem and subprocess I/O).

**Impact:** The synchronous API blocks the Node.js event loop during queries. For a single-user local server with tiny databases (hundreds of rows), this is undetectable. If the registry grows to thousands of tools or serves concurrent requests, the sync API could become a bottleneck.

### ~~4.4 Run-Level ValueStore as In-Memory Map~~ — RESOLVED

This item has been documented. An implementation note was added to `node-runtimes.md` §5.3 describing the in-memory `Map<string, StoredValue>` pattern, its memory implications (no eviction, grows with run size), and the flush-on-completion design for resume durability. No longer undocumented.

---

## 5. Missing Design Documents

Documents referenced in existing design docs but not yet written.

| Document | Referenced by | Purpose |
|---|---|---|
| `docs/design/overview.md` | Every design doc's "Parent document" field | System-level architecture overview. Currently `HIGH_LEVEL_DESIGN.md` serves this role, but some docs reference `overview.md` by name. Decide whether to rename `HIGH_LEVEL_DESIGN.md` to `overview.md` or update references. |
| `docs/guides/writing-workflows.md` | `HIGH_LEVEL_DESIGN.md` §13 | User-facing tutorial: how to write a workflow YAML, define presets, write a plugin, run and debug. |
| `docs/guides/building-tools.md` | `HIGH_LEVEL_DESIGN.md` §13 | User-facing tutorial: how to write a tool.yaml + tool.py, register it, test it, use it from a workflow. |

---

## 6. Technical Debt

No `TODO`, `FIXME`, `HACK`, or `XXX` comments were found in the TypeScript or Python source code. Technical debt is tracked implicitly through the deferred features listed above rather than through inline code markers.

Known structural debt (not marked in code):

- **Five workflow plugin files** reference the old `backend: claude-code` in their YAML but have migrated plugin.ts files. The YAML files should be audited to confirm all `backend:` values are updated to the new backend names.
- **`docs/architecture.md`** is a legacy file from the CAAM origin. It predates all current design docs and may contain outdated or contradictory information. It should be either deleted or marked as historical.
- **`package-lock.json` in worktrees** — Windows file locks from `better-sqlite3` native bindings prevent clean worktree removal. The orphaned `.worktrees/` directories require manual cleanup after the locking process exits.

---

## 7. Test Coverage Analysis

| Area | Unit Tests | Integration Tests | E2E Tests | Notes |
|---|---|---|---|---|
| Registry core (manifest, storage, schemas) | Strong | Strong | N/A | 102+ tests |
| Executor (subprocess, encoding, value store) | Strong | Strong (with Python) | N/A | Exercises all error categories |
| Seed tools | Per-tool `tests.py` (77 files) | Category-level integration | N/A | tests.py uses `invoke_tool` convention; not wired to automated runner |
| Type system (parser, checker, converters) | Strong | Converter insertion e2e | N/A | 28 type-parser + 17 checker + converter tests |
| Agent backends (claude, openai-compat, ollama) | Mocked fetch | N/A | N/A | No real LLM calls in tests |
| Reasoning runtime (tool-calling loop) | Fully mocked | N/A | N/A | 9+ tests covering loop, retry budget, max turns, signal parsing |
| Plugin SDK | Strong | N/A | N/A | Covers all 9 hooks, declareTools, onToolProposal, error handling per design §9 |
| Evolutionary pool | Strong | N/A | N/A | Covers all 8 compliance items |
| Workflow engine (DAG executor) | Moderate | Tool-node chain | N/A | State machine transitions under-tested; fan-out under-tested |
| Resume protocol | Minimal | N/A | N/A | No test creates a run, interrupts it, and resumes |
| Frontend (React) | N/A | N/A | N/A | tsc clean; no test framework; visual/interaction testing pending |

**Total backend:** 459 tests across 46 test files, 0 failing.

**Key gap:** No end-to-end test that starts a real workflow with a real LLM backend, reasoning nodes calling registered tools, and produces a signal-based outcome. All reasoning tests use mocked backends. Additionally, the frontend components have not been tested in a browser — they compile cleanly but visual/interaction testing is pending.

---

## 8. Operational Gaps

### Deployment

- **No containerization.** No Dockerfile, no docker-compose, no container registry. Plurics runs directly on the host OS.
- **No process management.** No systemd unit, no PM2 config, no supervisor script. The server is started via `npm run dev` or `tsx watch`.
- **No upgrade path.** No migration guide for moving from one Plurics version to the next. Database schema migrations are inline code, not versioned migration files.

### CI/CD

- **No GitHub Actions workflow.** Tests are run locally. No automated CI pipeline validates PRs, runs the test suite, or checks `tsc --noEmit`.
- **No seed tool validation pipeline.** The 80 seed tools are registered at startup but their Python tests (`tests.py`) are never run automatically. The `invoke_tool` convention requires a test runner that does not exist.

### Monitoring

- **No structured logging standard.** The plugin SDK writes JSONL to `plugin-log.jsonl`, but the server itself uses `console.log`. No unified logging format, no log rotation, no log aggregation.
- **No metrics.** No Prometheus/StatsD/OpenTelemetry integration. No counters for tool invocations, LLM calls, signal latency, or pool operations.
- **No health check beyond `/api/health`.** The health endpoint returns `{status: 'ok'}` but does not verify registry availability, Python interpreter health, or database connectivity.

---

## 9. Relationship Between Design Docs and Implementation Phases

For reference, here is the mapping from design docs to implementation phases as executed in this session:

| Design Document | Implementation Phases | Status |
|---|---|---|
| `tool-registry.md` | TR Phase 1-2 (core), TR Phase 3 (seeds), TR Phase 4 (type system), Seed Tools compliance | Done |
| `node-runtimes.md` | NR Phase 1 (backends), NR Phase 2 (value store), NR Phase 3 (tool-calling) | Done |
| `type-system.md` | TR Phase 4a-4e | Done |
| `seed-tools.md` | TR Phase 3 pilot + full + compliance (11 tools added, 3 renamed, port fixes, 77/77 test files) | Done |
| `plugin-sdk.md` | Plugin SDK compliance (PlatformServices, all 9 hooks refactored, 5 plugins migrated, declareTools + onToolProposal + onToolRegression) | Done |
| `workflow-engine.md` | Pre-existing (core engine), verified in audit | Done (~90%) |
| `evolutionary-pool.md` | Evo pool compliance (8 gaps fixed: content-hash IDs, 6-status lifecycle, stats, filtering, strategies, deduplication, descendants, auto-update) | Done (~95%) |
| `ui.md` | UI Backend (13 registry REST endpoints, 5 WebSocket types, run-controller.ts) + UI Frontend (25 React components covering all 10 UI sections) | Done (~90%) |
| `persistence.md` | Partially pre-existing, partially deferred — backend endpoints added but persistence layer gaps remain | Partial |
| `HIGH_LEVEL_DESIGN.md` | Overarching — no single phase | Reference |
| `MANIFESTO.md` | Architectural commitment — verified operationally | Reference |

---

*This document is the authoritative inventory of what remains to be done in Plurics. It should be updated whenever a deferred feature is implemented, an open question is resolved, or a new gap is discovered. The next reader of this document should be able to reconstruct the full state of the project's outstanding work from this file alone.*
