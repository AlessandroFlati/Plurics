# Tool Registry — Phase 3 Pilot Slice Design Spec

**Date:** 2026-04-11
**Status:** Approved for implementation
**Scope:** Pilot of 10 seed tools across 3 categories to validate the seeding pattern end-to-end
**Parent documents:** `docs/design/tool-registry.md`, `docs/superpowers/specs/2026-04-11-tool-registry-phase-1-2-design.md`, `MANIFESTO.md`

---

## 1. Context and Purpose

The Tool Registry Phase 1+2 slice (commit `d594d94`) delivered a working `RegistryClient` with manifest parsing, SQLite storage, atomic registration, Python subprocess execution, and 9 built-in schemas. Tools can now be written by hand and registered programmatically.

The design doc §13 describes the full Phase 3 ("Seed tools"): ~66 real seed tools across 10 categories, representing roughly 2 weeks of work. Before committing to that full scope, this pilot slice validates the seed-loading pattern end-to-end with **10 tools across 3 categories**. The goals are:

- Establish the canonical file layout for seed tools (`tool.yaml` + `tool.py` + optional `tests.py`) that the full Phase 3 will replicate.
- Ship a `loadSeedTools` function that the server bootstrap can call idiomatically.
- Identify and document the invocation constraint that arises from the Phase 1+2 pickle-input restriction, so the full Phase 3 can be designed with that constraint in mind.
- Produce integration tests that exercise the invokable subset end-to-end with real Python.

This spec is implementation-facing and authoritative for *what to build in this pilot*. Where it diverges from design doc §13, this spec takes precedence for the pilot scope.

## 2. In Scope

- New directory `packages/server/src/modules/registry/seeds/` containing:
  - `manifest.ts` — hardcoded list of `SeedToolDef` with the relative path to each tool's `tool.yaml`.
  - `loader.ts` — exports `loadSeedTools(client: RegistryClient): Promise<SeedLoadResult>`.
  - `tools/` — one subdirectory per pilot tool, each with `tool.yaml`, `tool.py`, and an optional `tests.py`.
- `app.ts` wiring: explicit call to `loadSeedTools(toolRegistry)` after `toolRegistry.initialize()`, with a startup log summarising registered/skipped/failed counts.
- 10 pilot tools (see Section 4 for full schema table).
- Unit test: `loadSeedTools` registers each tool into a fresh tmp registry. Idempotent — second call is a no-op.
- Integration tests (gated by `pythonAvailable()` + `libsAvailable()`): invoke the primitive-input-only subset end-to-end with real CSV, JSON, and array fixtures.

## 3. Out of Scope (Deferred)

- **The remaining 56 seed tools** from design doc §13 (hypothesis testing, decomposition, clustering, time series, symbolic math, data transforms, optimization). Those are Phase 3 proper.
- **Automatic Python dependency installation or per-tool virtualenvs.** Seed tools declare `requires` fields in their `tool.yaml`, but the user is responsible for installing `numpy`, `pandas`, `scipy`, `scikit-learn`, and `statsmodels` into the Python environment. No venv management code is added in this slice.
- **Test runner at registration time** for seed tools. `loadSeedTools` calls `client.register({ caller: 'seed' })`, which sets `testsRequired: false`. Seed tests are exercised separately in the integration test suite, not at registration.
- **CI pipeline support** for running seed tools in GitHub Actions. The integration tests use `skipIf` guards that skip when `libsAvailable()` is false, so CI passes without the scientific Python stack.
- **UI browser** for seeds. No REST/WS endpoints.
- **Versioning/upgrade semantics** when seeds change between Plurics releases. The loader skips already-registered tools (idempotent check via `client.get(name)`). Handling upgrades (new version vs. override) is deferred.
- **Invocation of NumpyArray/DataFrame input tools** in this slice. The four tools that declare a `NumpyArray` or `DataFrame` input port (`stats.correlation_matrix`, `stats.fft` — wait, `stats.fft` takes `JsonArray` so it IS invokable — see Section 5) are registered but cannot be invoked end-to-end from TypeScript until the Node Runtimes Phase 2 value store ships.

## 4. The 10 Pilot Tools

### Port Schema Table

| Tool name | Category | Input ports | Output ports | Invokable in Ph1+2? |
|---|---|---|---|---|
| `pandas.load_csv` | data_io | `path: String` | `df: DataFrame` | Yes |
| `pandas.save_csv` | data_io | `df: DataFrame`, `path: String` | `written: Boolean` | No — `df` is pickle input |
| `json.load` | data_io | `path: String` | `data: JsonObject` | Yes |
| `json.dump` | data_io | `data: JsonObject`, `path: String` | `written: Boolean` | Yes |
| `stats.describe` | descriptive_stats | `df: DataFrame` | `summary: JsonObject` | No — `df` is pickle input |
| `stats.mean` | descriptive_stats | `values: JsonArray` | `mean: Float` | Yes |
| `stats.correlation_matrix` | descriptive_stats | `df: DataFrame` | `matrix: NumpyArray` | No — `df` is pickle input |
| `stats.fft` | descriptive_stats | `values: JsonArray` | `frequencies: NumpyArray`, `magnitudes: NumpyArray` | Yes |
| `sklearn.linear_regression` | regression | `X: NumpyArray`, `y: NumpyArray` | `coefficients: NumpyArray`, `intercept: Float`, `r_squared: Float` | No — `X`, `y` are pickle inputs |
| `statsmodels.ols` | regression | `X: NumpyArray`, `y: NumpyArray` | `coefficients: NumpyArray`, `p_values: NumpyArray`, `r_squared: Float` | No — `X`, `y` are pickle inputs |

**Primitive-input-only subset (5 tools):** `pandas.load_csv`, `json.load`, `json.dump`, `stats.mean`, `stats.fft`.

**Registered-only subset (5 tools):** `pandas.save_csv`, `stats.describe`, `stats.correlation_matrix`, `sklearn.linear_regression`, `statsmodels.ols`.

### Requires declarations (for human setup guidance)

| Tool | Python packages required |
|---|---|
| `pandas.load_csv`, `pandas.save_csv`, `stats.describe`, `stats.correlation_matrix` | `pandas`, `numpy` |
| `json.load`, `json.dump`, `stats.mean` | stdlib only |
| `stats.fft` | `numpy` |
| `sklearn.linear_regression` | `numpy`, `scikit-learn` |
| `statsmodels.ols` | `numpy`, `statsmodels` |

## 5. Invocation Constraint (Phase 1+2 Pickle-Input Restriction)

Phase 1+2 spec §9, step 5 states explicitly:

> `pickle_b64` schemas as inputs: **not supported in this slice**. If an input port declares a `pickle_b64` schema, return `validation` with message `"pickle input schemas not supported in phase 1+2"`.

`NumpyArray` and `DataFrame` both use `pickle_b64` encoding (design doc §9, `schemas/builtin.ts`). Any tool with a `NumpyArray` or `DataFrame` **input** port cannot be called via `RegistryClient.invoke()` from TypeScript until the value store (Node Runtimes Phase 2) provides an opaque-handle mechanism for passing pickle envelopes between tools without deserialising them in TypeScript.

This is an architectural constraint, not a bug. The 5 registered-only tools are correctly registered and discoverable via `list()`, `findProducers()`, and `findConsumers()`. They simply cannot be the start of a TS-initiated invocation chain in this phase. They **can** be composed inside Python code that chains tool entry points directly — but that is not the standard Plurics execution model.

**Resolution for this pilot:** Design integration tests to cover only the primitive-input-only subset. The registered-only subset is covered by the loader unit test (registration succeeds, tool appears in `list()`) but not by invocation tests.

## 6. Architecture

### Module layout

```
packages/server/src/modules/registry/
├── ... (Phase 1+2 files unchanged)
└── seeds/
    ├── manifest.ts              # SeedToolDef[], one entry per pilot tool
    ├── loader.ts                # loadSeedTools(client) → SeedLoadResult
    └── tools/
        ├── pandas.load_csv/
        │   ├── tool.yaml
        │   └── tool.py
        ├── pandas.save_csv/
        │   ├── tool.yaml
        │   └── tool.py
        ├── json.load/
        │   ├── tool.yaml
        │   └── tool.py
        ├── json.dump/
        │   ├── tool.yaml
        │   └── tool.py
        ├── stats.describe/
        │   ├── tool.yaml
        │   └── tool.py
        ├── stats.mean/
        │   ├── tool.yaml
        │   └── tool.py
        ├── stats.correlation_matrix/
        │   ├── tool.yaml
        │   └── tool.py
        ├── stats.fft/
        │   ├── tool.yaml
        │   └── tool.py
        ├── sklearn.linear_regression/
        │   ├── tool.yaml
        │   └── tool.py
        └── statsmodels.ols/
            ├── tool.yaml
            └── tool.py
```

Seed tools are **shipped as part of the server package** (TypeScript source tree). They are registered into the user's `~/.plurics/registry/tools/` tree at server startup, not kept only in the source tree. This means the runner executes the copy under `~/.plurics/`, not the source copy.

### Seed-loading flow

```
app.ts bootstrap
│
├── toolRegistry.initialize()         ← Phase 1+2 (unchanged)
│
└── loadSeedTools(toolRegistry)
        │
        ├─ for each SeedToolDef in manifest.ts
        │       │
        │       ├─ client.get(def.name) → already registered? → skip (idempotent)
        │       │
        │       └─ client.register({
        │               manifestPath: resolve(__dirname, def.relPath),
        │               caller: 'seed'
        │          })
        │               ├── success → registered++
        │               └── failure → failed++, log warning
        │
        └─ return SeedLoadResult { registered, skipped, failed, errors[] }

app.ts logs:
  "Seed tools loaded: X registered, Y skipped, Z failed"
```

### Types

```typescript
// seeds/manifest.ts
export interface SeedToolDef {
  name: string;          // Matches tool.yaml `name` — used for the idempotency check
  relPath: string;       // Relative path from seeds/manifest.ts to the tool.yaml
}

export const SEED_TOOLS: SeedToolDef[] = [
  { name: 'pandas.load_csv',           relPath: './tools/pandas.load_csv/tool.yaml' },
  { name: 'pandas.save_csv',           relPath: './tools/pandas.save_csv/tool.yaml' },
  { name: 'json.load',                 relPath: './tools/json.load/tool.yaml' },
  { name: 'json.dump',                 relPath: './tools/json.dump/tool.yaml' },
  { name: 'stats.describe',            relPath: './tools/stats.describe/tool.yaml' },
  { name: 'stats.mean',                relPath: './tools/stats.mean/tool.yaml' },
  { name: 'stats.correlation_matrix',  relPath: './tools/stats.correlation_matrix/tool.yaml' },
  { name: 'stats.fft',                 relPath: './tools/stats.fft/tool.yaml' },
  { name: 'sklearn.linear_regression', relPath: './tools/sklearn.linear_regression/tool.yaml' },
  { name: 'statsmodels.ols',           relPath: './tools/statsmodels.ols/tool.yaml' },
];

// seeds/loader.ts
export interface SeedLoadResult {
  registered: number;
  skipped: number;
  failed: number;
  errors: Array<{ name: string; error: string }>;
}

export async function loadSeedTools(client: RegistryClient): Promise<SeedLoadResult>;
```

### app.ts wiring (delta only)

```typescript
// After: await toolRegistry.initialize();
const seedResult = await loadSeedTools(toolRegistry);
logger.info(
  `Seed tools loaded: ${seedResult.registered} registered, ` +
  `${seedResult.skipped} skipped, ${seedResult.failed} failed`
);
if (seedResult.errors.length > 0) {
  for (const e of seedResult.errors) {
    logger.warn(`Seed registration failed for ${e.name}: ${e.error}`);
  }
}
```

`RegistryClient.initialize()` does **not** call `loadSeedTools` internally. It remains a pure lifecycle method. The explicit call in `app.ts` makes the dependency visible and allows test harnesses to initialize a registry without loading seeds.

## 7. tool.yaml Schema for Seed Tools

Each seed tool's `tool.yaml` follows the standard manifest format from Phase 1+2. Example for `stats.mean`:

```yaml
name: stats.mean
version: 1
description: Compute the arithmetic mean of a list of numbers.
category: descriptive_stats
tags: [statistics, mean, average]
stability: stable
cost_class: trivial
author: plurics-seeds
requires: []

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: List of numeric values.

outputs:
  - name: mean
    schema: Float
    description: Arithmetic mean of the input values.
```

Example for `stats.fft` (multiple outputs):

```yaml
name: stats.fft
version: 1
description: Compute the FFT of a real-valued signal and return frequency bins and magnitudes.
category: descriptive_stats
tags: [fft, frequency, signal, numpy]
stability: stable
cost_class: low
author: plurics-seeds
requires: [numpy]

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: Real-valued signal samples (list of numbers).

outputs:
  - name: frequencies
    schema: NumpyArray
    description: Frequency bin centres (Hz, assuming unit sample rate).
  - name: magnitudes
    schema: NumpyArray
    description: Magnitude spectrum (absolute value of complex FFT output).
```

## 8. Test Plan

### Unit test — loader idempotency

File: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- Create a fresh `RegistryClient` with `PLURICS_REGISTRY_ROOT` pointing to a temp directory.
- Call `loadSeedTools(client)` → assert `result.registered === 10`, `result.skipped === 0`, `result.failed === 0`.
- Call `loadSeedTools(client)` again → assert `result.registered === 0`, `result.skipped === 10`, `result.failed === 0` (pure no-op).
- Assert `client.list().length >= 10`.
- Assert `client.get('pandas.load_csv')` is not null with correct port shapes.
- Assert `client.get('stats.fft')` has two output ports (`frequencies`, `magnitudes`) both with schema `NumpyArray`.
- Assert `client.findProducers('DataFrame')` contains `pandas.load_csv`.
- Assert `client.findConsumers('DataFrame')` contains `pandas.save_csv`, `stats.describe`, `stats.correlation_matrix`.

This test requires no Python and no scientific libraries. It only exercises manifest parsing, storage, and the loader logic.

### Integration tests — primitive-input invocation

File: `packages/server/src/modules/registry/seeds/__tests__/loader.integration.test.ts`

Guard: `describe.skipIf(!pythonAvailable() || !libsAvailable(['pandas', 'numpy']))`.

Fixtures directory: `packages/server/src/modules/registry/seeds/__tests__/fixtures/`
- `sample.csv` — a small 5-row CSV with columns `x`, `y`, `z`.
- `sample.json` — a small JSON object `{ "key": "value", "n": 42 }`.

Tests:
1. **`pandas.load_csv`** — invoke with `{ path: absolutePath('sample.csv') }`. Assert output `df` is present, encoding is `pickle_b64`, `_schema` is `DataFrame`.
2. **`json.load`** — invoke with `{ path: absolutePath('sample.json') }`. Assert output `data` is a `JsonObject` with key `"key"` equal to `"value"`.
3. **`json.dump`** — invoke with `{ data: { answer: 42 }, path: tempPath('out.json') }`. Assert output `written` is `true`. Assert the file was written by reading it back.
4. **`stats.mean`** — invoke with `{ values: [1, 2, 3, 4, 5] }`. Assert output `mean` equals `3.0`.
5. **`stats.fft`** — invoke with `{ values: [0, 1, 0, -1, 0, 1, 0, -1] }` (a simple square-ish wave). Assert outputs `frequencies` and `magnitudes` are both `pickle_b64` NumpyArray envelopes. Assert `magnitudes._encoding === 'pickle_b64'`.

### Smoke test

`app.ts` startup log must contain `"Seed tools loaded:"` with `registered >= 10` and `failed === 0`. This is verified by the existing server boot smoke test, extended to check the seed log line.

## 9. Rollout Steps

Sixteen incremental, committable tasks. Each must pass its tests before the next begins.

1. **Create `seeds/` directory tree.** Add `seeds/manifest.ts` with an empty `SEED_TOOLS = []` list. Add `seeds/loader.ts` stub that returns `{ registered: 0, skipped: 0, failed: 0, errors: [] }`. No wiring to `app.ts` yet.
2. **Write loader unit test** against the empty manifest. Assert zero registered, zero skipped. Green immediately (stub).
3. **Implement `loadSeedTools`.** Idempotency check via `client.get(def.name)`. Wire `client.register(...)`. Verify unit test still green (empty manifest → no-op).
4. **Seed tool: `stats.mean`.** Write `tool.yaml` + `tool.py`. Add to `SEED_TOOLS`. Verify loader unit test: 1 registered.
5. **Seed tool: `stats.fft`.** Write `tool.yaml` + `tool.py` (uses `numpy.fft`). Add to manifest. Verify 2 registered.
6. **Seed tool: `json.load`.** Write `tool.yaml` + `tool.py` (stdlib `json`). Add to manifest. Verify 3 registered.
7. **Seed tool: `json.dump`.** Write `tool.yaml` + `tool.py`. Add to manifest. Verify 4 registered.
8. **Seed tool: `pandas.load_csv`.** Write `tool.yaml` + `tool.py` (uses `pandas`). Add to manifest. Verify 5 registered. Assert `findProducers('DataFrame')` returns this tool in unit test.
9. **Seed tool: `pandas.save_csv`.** Write `tool.yaml` + `tool.py`. Add to manifest. Verify 6 registered. Assert `findConsumers('DataFrame')` includes this tool.
10. **Seed tool: `stats.describe`.** Write `tool.yaml` + `tool.py` (`df.describe().to_dict()`). Add to manifest. Verify 7 registered.
11. **Seed tool: `stats.correlation_matrix`.** Write `tool.yaml` + `tool.py` (`df.corr().to_numpy()`). Add to manifest. Verify 8 registered.
12. **Seed tool: `sklearn.linear_regression`.** Write `tool.yaml` + `tool.py`. Add to manifest. Verify 9 registered.
13. **Seed tool: `statsmodels.ols`.** Write `tool.yaml` + `tool.py`. Add to manifest. Verify 10 registered. Assert idempotency: second `loadSeedTools` call returns 0 registered, 10 skipped.
14. **Wire into `app.ts`.** Import `loadSeedTools`, call after `initialize()`, log summary. Extend startup smoke test to assert the seed log line.
15. **Add primitive-input integration tests.** Write `loader.integration.test.ts` with CSV/JSON fixtures and the 5 invocation cases. Guard with `skipIf`. Verify green when Python + pandas + numpy are available.
16. **Module sweep.** Verify `seeds/index.ts` re-exports `loadSeedTools` and `SeedLoadResult`. Verify `registry/index.ts` re-exports from `seeds/`. Run full test suite. Fix any nits.

**Estimated effort:** ~3 days. Tasks 1-3 (scaffolding): ~2 hours. Tasks 4-13 (10 tools, 20-30 min each): ~1.5 days. Tasks 14-16 (wiring + tests): ~4 hours.

## 10. Relationship to Subsequent Slices

This pilot directly unblocks and informs:

- **Tool Registry Phase 3 (full, 66 tools):** The canonical `tool.yaml` format, the `seeds/tools/` directory layout, the `SeedToolDef` type, and the `loadSeedTools` idempotency pattern are all established here. Adding the remaining 56 tools is mechanical replication of the pattern validated by this pilot.
- **Node Runtimes Phase 2 (value store):** Once the value store ships, the 5 registered-only tools (`pandas.save_csv`, `stats.describe`, `stats.correlation_matrix`, `sklearn.linear_regression`, `statsmodels.ols`) become invokable end-to-end. No changes to their `tool.yaml` or `tool.py` are needed — the constraint is entirely on the TS invocation side.
- **Tool Registry Phase 4 (type checker + converters):** `findProducers('DataFrame')` and `findConsumers('DataFrame')` are exercised in the loader unit test, which confirms the graph traversal the type checker will use. The pilot establishes that `DataFrame`-typed edges exist in the registry and are queryable.
- **Tool Registry Phase 5 (workflow engine integration):** When the DAG executor gains `kind: tool` node support, the seed tools will be reachable from workflow YAML without any changes to the tools themselves. The pilot confirms they are registered with stable names and correct port schemas.
- **Node Runtimes Phase 3 (tool dispatch in reasoning nodes):** The LLM tool-definition generator will use `listSchemas()` and `get()` on the registry. The descriptive stats and regression seed tools demonstrate how multi-output tools should be presented in the tool definition.

Nothing in this pilot locks any design decision that would constrain subsequent slices.

---

*Approved for implementation on 2026-04-11. Next step: execute rollout plan (16 tasks) via the executing-plans skill.*
