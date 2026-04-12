# Tool Registry Phase 4 (Type System Completion) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Plurics type system — converter registry, composition type checker, runtime validators, parametrized type parsing, and converter insertion at execution time — so workflows are fully type-checked before execution and mismatched types are automatically bridged by registered converters.

**Architecture:** Converters land as first-class tools in the existing registry; a new `type-checker.ts` in `workflow/` wires into `DagExecutor.start()`; a new `type-parser.ts` handles parametrized type expressions; Python validator files live under `schemas/validators/`; converter materialization happens inside the tool node execution path of `DagExecutor`.

**Tech Stack:** TypeScript ESM (NodeNext), vitest, better-sqlite3, existing `RegistryClient` / `RegistryDb` / `ValueStore` / `DagExecutor`. Python 3, pandas, numpy, sympy for validators and converter implementations.

**Source of truth:** `docs/superpowers/specs/2026-04-12-tool-registry-phase-4-design.md`. When this plan and the spec disagree, the spec wins. The authoritative design for the type system is `docs/design/type-system.md`.

**Test discipline:** Every task that produces code follows red-green-commit: write failing test, confirm failure reason, implement minimum to pass, confirm pass, commit. Integration tests requiring Python or scientific libs use `describe.skipIf(!pythonAvailable())` or `describe.skipIf(!libsAvailable(['pandas','numpy']))`. Always use `__dirname` not `import.meta.url`. Run tests with `(cd packages/server && npx vitest run <path>)`.

**Baseline:** 335/335 tests passing, 0 skipped, 0 failing. Target after Phase 4: ≥ 395 passing, 0 skipped, 0 failing.

**Commit style:** one commit per task, message prefix `tr-phase4:`.

**Recommended sequence:** `4a + 4d` in parallel → `4b + 4c` in parallel → `4e`.

---

## Sub-phase 4a — Converter Registry (~2 days)

### Task 1: Add 8 new built-in structured schemas to `builtin.ts`

**Files:**
- Modify: `packages/server/src/modules/registry/schemas/builtin.ts`
- Modify (verify): `packages/server/src/modules/registry/python/runner.py` — check if `PICKLE_SCHEMAS` is hardcoded; if yes, extend it.
- Modify: any test asserting a specific `BUILTIN_SCHEMAS.length` count (grep for the count before editing).

**Context:** The 8 new schemas (`Series`, `OhlcFrame`, `FeaturesFrame`, `ReturnSeries`, `SignalSeries`, `Statistics`, `RegressionModel`, `ClusteringModel`) must land before the built-in converter tools in Task 7-9, because converter registration will fail `schema_unknown` if their target schemas do not yet exist in the registry.

- [ ] **Step 1: Verify the runner's `PICKLE_SCHEMAS` set**

```bash
grep -n "PICKLE_SCHEMAS" packages/server/src/modules/registry/python/runner.py
```

If the set is hardcoded (not derived from a registered list at runtime), note the names present and plan to extend in Step 3.

- [ ] **Step 2: Append 8 new schema entries to `BUILTIN_SCHEMAS` in `builtin.ts`**

Open `packages/server/src/modules/registry/schemas/builtin.ts`. After the existing entries and before the closing `];`, append:

```typescript
  {
    name: 'Series',
    kind: 'structured',
    pythonRepresentation: 'pandas.Series',
    encoding: 'pickle_b64',
    description: 'Generic pandas Series (name, dtype, and values).',
    source: 'builtin',
  },
  {
    name: 'OhlcFrame',
    kind: 'structured',
    pythonRepresentation: 'pandas.DataFrame',
    encoding: 'pickle_b64',
    description: 'pandas DataFrame with open/high/low/close columns indexed by timestamp.',
    source: 'builtin',
  },
  {
    name: 'FeaturesFrame',
    kind: 'structured',
    pythonRepresentation: 'pandas.DataFrame',
    encoding: 'pickle_b64',
    description: 'pandas DataFrame of computed numeric features indexed by timestamp.',
    source: 'builtin',
  },
  {
    name: 'ReturnSeries',
    kind: 'structured',
    pythonRepresentation: 'pandas.Series',
    encoding: 'pickle_b64',
    description: 'pandas Series of log returns indexed by timestamp.',
    source: 'builtin',
  },
  {
    name: 'SignalSeries',
    kind: 'structured',
    pythonRepresentation: 'pandas.Series',
    encoding: 'pickle_b64',
    description: 'pandas Series of trading signals (±1 or 0) indexed by timestamp.',
    source: 'builtin',
  },
  {
    name: 'Statistics',
    kind: 'structured',
    pythonRepresentation: 'dict',
    encoding: 'pickle_b64',
    description: 'Dict of statistical test results (p-values, statistics, metadata).',
    source: 'builtin',
  },
  {
    name: 'RegressionModel',
    kind: 'structured',
    pythonRepresentation: 'object',
    encoding: 'pickle_b64',
    description: 'A fitted regression model (sklearn, statsmodels, or compatible).',
    source: 'builtin',
  },
  {
    name: 'ClusteringModel',
    kind: 'structured',
    pythonRepresentation: 'object',
    encoding: 'pickle_b64',
    description: 'A fitted clustering model (sklearn KMeans or compatible).',
    source: 'builtin',
  },
```

`PICKLE_SCHEMA_NAMES` is derived via filter, so it automatically includes all 8 new entries.

- [ ] **Step 3: Extend runner `PICKLE_SCHEMAS` if hardcoded**

If Step 1 found a hardcoded set in `runner.py`, add the 8 new names:

```python
PICKLE_SCHEMAS = {
    'NumpyArray', 'DataFrame', 'SymbolicExpr',
    'Series', 'OhlcFrame', 'FeaturesFrame',
    'ReturnSeries', 'SignalSeries', 'Statistics',
    'RegressionModel', 'ClusteringModel',
}
```

If the set is dynamically derived, skip this step.

- [ ] **Step 4: Add summarizer dispatch entries to `runner.py`**

In runner.py's summarize dispatch block (near the NumpyArray/DataFrame/SymbolicExpr handlers), add:

```python
elif schema_name == 'Series':
    try:
        return f"Series name={value.name!r} dtype={value.dtype} len={len(value)} sample={value.head(3).to_dict()}"
    except Exception:
        return '<unprintable Series>'
elif schema_name == 'OhlcFrame':
    try:
        idx = value.index
        return f"OhlcFrame shape={value.shape} cols={list(value.columns)} dates={idx[0]}..{idx[-1]}"
    except Exception:
        return '<unprintable OhlcFrame>'
elif schema_name == 'FeaturesFrame':
    try:
        return f"FeaturesFrame shape={value.shape} features={list(value.columns)[:5]}"
    except Exception:
        return '<unprintable FeaturesFrame>'
elif schema_name == 'ReturnSeries':
    try:
        import numpy as np
        return f"ReturnSeries len={len(value)} mean={np.mean(value):.6f} std={np.std(value):.6f}"
    except Exception:
        return '<unprintable ReturnSeries>'
elif schema_name == 'SignalSeries':
    try:
        return f"SignalSeries len={len(value)} unique={sorted(value.unique().tolist())} counts={value.value_counts().to_dict()}"
    except Exception:
        return '<unprintable SignalSeries>'
elif schema_name == 'Statistics':
    try:
        keys = list(value.keys())
        sample = {k: value[k] for k in keys[:4]}
        return f"Statistics keys={keys} sample={sample}"
    except Exception:
        return '<unprintable Statistics>'
```

`RegressionModel` and `ClusteringModel` get no summarizer (too varied across libraries).

- [ ] **Step 5: Fix any test asserting the old schema count**

Search for assertions like `expect(BUILTIN_SCHEMAS).toHaveLength(N)` and update `N` from its old value to `N + 8`.

```bash
grep -rn "BUILTIN_SCHEMAS\|toHaveLength\|schema.*length\|length.*schema" packages/server/src/modules/registry/schemas/ packages/server/src/modules/registry/seeds/
```

- [ ] **Step 6: Run existing schema tests**

```bash
(cd packages/server && npx vitest run src/modules/registry/schemas/)
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/schemas/builtin.ts \
        packages/server/src/modules/registry/python/runner.py
git commit -m "tr-phase4: add 8 new built-in structured schemas (Series, OhlcFrame, etc.)"
```

---

### Task 2: Extend `types.ts` — `SchemaDef` validator fields and `ToolManifest` converter metadata

**Files:**
- Modify: `packages/server/src/modules/registry/types.ts`

No tests needed — these are type-only additions; the TypeScript compiler validates usage across the codebase.

- [ ] **Step 1: Read `types.ts` in full before editing**

Read `packages/server/src/modules/registry/types.ts` to find the exact current `SchemaDef` and `ToolManifest.metadata` interface bodies.

- [ ] **Step 2: Add `validatorModule?` and `validatorFunction?` to `SchemaDef`**

Find the `SchemaDef` interface and append two optional fields:

```typescript
export interface SchemaDef {
  name: string;
  kind: SchemaKind;
  pythonRepresentation: string | null;
  encoding: SchemaEncoding;
  description: string | null;
  source: SchemaSource;
  validatorModule?: string;    // relative path from registry module root, e.g. "schemas/validators/ohlc_frame.py"
  validatorFunction?: string;  // defaults to "validate" if module is set but function is omitted
}
```

- [ ] **Step 3: Add converter metadata fields to `ToolManifest.metadata`**

Find the `metadata?` block inside `ToolManifest` and extend it:

```typescript
  metadata?: {
    author?: string;
    createdAt?: string;
    stability?: Stability;
    costClass?: CostClass;
    isConverter?: boolean;
    sourceSchema?: string;
    targetSchema?: string;
  };
```

- [ ] **Step 4: Add `ConverterRecord` type**

Append after the existing `RegistrationResult` type block:

```typescript
// ---------- Converter registry ----------

export interface ConverterRecord {
  sourceSchema: string;
  targetSchema: string;
  toolName: string;
  toolVersion: number;
}
```

- [ ] **Step 5: Type-check**

```bash
(cd packages/server && npx tsc --noEmit)
```

Expected: zero errors. Fix any errors that arise before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/registry/types.ts
git commit -m "tr-phase4: extend SchemaDef with validator fields; ToolManifest with converter metadata"
```

---

### Task 3: Add `converters` table to `db.ts`; bump schema version 1 → 2; add `insertConverter()` and `findConverter()`

**Files:**
- Modify: `packages/server/src/modules/registry/storage/db.ts`

**Context:** This is the critical DB plumbing task. The `converters` table is keyed by `(source_schema, target_schema)` with `UNIQUE` constraint. `INSERT OR REPLACE` semantics mean the latest registration wins. Schema version bumps from 1 → 2 with a migration block that is safe for existing `registry.db` files.

- [ ] **Step 1: Read `db.ts` in full**

Read `packages/server/src/modules/registry/storage/db.ts` to understand the current DDL, `EXPECTED_SCHEMA_VERSION`, and how the version migration block is structured.

- [ ] **Step 2: Bump `EXPECTED_SCHEMA_VERSION` from 1 to 2**

Find the constant and update it:

```typescript
const EXPECTED_SCHEMA_VERSION = 2;
```

- [ ] **Step 3: Add `SCHEMA_V2` migration block**

Locate the migration runner (the block that checks the current DB version and applies DDL changes). Add a v2 migration case that creates the `converters` table:

```typescript
if (currentVersion < 2) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS converters (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      source_schema    TEXT NOT NULL,
      target_schema    TEXT NOT NULL,
      tool_name        TEXT NOT NULL,
      tool_version     INTEGER NOT NULL,
      registered_at    TEXT NOT NULL,
      UNIQUE(source_schema, target_schema)
    );

    CREATE INDEX IF NOT EXISTS idx_converters_pair
      ON converters(source_schema, target_schema);
  `);
  db.pragma(`user_version = 2`);
}
```

Existing `registry.db` files that are at version 1 will receive this migration on next startup without data loss.

- [ ] **Step 4: Add `insertConverter()` method to `RegistryDb`**

In the `RegistryDb` class (or equivalent object), add:

```typescript
insertConverter(
  sourceSchema: string,
  targetSchema: string,
  toolName: string,
  toolVersion: number,
): void {
  const stmt = this.db.prepare(`
    INSERT OR REPLACE INTO converters
      (source_schema, target_schema, tool_name, tool_version, registered_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(sourceSchema, targetSchema, toolName, toolVersion, new Date().toISOString());
}
```

- [ ] **Step 5: Add `findConverter()` method to `RegistryDb`**

```typescript
findConverter(source: string, target: string): ConverterRecord | null {
  const row = this.db.prepare(`
    SELECT source_schema, target_schema, tool_name, tool_version
    FROM converters
    WHERE source_schema = ? AND target_schema = ?
    LIMIT 1
  `).get(source, target) as {
    source_schema: string;
    target_schema: string;
    tool_name: string;
    tool_version: number;
  } | undefined;

  if (!row) return null;
  return {
    sourceSchema: row.source_schema,
    targetSchema: row.target_schema,
    toolName: row.tool_name,
    toolVersion: row.tool_version,
  };
}
```

Import `ConverterRecord` from `../types.js` at the top of the file.

- [ ] **Step 6: Run existing DB / storage tests**

```bash
(cd packages/server && npx vitest run src/modules/registry/storage/)
```

Expected: all green. The migration block must not break existing tests that open a fresh DB at version 0.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/storage/db.ts
git commit -m "tr-phase4: add converters table (schema v2 migration) with insertConverter/findConverter"
```

---

### Task 4: Update `parser.ts` to read converter metadata from YAML; update `validator.ts` with converter manifest constraint

**Files:**
- Modify: `packages/server/src/modules/registry/manifest/parser.ts`
- Modify: `packages/server/src/modules/registry/manifest/validator.ts`

- [ ] **Step 1: Read both files before editing**

Read `parser.ts` and `validator.ts` to locate where `metadata` fields are read and where manifest validation constraints are listed.

- [ ] **Step 2: Update `parser.ts` to read `is_converter`, `source_schema`, `target_schema`**

In the metadata parsing block (where `author`, `stability`, `costClass` are read from the raw YAML object), add:

```typescript
isConverter: raw.metadata?.is_converter === true ? true : undefined,
sourceSchema: typeof raw.metadata?.source_schema === 'string'
  ? raw.metadata.source_schema
  : undefined,
targetSchema: typeof raw.metadata?.target_schema === 'string'
  ? raw.metadata.target_schema
  : undefined,
```

Map YAML snake_case keys (`is_converter`, `source_schema`, `target_schema`) to camelCase TypeScript fields (`isConverter`, `sourceSchema`, `targetSchema`).

- [ ] **Step 3: Add converter manifest constraint in `validator.ts`**

After the existing per-port validations, add a block that fires when `manifest.metadata?.isConverter === true`:

```typescript
if (manifest.metadata?.isConverter === true) {
  const src = manifest.metadata.sourceSchema;
  const tgt = manifest.metadata.targetSchema;
  if (!src || !tgt) {
    errors.push({
      category: 'manifest_validation',
      message:
        'Converter tools must declare metadata.source_schema and metadata.target_schema.',
    });
  } else {
    // source_schema must match the schema of the single input port
    const inputSchemas = Object.values(manifest.inputs).map((p) => p.schema);
    if (!inputSchemas.includes(src)) {
      errors.push({
        category: 'manifest_validation',
        message: `metadata.source_schema "${src}" does not match any input port schema (${inputSchemas.join(', ')}).`,
      });
    }
    // target_schema must match the schema of the single output port
    const outputSchemas = Object.values(manifest.outputs).map((p) => p.schema);
    if (!outputSchemas.includes(tgt)) {
      errors.push({
        category: 'manifest_validation',
        message: `metadata.target_schema "${tgt}" does not match any output port schema (${outputSchemas.join(', ')}).`,
      });
    }
  }
}
```

- [ ] **Step 4: Run manifest tests**

```bash
(cd packages/server && npx vitest run src/modules/registry/manifest/)
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/manifest/parser.ts \
        packages/server/src/modules/registry/manifest/validator.ts
git commit -m "tr-phase4: parser reads is_converter metadata; validator enforces converter port-schema match"
```

---

### Task 5: Wire `insertConverter()` into `RegistryDb.insertTool()`; expose `findConverter()` on `RegistryClient`

**Files:**
- Modify: `packages/server/src/modules/registry/storage/db.ts` (the `insertTool` method)
- Modify: `packages/server/src/modules/registry/registry-client.ts`

- [ ] **Step 1: Read `insertTool()` and `RegistryClient` before editing**

Find the method body of `insertTool()` and the public method list of `RegistryClient`.

- [ ] **Step 2: Call `insertConverter()` from `insertTool()` when `isConverter === true`**

After the tool and port rows are written and before the method returns, add:

```typescript
if (manifest.metadata?.isConverter === true) {
  this.insertConverter(
    manifest.metadata.sourceSchema!,
    manifest.metadata.targetSchema!,
    manifest.name,
    manifest.version,
  );
}
```

The `!` non-null assertions are safe here because `validator.ts` (Task 4) already rejected manifests where these fields are absent when `isConverter` is true.

- [ ] **Step 3: Add `findConverter()` public method to `RegistryClient`**

```typescript
findConverter(source: string, target: string): ConverterRecord | null {
  return this.db.findConverter(source, target);
}
```

Import `ConverterRecord` from `./types.js`.

- [ ] **Step 4: Run full registry tests**

```bash
(cd packages/server && npx vitest run src/modules/registry/)
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/storage/db.ts \
        packages/server/src/modules/registry/registry-client.ts
git commit -m "tr-phase4: insertTool wires to insertConverter; RegistryClient exposes findConverter"
```

---

### Task 6: Write `converter-registry.test.ts`

**Files:**
- Create: `packages/server/src/modules/registry/__tests__/converter-registry.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryClient } from '../registry-client.js';

// --- helpers ---
function tempDir() {
  return mkdtempSync(join(tmpdir(), 'plurics-converter-test-'));
}

describe('converter registry', () => {
  let dir: string;
  let client: RegistryClient;

  beforeEach(async () => {
    dir = tempDir();
    client = new RegistryClient({ rootDir: dir });
    await client.initialize();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('findConverter returns null when no converter is registered', () => {
    expect(client.findConverter('DataFrame', 'NumpyArray')).toBeNull();
  });

  it('findConverter returns record after a converter tool is registered', async () => {
    // Register a minimal converter tool manifest inline
    // (Use a fixture directory or write a temp manifest)
    // ... register a tool with isConverter: true, sourceSchema: 'A', targetSchema: 'B'
    // Then:
    const rec = client.findConverter('A', 'B');
    expect(rec).not.toBeNull();
    expect(rec!.sourceSchema).toBe('A');
    expect(rec!.targetSchema).toBe('B');
    expect(rec!.toolName).toBe('convert.A_to_B');
  });

  it('INSERT OR REPLACE semantics: second registration for same pair wins', async () => {
    // Register convert.A_to_B v1, then register convert.A_to_B v2
    // Expect findConverter returns v2
    const rec = client.findConverter('A', 'B');
    expect(rec!.toolVersion).toBe(2);
  });

  it('converter table populated for is_converter: true manifest', async () => {
    // Register a converter manifest, verify findConverter returns it
    // Register a normal (non-converter) manifest, verify findConverter still returns null for its schemas
  });

  it('rejects is_converter manifest with mismatched port schemas', async () => {
    // Register a manifest with is_converter: true, source_schema: 'X',
    // but input port schema: 'Y'. Expect registration to fail with manifest_validation error.
  });
});
```

Note: Flesh out each test case with a concrete fixture manifest. Use `__dirname` to locate any fixture files. If a shared fixture helper already exists in the registry test suite, reuse it instead of writing fresh manifest content inline.

- [ ] **Step 2: Run and confirm all green**

```bash
(cd packages/server && npx vitest run src/modules/registry/__tests__/converter-registry.test.ts)
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/__tests__/converter-registry.test.ts
git commit -m "tr-phase4: converter-registry unit tests (findConverter, INSERT OR REPLACE, manifest validation)"
```

---

### Task 7: Write `convert.DataFrame_to_NumpyArray` converter tool

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/convert.DataFrame_to_NumpyArray/v1/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/convert.DataFrame_to_NumpyArray/v1/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/convert.DataFrame_to_NumpyArray/v1/tests.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` — add `SeedToolDef` entry
- Modify: `packages/server/src/modules/registry/seeds/loader.ts` — update expected seed count 66 → 67

**`tool.yaml`:**

```yaml
name: convert.DataFrame_to_NumpyArray
version: 1
description: |
  Convert a pandas DataFrame to a NumPy array by extracting the .values attribute.
  Discards index and column labels. Numeric DataFrames only.

category: converter

inputs:
  source:
    schema: DataFrame
    required: true
    description: Numeric pandas DataFrame to convert.

outputs:
  target:
    schema: NumpyArray
    description: NumPy ndarray with shape (rows, cols).

implementation:
  language: python
  entry_point: tool.py:run
  requires:
    - pandas
    - numpy

tests:
  file: tests.py
  required: true

metadata:
  stability: stable
  is_converter: true
  source_schema: DataFrame
  target_schema: NumpyArray
```

**`tool.py`:**

```python
import numpy as np
import pandas as pd


def run(source: pd.DataFrame) -> dict:
    arr = source.values
    return {"target": arr}
```

**`tests.py`:**

```python
import numpy as np
import pandas as pd
from tool import run


def test_basic():
    df = pd.DataFrame({"a": [1.0, 2.0], "b": [3.0, 4.0]})
    result = run(df)
    arr = result["target"]
    assert isinstance(arr, np.ndarray)
    assert arr.shape == (2, 2)
    assert arr[0, 0] == 1.0


def test_single_column():
    df = pd.DataFrame({"x": [10, 20, 30]})
    result = run(df)
    arr = result["target"]
    assert arr.shape == (3, 1)


if __name__ == "__main__":
    test_basic()
    test_single_column()
    print("All tests passed.")
```

- [ ] **Step 1: Create directory and write all three files as above**
- [ ] **Step 2: Add to `manifest.ts`** — append a `SeedToolDef` entry for `convert.DataFrame_to_NumpyArray`
- [ ] **Step 3: Bump expected seed count in `loader.ts`** from 66 to 67
- [ ] **Step 4: Run loader test**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/)
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/convert.DataFrame_to_NumpyArray/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/loader.ts
git commit -m "tr-phase4: add convert.DataFrame_to_NumpyArray seed converter tool"
```

---

### Task 8: Write `convert.NumpyArray_to_DataFrame` converter tool

**Files:** Same pattern as Task 7. Expected seed count 67 → 68.

| Field | Value |
|---|---|
| Name | `convert.NumpyArray_to_DataFrame` |
| Input port | `source: NumpyArray` |
| Output port | `target: DataFrame` |
| Implementation | `pd.DataFrame(source)` — integer column names by default |
| `source_schema` | `NumpyArray` |
| `target_schema` | `DataFrame` |

**`tool.py` body:**

```python
import numpy as np
import pandas as pd

def run(source: np.ndarray) -> dict:
    df = pd.DataFrame(source)
    return {"target": df}
```

**`tests.py` cases:** 2D array → DataFrame with correct shape; 1D array → single-column DataFrame.

- [ ] **Step 1–5:** Same as Task 7 pattern (create files, add to manifest, bump count, run tests, commit)

**Commit message:** `tr-phase4: add convert.NumpyArray_to_DataFrame seed converter tool`

---

### Task 9: Write `convert.OhlcFrame_to_ReturnSeries` converter tool

**Files:** Same pattern. Expected seed count 68 → 69.

| Field | Value |
|---|---|
| Name | `convert.OhlcFrame_to_ReturnSeries` |
| Input port | `source: OhlcFrame` |
| Output port | `target: ReturnSeries` |
| Implementation | `np.log(df['close']).diff().dropna()` |
| `source_schema` | `OhlcFrame` |
| `target_schema` | `ReturnSeries` |

**`tool.py` body:**

```python
import numpy as np
import pandas as pd

def run(source: pd.DataFrame) -> dict:
    returns = np.log(source["close"]).diff().dropna()
    return {"target": returns}
```

**`tests.py` cases:** OHLC DataFrame with close column → ReturnSeries of length `n-1`; verify first element is approximately `log(p1/p0)`.

- [ ] **Step 1–5:** Create files, add to manifest, bump count (→ 69), run tests, commit

**Commit message:** `tr-phase4: add convert.OhlcFrame_to_ReturnSeries seed converter tool`

---

### Task 10: Run all tests; confirm seed count 69 and converter table is populated

- [ ] **Step 1: Run full test suite**

```bash
(cd packages/server && npx vitest run)
```

Expected: ≥ 335 tests passing (plus the new converter-registry tests added in Task 6). 0 failing.

- [ ] **Step 2: Spot-check that `findConverter` resolves all 3 seeded pairs**

Add a brief integration assertion in `converter-registry.test.ts` (or a separate smoke test) that initializes the `RegistryClient` with `loadSeedTools`, then calls `findConverter('DataFrame', 'NumpyArray')`, `findConverter('NumpyArray', 'DataFrame')`, and `findConverter('OhlcFrame', 'ReturnSeries')` and expects non-null results.

- [ ] **Step 3: Commit any test additions**

```bash
git add packages/server/src/modules/registry/__tests__/converter-registry.test.ts
git commit -m "tr-phase4: add seed-loaded converter lookup integration assertions"
```

---

## Sub-phase 4d — Parametrized Type Parser (~1 day)

*4d is independent of 4b and can run in parallel with 4b or before it. It must land before 4b's `checkCompatibility()` is finalized, since the checker calls `typeExprEqual()`.*

### Task 11: Export `ParsedWorkflowYaml` alias from `yaml-parser.ts`

**Files:**
- Modify: `packages/server/src/modules/workflow/yaml-parser.ts`

- [ ] **Step 1: Read `yaml-parser.ts` to identify the existing workflow config type name**

The spec says the current type is `WorkflowConfig`. Verify this by reading the file.

- [ ] **Step 2: Add type alias export**

If the type is `WorkflowConfig`, append at the end of the file (or alongside its definition):

```typescript
// Alias used by type-checker.ts for a stable import name.
export type ParsedWorkflowYaml = WorkflowConfig;
```

- [ ] **Step 3: Type-check**

```bash
(cd packages/server && npx tsc --noEmit)
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/workflow/yaml-parser.ts
git commit -m "tr-phase4: export ParsedWorkflowYaml alias from yaml-parser"
```

---

### Task 12 (= spec Task 16): Implement `type-parser.ts`

**Files:**
- Create: `packages/server/src/modules/workflow/type-parser.ts`

This is a **full-content** task. The implementation is a hand-written recursive-descent parser with no external dependencies.

- [ ] **Step 1: Create `type-parser.ts`**

```typescript
// Parametrized type expression parser for the Plurics type system.
// Spec: docs/superpowers/specs/2026-04-12-tool-registry-phase-4-design.md §10
// Design doc: docs/design/type-system.md §3.2

export type TypeExpr =
  | { kind: 'named'; name: string }
  | { kind: 'parametrized'; outer: string; params: TypeExpr[] };

// The 7 primitive schema names. Structured types may NOT appear as type parameters.
const PRIMITIVE_NAMES = new Set([
  'Integer', 'Float', 'String', 'Boolean', 'Null', 'JsonObject', 'JsonArray',
]);

// Parametrized container names (outer names that accept parameters).
const CONTAINER_NAMES = new Set(['List', 'Dict', 'Optional', 'Tuple']);

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

// ---------- Tokenizer ----------

type Token =
  | { type: 'name'; value: string }
  | { type: 'lbracket' }
  | { type: 'rbracket' }
  | { type: 'comma' }
  | { type: 'eof' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    const ch = s[i];
    if (ch === '[') { tokens.push({ type: 'lbracket' }); i++; }
    else if (ch === ']') { tokens.push({ type: 'rbracket' }); i++; }
    else if (ch === ',') { tokens.push({ type: 'comma' }); i++; }
    else if (/\s/.test(ch)) { i++; }
    else if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      tokens.push({ type: 'name', value: s.slice(i, j) });
      i = j;
    } else {
      throw new ParseError(`Unexpected character '${ch}' at position ${i} in type expression: "${input}"`);
    }
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

// ---------- Recursive descent parser ----------

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(type: Token['type']): Token {
    const tok = this.tokens[this.pos];
    if (tok.type !== type) {
      throw new ParseError(
        `Expected token '${type}' but got '${tok.type}' at position ${this.pos}.`,
      );
    }
    this.pos++;
    return tok;
  }

  parse(): TypeExpr {
    const expr = this.parseExpr();
    if (this.peek().type !== 'eof') {
      throw new ParseError(`Trailing tokens after type expression at position ${this.pos}.`);
    }
    return expr;
  }

  private parseExpr(): TypeExpr {
    const nameTok = this.consume('name') as { type: 'name'; value: string };
    const name = nameTok.value;

    if (this.peek().type === 'lbracket') {
      // Parametrized form: Outer[T, ...]
      if (!CONTAINER_NAMES.has(name)) {
        throw new ParseError(
          `'${name}' is not a supported parametrized container (List, Dict, Optional, Tuple).`,
        );
      }
      this.consume('lbracket');
      const params: TypeExpr[] = [];
      // Parse at least one parameter
      params.push(this.parseParam(name));
      while (this.peek().type === 'comma') {
        this.consume('comma');
        params.push(this.parseParam(name));
      }
      this.consume('rbracket');
      return { kind: 'parametrized', outer: name, params };
    }

    return { kind: 'named', name };
  }

  private parseParam(container: string): TypeExpr {
    // Peek at the name token — if it is a structured type used as a param, reject it.
    const tok = this.peek();
    if (tok.type !== 'name') {
      throw new ParseError(`Expected a type name inside '${container}[...]', got '${tok.type}'.`);
    }
    const name = tok.value;
    // Structured types are not in PRIMITIVE_NAMES and not in CONTAINER_NAMES.
    // They are invalid as parameters.
    if (!PRIMITIVE_NAMES.has(name) && !CONTAINER_NAMES.has(name)) {
      throw new ParseError(
        `Structured type '${name}' cannot be used as a type parameter in '${container}[${name}]'. ` +
        `Only primitive types (${[...PRIMITIVE_NAMES].join(', ')}) may appear as parameters.`,
      );
    }
    return this.parseExpr();
  }
}

// ---------- Public API ----------

/**
 * Parse a type expression string into a TypeExpr tree.
 * Throws ParseError on malformed input.
 */
export function parseTypeExpr(input: string): TypeExpr {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  return parser.parse();
}

/**
 * Structural equality for TypeExpr trees.
 */
export function typeExprEqual(a: TypeExpr, b: TypeExpr): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'named' && b.kind === 'named') return a.name === b.name;
  if (a.kind === 'parametrized' && b.kind === 'parametrized') {
    if (a.outer !== b.outer) return false;
    if (a.params.length !== b.params.length) return false;
    return a.params.every((p, i) => typeExprEqual(p, b.params[i]));
  }
  return false;
}

/**
 * Render a TypeExpr back to its canonical string form.
 */
export function typeExprToString(e: TypeExpr): string {
  if (e.kind === 'named') return e.name;
  return `${e.outer}[${e.params.map(typeExprToString).join(', ')}]`;
}
```

- [ ] **Step 2: Type-check**

```bash
(cd packages/server && npx tsc --noEmit)
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/workflow/type-parser.ts
git commit -m "tr-phase4: implement parametrized type expression parser (type-parser.ts)"
```

---

### Task 13 (= spec Task 17): Wire `type-parser.ts` into manifest `parser.ts`

**Files:**
- Modify: `packages/server/src/modules/registry/manifest/parser.ts`
- Modify: `packages/server/src/modules/registry/types.ts` — add `parsedTypeExpr?` to `ToolPortSpec`

- [ ] **Step 1: Add `parsedTypeExpr?` to `ToolPortSpec` in `types.ts`**

```typescript
export interface ToolPortSpec {
  schema: string;
  parsedTypeExpr?: TypeExpr;   // Set when schema string contains '['; absent for named types.
  required?: boolean;
  default?: unknown;
  description?: string;
}
```

Import `TypeExpr` from `./workflow/type-parser.js` or wherever it is co-located. Because `types.ts` is in `registry/` and `type-parser.ts` is in `workflow/`, use a relative path: `import type { TypeExpr } from '../workflow/type-parser.js';`.

- [ ] **Step 2: Update manifest `parser.ts` to parse port schema strings containing `[`**

In the port parsing helper (where `schema: raw.schema` is assigned), add:

```typescript
import { parseTypeExpr } from '../../../workflow/type-parser.js';

// When reading a port spec:
const schemaStr: string = raw.schema;
const parsedTypeExpr = schemaStr.includes('[')
  ? parseTypeExpr(schemaStr)
  : undefined;

// Then in the port object:
{
  schema: schemaStr,
  parsedTypeExpr,
  required: raw.required ?? false,
  default: raw.default,
  description: raw.description ?? null,
}
```

If `parseTypeExpr` throws a `ParseError`, convert it to a `RegistrationError` with `category: 'manifest_validation'` and include the original error message.

- [ ] **Step 3: Run manifest tests**

```bash
(cd packages/server && npx vitest run src/modules/registry/manifest/)
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/registry/manifest/parser.ts \
        packages/server/src/modules/registry/types.ts
git commit -m "tr-phase4: wire type-parser into manifest parser; ToolPortSpec gains parsedTypeExpr"
```

---

### Task 14 (= spec Task 19): Write `type-parser.test.ts`

**Files:**
- Create: `packages/server/src/modules/workflow/__tests__/type-parser.test.ts`

- [ ] **Step 1: Write the full test file**

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseTypeExpr,
  typeExprEqual,
  typeExprToString,
  ParseError,
} from '../type-parser.js';

describe('parseTypeExpr — named types', () => {
  it('parses a primitive name', () => {
    const e = parseTypeExpr('Integer');
    expect(e).toEqual({ kind: 'named', name: 'Integer' });
  });

  it('parses a structured name', () => {
    const e = parseTypeExpr('OhlcFrame');
    expect(e).toEqual({ kind: 'named', name: 'OhlcFrame' });
  });

  it('trims surrounding whitespace', () => {
    const e = parseTypeExpr('  Float  ');
    expect(e).toEqual({ kind: 'named', name: 'Float' });
  });
});

describe('parseTypeExpr — parametrized types', () => {
  it('parses List[Integer]', () => {
    const e = parseTypeExpr('List[Integer]');
    expect(e).toEqual({
      kind: 'parametrized',
      outer: 'List',
      params: [{ kind: 'named', name: 'Integer' }],
    });
  });

  it('parses Optional[Float]', () => {
    const e = parseTypeExpr('Optional[Float]');
    expect(e.kind).toBe('parametrized');
    if (e.kind === 'parametrized') {
      expect(e.outer).toBe('Optional');
      expect(e.params).toHaveLength(1);
    }
  });

  it('parses Dict[String, Integer]', () => {
    const e = parseTypeExpr('Dict[String, Integer]');
    expect(e).toEqual({
      kind: 'parametrized',
      outer: 'Dict',
      params: [
        { kind: 'named', name: 'String' },
        { kind: 'named', name: 'Integer' },
      ],
    });
  });

  it('parses Tuple[Integer, Float, String]', () => {
    const e = parseTypeExpr('Tuple[Integer, Float, String]');
    if (e.kind === 'parametrized') {
      expect(e.outer).toBe('Tuple');
      expect(e.params).toHaveLength(3);
    }
  });

  it('parses nested List[List[Integer]]', () => {
    const e = parseTypeExpr('List[List[Integer]]');
    expect(e).toEqual({
      kind: 'parametrized',
      outer: 'List',
      params: [
        {
          kind: 'parametrized',
          outer: 'List',
          params: [{ kind: 'named', name: 'Integer' }],
        },
      ],
    });
  });

  it('parses Optional[List[Float]]', () => {
    const e = parseTypeExpr('Optional[List[Float]]');
    expect(e.kind).toBe('parametrized');
  });
});

describe('parseTypeExpr — error cases', () => {
  it('throws ParseError for structured type as parameter', () => {
    expect(() => parseTypeExpr('List[OhlcFrame]')).toThrow(ParseError);
    expect(() => parseTypeExpr('List[DataFrame]')).toThrow(ParseError);
    expect(() => parseTypeExpr('Optional[NumpyArray]')).toThrow(ParseError);
  });

  it('throws ParseError for unknown container outer', () => {
    expect(() => parseTypeExpr('Map[String, Integer]')).toThrow(ParseError);
  });

  it('throws ParseError for empty brackets', () => {
    expect(() => parseTypeExpr('List[]')).toThrow(ParseError);
  });

  it('throws ParseError for trailing garbage', () => {
    expect(() => parseTypeExpr('Integer extra')).toThrow(ParseError);
  });

  it('throws ParseError for unclosed bracket', () => {
    expect(() => parseTypeExpr('List[Integer')).toThrow(ParseError);
  });

  it('throws ParseError for unexpected character', () => {
    expect(() => parseTypeExpr('List<Integer>')).toThrow(ParseError);
  });
});

describe('typeExprEqual', () => {
  it('named types with same name are equal', () => {
    expect(typeExprEqual(
      { kind: 'named', name: 'Integer' },
      { kind: 'named', name: 'Integer' },
    )).toBe(true);
  });

  it('named types with different names are not equal', () => {
    expect(typeExprEqual(
      { kind: 'named', name: 'Integer' },
      { kind: 'named', name: 'Float' },
    )).toBe(false);
  });

  it('named vs parametrized are not equal', () => {
    expect(typeExprEqual(
      { kind: 'named', name: 'List' },
      { kind: 'parametrized', outer: 'List', params: [{ kind: 'named', name: 'Integer' }] },
    )).toBe(false);
  });

  it('List[Integer] equals List[Integer]', () => {
    expect(typeExprEqual(
      parseTypeExpr('List[Integer]'),
      parseTypeExpr('List[Integer]'),
    )).toBe(true);
  });

  it('List[Integer] does not equal List[Float]', () => {
    expect(typeExprEqual(
      parseTypeExpr('List[Integer]'),
      parseTypeExpr('List[Float]'),
    )).toBe(false);
  });

  it('Dict[String, Integer] equals Dict[String, Integer]', () => {
    expect(typeExprEqual(
      parseTypeExpr('Dict[String, Integer]'),
      parseTypeExpr('Dict[String, Integer]'),
    )).toBe(true);
  });

  it('Dict[String, Integer] does not equal Dict[Integer, String]', () => {
    expect(typeExprEqual(
      parseTypeExpr('Dict[String, Integer]'),
      parseTypeExpr('Dict[Integer, String]'),
    )).toBe(false);
  });
});

describe('typeExprToString', () => {
  const roundTrip = (s: string) => typeExprToString(parseTypeExpr(s));

  it('round-trips Integer', () => expect(roundTrip('Integer')).toBe('Integer'));
  it('round-trips List[Integer]', () => expect(roundTrip('List[Integer]')).toBe('List[Integer]'));
  it('round-trips Dict[String, Float]', () => expect(roundTrip('Dict[String, Float]')).toBe('Dict[String, Float]'));
  it('round-trips Optional[Boolean]', () => expect(roundTrip('Optional[Boolean]')).toBe('Optional[Boolean]'));
  it('round-trips Tuple[Integer, Float, String]', () =>
    expect(roundTrip('Tuple[Integer, Float, String]')).toBe('Tuple[Integer, Float, String]'));
  it('round-trips List[List[Integer]]', () =>
    expect(roundTrip('List[List[Integer]]')).toBe('List[List[Integer]]'));
});
```

- [ ] **Step 2: Run and confirm green**

```bash
(cd packages/server && npx vitest run src/modules/workflow/__tests__/type-parser.test.ts)
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/workflow/__tests__/type-parser.test.ts
git commit -m "tr-phase4: type-parser unit tests (30+ cases covering all parametrized forms)"
```

---

## Sub-phase 4b — Composition Type Checker (~4 days)

*Requires Tasks 3 (findConverter), 11 (ParsedWorkflowYaml alias), and Task 12 (typeExprEqual).*

### Task 15 (= spec Task 12): Implement `type-checker.ts`

**Files:**
- Create: `packages/server/src/modules/workflow/type-checker.ts`

This is a **full-content** task — the type checker core and error message formatter.

- [ ] **Step 1: Create `type-checker.ts`**

```typescript
// Composition type checker for the Plurics workflow engine.
// Spec: docs/superpowers/specs/2026-04-12-tool-registry-phase-4-design.md §8
// Design: docs/design/type-system.md §5

import type { ParsedWorkflowYaml } from './yaml-parser.js';
import type { RegistryClient } from '../registry/registry-client.js';
import type { SchemaRegistry } from '../registry/schemas/schema-registry.js';
import { typeExprEqual, typeExprToString } from './type-parser.js';
import type { TypeExpr } from './type-parser.js';

// ---------- Public types ----------

export interface TypeCheckResult {
  ok: boolean;
  errors: TypeError[];
  warnings: TypeWarning[];
  resolvedPlan: ResolvedWorkflowPlan;
}

export interface TypeError {
  category:
    | 'tool_not_found'
    | 'schema_not_found'
    | 'type_mismatch'
    | 'missing_required_input'
    | 'preset_not_found'
    | 'invalid_reference'
    | 'invalid_backend';
  message: string;
  location: { nodeName: string; line?: number; column?: number };
  details?: Record<string, unknown>;
}

export interface TypeWarning {
  category: 'empty_category' | 'unresolved_glob' | 'unused_output' | 'validation_disabled';
  message: string;
  location: { nodeName: string };
}

export interface ResolvedWorkflowPlan {
  nodes: Map<string, ResolvedNode>;
  converterInsertions: ConverterInsertion[];
}

export interface ResolvedNode {
  kind: 'tool' | 'reasoning';
  resolvedToolName?: string;
  resolvedVersion?: number;
  resolvedToolset?: string[];
  resolvedBackend?: string;
}

export interface ConverterInsertion {
  upstreamNode: string;
  upstreamPort: string;
  downstreamNode: string;
  downstreamPort: string;
  converterTool: string;
  converterVersion: number;
}

// ---------- Supported backends ----------

const VALID_BACKENDS = new Set(['claude', 'openai-compat', 'ollama']);

// ---------- Input source parsing ----------

type InputSource =
  | { kind: 'literal'; value: unknown; schemaHint: string }
  | { kind: 'config'; key: string }
  | { kind: 'upstream'; nodeName: string; portName: string }
  | { kind: 'unknown' };

function parseInputSourceExpr(value: unknown): InputSource {
  if (typeof value === 'string') {
    // Upstream reference: ${nodeName.outputs.portName}
    const upstreamMatch = value.match(/^\$\{(\w+)\.outputs\.(\w+)\}$/);
    if (upstreamMatch) {
      return { kind: 'upstream', nodeName: upstreamMatch[1], portName: upstreamMatch[2] };
    }
    // Config substitution: {{KEY}}
    const configMatch = value.match(/^\{\{(\w+)\}\}$/);
    if (configMatch) {
      return { kind: 'config', key: configMatch[1] };
    }
    return { kind: 'literal', value, schemaHint: 'String' };
  }
  if (typeof value === 'number') {
    return { kind: 'literal', value, schemaHint: Number.isInteger(value) ? 'Integer' : 'Float' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'literal', value, schemaHint: 'Boolean' };
  }
  if (value === null) {
    return { kind: 'literal', value, schemaHint: 'Null' };
  }
  if (Array.isArray(value)) {
    return { kind: 'literal', value, schemaHint: 'JsonArray' };
  }
  if (typeof value === 'object') {
    return { kind: 'literal', value, schemaHint: 'JsonObject' };
  }
  return { kind: 'unknown' };
}

// ---------- Schema name comparison ----------

function schemasCompatible(
  sourceSchemaName: string,
  targetSchemaName: string,
  sourceParsed: TypeExpr | undefined,
  targetParsed: TypeExpr | undefined,
): boolean {
  // Both parametrized: use structural equality
  if (sourceParsed && targetParsed) {
    return typeExprEqual(sourceParsed, targetParsed);
  }
  // Both named (the common case): string equality
  return sourceSchemaName === targetSchemaName;
}

// ---------- Error message formatters ----------

function fmtTypeMismatch(opts: {
  workflowName: string;
  nodeName: string;
  portName: string;
  toolName: string;
  targetSchema: string;
  upstreamNode: string;
  upstreamPort: string;
  sourceSchema: string;
}): string {
  return (
    `Type mismatch in workflow \`${opts.workflowName}\` at node \`${opts.nodeName}\`:\n` +
    `  The input port \`${opts.portName}\` of tool \`${opts.toolName}\` expects schema \`${opts.targetSchema}\`,\n` +
    `  but the upstream node \`${opts.upstreamNode}\` (output port \`${opts.upstreamPort}\`) produces schema \`${opts.sourceSchema}\`.\n\n` +
    `  No converter is registered for \`${opts.sourceSchema} \u2192 ${opts.targetSchema}\`.\n\n` +
    `  Possible fixes:\n` +
    `    1. Change the upstream tool's output to declare \`${opts.targetSchema}\` directly.\n` +
    `    2. Register a converter from \`${opts.sourceSchema}\` to \`${opts.targetSchema}\`.\n` +
    `    3. Insert an intermediate tool node that wraps the value.`
  );
}

function fmtToolNotFound(nodeName: string, toolName: string): string {
  return `Tool not found at node \`${nodeName}\`: no tool named \`${toolName}\` is registered in the registry.`;
}

function fmtMissingRequired(nodeName: string, toolName: string, portName: string): string {
  return `Missing required input at node \`${nodeName}\`: tool \`${toolName}\` requires port \`${portName}\` but no value was provided.`;
}

function fmtInvalidReference(nodeName: string, ref: string): string {
  return `Invalid upstream reference at node \`${nodeName}\`: \`${ref}\` does not resolve to a known node and output port.`;
}

function fmtInvalidBackend(nodeName: string, backend: string): string {
  return `Invalid backend at node \`${nodeName}\`: \`${backend}\` is not supported. Supported backends: ${[...VALID_BACKENDS].join(', ')}.`;
}

// ---------- Main checker ----------

export function checkWorkflow(
  parsed: ParsedWorkflowYaml,
  registry: RegistryClient,
  schemas: SchemaRegistry,
): TypeCheckResult {
  const errors: TypeError[] = [];
  const warnings: TypeWarning[] = [];
  const resolvedNodes = new Map<string, ResolvedNode>();
  const converterInsertions: ConverterInsertion[] = [];

  // Port schema table: nodeName → portName → { schemaName, parsedTypeExpr? }
  const portSchemaTable = new Map<string, Map<string, { schemaName: string; parsed?: TypeExpr }>>();

  const workflowName = parsed.name ?? '<unnamed>';
  const nodes = parsed.nodes ?? [];

  for (const node of nodes) {
    const nodeName: string = node.name;

    if (node.kind === 'tool') {
      // Step 1: Resolve tool
      const toolName: string = node.tool;
      const toolRecord = registry.get(toolName);
      if (!toolRecord) {
        errors.push({
          category: 'tool_not_found',
          message: fmtToolNotFound(nodeName, toolName),
          location: { nodeName },
        });
        continue; // Cannot proceed without the tool manifest
      }

      resolvedNodes.set(nodeName, {
        kind: 'tool',
        resolvedToolName: toolRecord.name,
        resolvedVersion: toolRecord.version,
      });

      // Step 2 & 3: Resolve inputs and check compatibility
      const nodeInputs: Record<string, unknown> = node.inputs ?? {};

      for (const [portName, portSpec] of Object.entries(toolRecord.inputs)) {
        const targetSchemaName = portSpec.schemaName;
        // Note: portSpec is a ResolvedPort (from RegistryClient.get()); parsedTypeExpr
        // is on ToolPortSpec from the manifest, not on ResolvedPort.
        // The type checker works with schema name strings for named types.

        const rawValue = nodeInputs[portName];

        if (rawValue === undefined) {
          // Check required
          if (portSpec.required) {
            errors.push({
              category: 'missing_required_input',
              message: fmtMissingRequired(nodeName, toolName, portName),
              location: { nodeName },
            });
          }
          continue;
        }

        const source = parseInputSourceExpr(rawValue);

        let resolvedSourceSchema: string | null = null;

        if (source.kind === 'literal') {
          resolvedSourceSchema = source.schemaHint;
        } else if (source.kind === 'config') {
          // Config substitutions: infer schema from config value if present,
          // otherwise accept (cannot validate config at parse time).
          const configVal = parsed.config?.[source.key];
          if (configVal !== undefined) {
            resolvedSourceSchema = parseInputSourceExpr(configVal).kind === 'literal'
              ? (parseInputSourceExpr(configVal) as { kind: 'literal'; schemaHint: string }).schemaHint
              : null;
          } else {
            // Key not in config — cannot resolve; emit warning-level skip
            continue;
          }
        } else if (source.kind === 'upstream') {
          const upstreamPortMap = portSchemaTable.get(source.nodeName);
          const upstreamPortInfo = upstreamPortMap?.get(source.portName);
          if (!upstreamPortInfo) {
            errors.push({
              category: 'invalid_reference',
              message: fmtInvalidReference(
                nodeName,
                `\${${source.nodeName}.outputs.${source.portName}}`,
              ),
              location: { nodeName },
            });
            continue;
          }
          resolvedSourceSchema = upstreamPortInfo.schemaName;

          // Check compatibility
          const compatible = schemasCompatible(
            resolvedSourceSchema,
            targetSchemaName,
            upstreamPortInfo.parsed,
            undefined, // ResolvedPort does not carry parsedTypeExpr in current types
          );

          if (!compatible) {
            // Try converter
            const converter = registry.findConverter(resolvedSourceSchema, targetSchemaName);
            if (converter) {
              converterInsertions.push({
                upstreamNode: source.nodeName,
                upstreamPort: source.portName,
                downstreamNode: nodeName,
                downstreamPort: portName,
                converterTool: converter.toolName,
                converterVersion: converter.toolVersion,
              });
            } else {
              errors.push({
                category: 'type_mismatch',
                message: fmtTypeMismatch({
                  workflowName,
                  nodeName,
                  portName,
                  toolName,
                  targetSchema: targetSchemaName,
                  upstreamNode: source.nodeName,
                  upstreamPort: source.portName,
                  sourceSchema: resolvedSourceSchema,
                }),
                location: { nodeName },
                details: {
                  sourceSchema: resolvedSourceSchema,
                  targetSchema: targetSchemaName,
                  upstreamNode: source.nodeName,
                  upstreamPort: source.portName,
                },
              });
            }
          }
          // Skip the generic literal compatibility check below
          continue;
        } else {
          continue; // unknown source kind
        }

        // For literals: basic schema compatibility (string with Integer is an error etc.)
        if (resolvedSourceSchema && resolvedSourceSchema !== targetSchemaName) {
          // Only emit if schemas are not trivially compatible
          // (Literals are accepted if they are the right JSON type)
          const compatible = schemasCompatible(resolvedSourceSchema, targetSchemaName, undefined, undefined);
          if (!compatible) {
            errors.push({
              category: 'type_mismatch',
              message: `Type mismatch at node \`${nodeName}\` port \`${portName}\`: literal value has inferred schema \`${resolvedSourceSchema}\` but tool \`${toolName}\` expects \`${targetSchemaName}\`.`,
              location: { nodeName },
            });
          }
        }
      }

      // Step 6: Record output schemas in port schema table
      const outMap = new Map<string, { schemaName: string; parsed?: TypeExpr }>();
      for (const [outPortName, outPortSpec] of Object.entries(toolRecord.outputs)) {
        outMap.set(outPortName, { schemaName: outPortSpec.schemaName });
      }
      portSchemaTable.set(nodeName, outMap);

    } else if (node.kind === 'reasoning') {
      // Step 1: Validate backend
      const backend: string = node.backend ?? '';
      if (!VALID_BACKENDS.has(backend)) {
        errors.push({
          category: 'invalid_backend',
          message: fmtInvalidBackend(nodeName, backend),
          location: { nodeName },
        });
      }

      // Step 2: Expand toolset
      const resolvedToolNames: string[] = [];
      for (const toolsetEntry of (node.toolset ?? [])) {
        if (toolsetEntry.name) {
          const t = registry.get(toolsetEntry.name);
          if (!t) {
            errors.push({
              category: 'tool_not_found',
              message: fmtToolNotFound(nodeName, toolsetEntry.name),
              location: { nodeName },
            });
          } else {
            resolvedToolNames.push(t.name);
          }
        } else if (toolsetEntry.category) {
          const tools = registry.list({ category: toolsetEntry.category });
          if (tools.length === 0) {
            warnings.push({
              category: 'empty_category',
              message: `Toolset in node \`${nodeName}\` references category \`${toolsetEntry.category}\` which has no registered tools.`,
              location: { nodeName },
            });
          } else {
            resolvedToolNames.push(...tools.map((t) => t.name));
          }
        }
      }

      resolvedNodes.set(nodeName, {
        kind: 'reasoning',
        resolvedBackend: backend,
        resolvedToolset: resolvedToolNames,
      });
    }

    // Cross-node: validate depends_on references
    for (const dep of (node.depends_on ?? [])) {
      if (!nodes.some((n) => n.name === dep)) {
        errors.push({
          category: 'invalid_reference',
          message: `Node \`${nodeName}\` depends_on \`${dep}\` which is not a declared node in this workflow.`,
          location: { nodeName },
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    resolvedPlan: { nodes: resolvedNodes, converterInsertions },
  };
}
```

**Implementation notes for the implementer:**
- The `RegistryClient.get()` and `registry.list()` signatures must be verified against the actual API before writing. If `get()` returns `ToolRecord | null` and `ToolRecord.inputs` is a `ResolvedPort[]`, adapt the iteration accordingly (loop over array, not `Object.entries`).
- `ParsedWorkflowYaml` (= `WorkflowConfig`) structure must be read from `yaml-parser.ts` before trusting the field names (`node.kind`, `node.tool`, `node.inputs`, `node.toolset`, `node.backend`, `node.depends_on`, `parsed.config`, `parsed.name`, `parsed.nodes`) — verify each field name against the actual type.
- If `ToolRecord.inputs` is an array of `ResolvedPort`, replace `Object.entries(toolRecord.inputs)` with a loop over `toolRecord.inputs` and use `.name` + `.schemaName` + `.required`.

- [ ] **Step 2: Type-check**

```bash
(cd packages/server && npx tsc --noEmit)
```

Fix all errors before committing.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/workflow/type-checker.ts
git commit -m "tr-phase4: implement checkWorkflow() type checker (type-checker.ts)"
```

---

### Task 16 (= spec Task 13): Wire `checkWorkflow()` into `DagExecutor.start()`

**Files:**
- Modify: `packages/server/src/modules/workflow/dag-executor.ts`

- [ ] **Step 1: Read `DagExecutor.start()` in full before editing**

Locate `DagExecutor.start()` in `dag-executor.ts`. Find the call to `parseWorkflow()` and identify the lines immediately after it.

- [ ] **Step 2: Add `resolvedPlan` private field**

At the top of the class body, add:

```typescript
private resolvedPlan: ResolvedWorkflowPlan | null = null;
```

Import `ResolvedWorkflowPlan` from `./type-checker.js`.

- [ ] **Step 3: Call `checkWorkflow()` immediately after `parseWorkflow()`**

```typescript
const workflow = parseWorkflow(yamlContent);

const typeCheckResult = checkWorkflow(workflow, this.registryClient, this.schemas);
if (!typeCheckResult.ok) {
  throw new Error(
    `Workflow type check failed:\n` +
    typeCheckResult.errors.map((e) => e.message).join('\n\n'),
  );
}
this.resolvedPlan = typeCheckResult.resolvedPlan;
```

Import `checkWorkflow` from `./type-checker.js`.

- [ ] **Step 4: Run workflow tests**

```bash
(cd packages/server && npx vitest run src/modules/workflow/)
```

Expected: all existing tests green. The checker runs on all existing test workflows; if any of them are not well-typed, this step will surface the issue — fix the test workflow YAML rather than weakening the checker.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/workflow/dag-executor.ts
git commit -m "tr-phase4: wire checkWorkflow into DagExecutor.start(); add resolvedPlan field"
```

---

### Task 17 (= spec Task 14): Write `type-checker.test.ts`

**Files:**
- Create: `packages/server/src/modules/workflow/__tests__/type-checker.test.ts`

- [ ] **Step 1: Write test file (abbreviated skeleton — implementer fleshes out each case)**

Cover at minimum:

| Test | Setup | Expected |
|---|---|---|
| Happy path — well-typed | 2 tools, matching schemas | `ok: true`, 0 errors |
| Converter auto-inserted | source=DataFrame, target=NumpyArray, converter registered | `ok: true`, 1 `ConverterInsertion` |
| Type mismatch, no converter | source=DataFrame, target=OhlcFrame, no converter | `ok: false`, 1 `type_mismatch` error, message contains both schema names |
| Error message template | same as above | message contains "No converter is registered" + "Possible fixes" |
| Missing required input | tool has required port, node inputs block omits it | `ok: false`, `missing_required_input` |
| Tool not found | node references `does.not.exist` | `ok: false`, `tool_not_found` |
| Invalid backend | reasoning node with `backend: gpt4all` | `ok: false`, `invalid_backend` |
| Invalid upstream reference | `${missing.outputs.x}` | `ok: false`, `invalid_reference` |
| Empty category warning | reasoning node, category has no tools | `ok: true`, `TypeWarning` with `empty_category` |
| Invalid depends_on | `depends_on: [ghost_node]` | `ok: false`, `invalid_reference` |

Use a test-local `MockRegistryClient` that implements `get()`, `list()`, and `findConverter()` backed by an in-memory map — avoids SQLite setup in unit tests.

- [ ] **Step 2: Run and confirm green**

```bash
(cd packages/server && npx vitest run src/modules/workflow/__tests__/type-checker.test.ts)
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/workflow/__tests__/type-checker.test.ts
git commit -m "tr-phase4: type-checker unit tests (10 scenarios, all error categories)"
```

---

### Task 18 (= spec Task 15): Add end-to-end type check test to `dag-executor-tool-nodes.test.ts`

**Files:**
- Modify: the existing `dag-executor-tool-nodes.test.ts` (locate exact path with grep)

- [ ] **Step 1: Locate the file**

```bash
grep -rn "dag-executor-tool-nodes" packages/server/src/ --include="*.ts" -l
```

- [ ] **Step 2: Add 2 new test cases**

| Case | YAML | Expected |
|---|---|---|
| Mismatched schemas, no converter | 2 nodes, producer output `DataFrame`, consumer input `OhlcFrame`, no converter | `executor.start()` throws with message containing "type_mismatch" or "Type mismatch" |
| Converter auto-inserted | same but converter `DataFrame→OhlcFrame` registered beforehand | `executor.start()` does not throw |

- [ ] **Step 3: Run**

```bash
(cd packages/server && npx vitest run src/modules/workflow/__tests__/dag-executor-tool-nodes.test.ts)
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/workflow/__tests__/dag-executor-tool-nodes.test.ts
git commit -m "tr-phase4: e2e type-check tests in dag-executor (mismatch throws, converter passes)"
```

---

### Task 19 (= spec Task 18): Update `checkCompatibility()` in `type-checker.ts` to use `typeExprEqual()` for parametrized ports

**Files:**
- Modify: `packages/server/src/modules/workflow/type-checker.ts`

*4d (Task 12) must have landed before this task.*

The `schemasCompatible()` helper in `type-checker.ts` currently handles two cases: both parametrized (use `typeExprEqual`) or both named (string equality). However, the current `ResolvedPort` type in `types.ts` does not carry `parsedTypeExpr` — only `ToolPortSpec` does, and `ToolPortSpec` is the manifest-level representation.

- [ ] **Step 1: Decide how to surface `parsedTypeExpr` at check time**

Two options:
- **Option A:** Extend `ResolvedPort` in `types.ts` with `parsedTypeExpr?: TypeExpr`. The manifest parser populates it; the DB serialization stores the raw schema string and re-parses on read.
- **Option B:** At check time, re-parse the port schema string if it contains `[` using `parseTypeExpr`.

**Use Option B** (simpler, no DB schema change). In `type-checker.ts`, when reading a port's schema for comparison, always re-parse if the schema string contains `[`:

```typescript
import { parseTypeExpr } from './type-parser.js';

function parsePortSchema(schemaName: string): TypeExpr | undefined {
  if (schemaName.includes('[')) {
    try { return parseTypeExpr(schemaName); } catch { return undefined; }
  }
  return undefined;
}
```

Then in the compatibility check:

```typescript
const sourceParsed = resolvedSourceSchema ? parsePortSchema(resolvedSourceSchema) : undefined;
const targetParsed = parsePortSchema(targetSchemaName);

const compatible = schemasCompatible(
  resolvedSourceSchema ?? '',
  targetSchemaName,
  sourceParsed,
  targetParsed,
);
```

- [ ] **Step 2: Add a `parsePortSchema` helper and update all call sites**

The two call sites where `schemasCompatible()` is invoked (upstream reference check and literal check) both need the updated `sourceParsed` / `targetParsed` arguments.

- [ ] **Step 3: Verify `type-checker.test.ts` still passes**

Add one new test case: a workflow with a tool port declared as `List[Integer]` fed from a tool producing `List[Integer]` → `ok: true`. And `List[Integer]` fed from `List[Float]` → `ok: false`, `type_mismatch`.

```bash
(cd packages/server && npx vitest run src/modules/workflow/__tests__/type-checker.test.ts)
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/workflow/type-checker.ts \
        packages/server/src/modules/workflow/__tests__/type-checker.test.ts
git commit -m "tr-phase4: type-checker uses typeExprEqual for parametrized port schema comparison"
```

---

## Sub-phase 4c — Runtime Validators (~2 days)

*4c is independent of 4b at the implementation level; can run in parallel. Must complete before 4e begins.*

### Task 20 (= spec Task 20): Write 4 Python validator files

**Files:**
- Create: `packages/server/src/modules/registry/schemas/validators/ohlc_frame.py`
- Create: `packages/server/src/modules/registry/schemas/validators/features_frame.py`
- Create: `packages/server/src/modules/registry/schemas/validators/numpy_array.py`
- Create: `packages/server/src/modules/registry/schemas/validators/symbolic_expr.py`

**`ohlc_frame.py`:**
```python
import pandas as pd


REQUIRED_COLUMNS = {"open", "high", "low", "close"}


def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    if not isinstance(value, pd.DataFrame):
        return False, f"Expected pandas.DataFrame, got {type(value).__name__}."
    missing = REQUIRED_COLUMNS - set(value.columns)
    if missing:
        return False, f"OhlcFrame is missing required columns: {sorted(missing)}."
    for col in REQUIRED_COLUMNS:
        if not pd.api.types.is_numeric_dtype(value[col]):
            return False, f"Column '{col}' must be numeric, got dtype {value[col].dtype}."
    if not hasattr(value.index, 'dtype'):
        return False, "OhlcFrame index must be a DatetimeIndex."
    if not (pd.api.types.is_datetime64_any_dtype(value.index)):
        return False, f"OhlcFrame index must be datetime64, got {value.index.dtype}."
    if not value.index.is_monotonic_increasing:
        return False, "OhlcFrame index must be monotonically increasing."
    return True, None
```

**`features_frame.py`:**
```python
import pandas as pd


def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    if not isinstance(value, pd.DataFrame):
        return False, f"Expected pandas.DataFrame, got {type(value).__name__}."
    if value.shape[1] == 0:
        return False, "FeaturesFrame must have at least one feature column."
    if not pd.api.types.is_datetime64_any_dtype(value.index):
        return False, f"FeaturesFrame index must be datetime-like, got {value.index.dtype}."
    for col in value.columns:
        if not pd.api.types.is_numeric_dtype(value[col]):
            return False, f"All feature columns must be numeric; column '{col}' has dtype {value[col].dtype}."
    return True, None
```

**`numpy_array.py`:**
```python
import numpy as np


def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    if not isinstance(value, np.ndarray):
        return False, f"Expected numpy.ndarray, got {type(value).__name__}."
    return True, None
```

**`symbolic_expr.py`:**
```python
try:
    import sympy
    _sympy_available = True
except ImportError:
    _sympy_available = False


def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    if not _sympy_available:
        return True, None  # Cannot validate without sympy; pass through.
    if not isinstance(value, sympy.Basic):
        return False, f"Expected sympy.Basic, got {type(value).__name__}."
    return True, None
```

- [ ] **Step 1: Create the `validators/` directory and write all 4 files as above**
- [ ] **Step 2: Commit**

```bash
git add packages/server/src/modules/registry/schemas/validators/
git commit -m "tr-phase4: write 4 Python runtime validators (OhlcFrame, FeaturesFrame, NumpyArray, SymbolicExpr)"
```

---

### Task 21 (= spec Task 21): Wire `validatorModule` / `validatorFunction` into `builtin.ts`

**Files:**
- Modify: `packages/server/src/modules/registry/schemas/builtin.ts`

- [ ] **Step 1: Set validator fields on the 4 schemas that ship validators**

Find the entries for `OhlcFrame`, `FeaturesFrame`, `NumpyArray`, and `SymbolicExpr` in `BUILTIN_SCHEMAS` and add:

| Schema | `validatorModule` | `validatorFunction` |
|---|---|---|
| `OhlcFrame` | `schemas/validators/ohlc_frame.py` | `validate` |
| `FeaturesFrame` | `schemas/validators/features_frame.py` | `validate` |
| `NumpyArray` | `schemas/validators/numpy_array.py` | `validate` |
| `SymbolicExpr` | `schemas/validators/symbolic_expr.py` | `validate` |

- [ ] **Step 2: Run schema tests**

```bash
(cd packages/server && npx vitest run src/modules/registry/schemas/)
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/schemas/builtin.ts
git commit -m "tr-phase4: wire validatorModule/Function into 4 built-in schema entries"
```

---

### Task 22 (= spec Task 22): Update `runner.py` to invoke schema validators; add `SchemaValidationError`

**Files:**
- Modify: `packages/server/src/modules/registry/python/runner.py`

- [ ] **Step 1: Read `runner.py` in full** to understand the current input deserialization flow and where to hook the validator call.

- [ ] **Step 2: Add `SchemaValidationError` class and validator loader**

```python
import os

class SchemaValidationError(Exception):
    def __init__(self, schema_name: str, message: str):
        self.schema_name = schema_name
        self.message = message
        super().__init__(f"Schema validation failed for {schema_name!r}: {message}")


def load_validator(validator_module_path: str, validator_function: str):
    """Load a validator Python file and return the callable."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("_validator", validator_module_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, validator_function)


_validator_cache: dict = {}


def get_validator(module_path: str, function_name: str):
    key = (module_path, function_name)
    if key not in _validator_cache:
        _validator_cache[key] = load_validator(module_path, function_name)
    return _validator_cache[key]
```

- [ ] **Step 3: Check `PLURICS_DISABLE_VALIDATION` at the top of runner startup**

```python
VALIDATION_DISABLED = os.environ.get("PLURICS_DISABLE_VALIDATION", "0") == "1"
```

- [ ] **Step 4: Insert validator invocation in the input deserialization path**

After each input value is deserialized (after pickle or JSON decode), and if the schema's `validator_module` is set (passed in the invocation envelope), call:

```python
if not VALIDATION_DISABLED and schema_info.get("validator_module"):
    fn = get_validator(schema_info["validator_module"], schema_info.get("validator_function", "validate"))
    ok, err_msg = fn(deserialized_value, schema_info)
    if not ok:
        raise SchemaValidationError(schema_info["name"], err_msg)
```

The `schema_info` dict is populated from the tool invocation request envelope (which the executor must now extend to include validator info — see Task 23).

- [ ] **Step 5: Map `SchemaValidationError` to a structured error output**

In the runner's main exception handler, add a case for `SchemaValidationError`:

```python
except SchemaValidationError as e:
    result = {
        "success": False,
        "error": {
            "category": "schema_validation_failed",
            "message": str(e),
            "schema": e.schema_name,
        }
    }
```

- [ ] **Step 6: Emit `validation_disabled` log entry when `PLURICS_DISABLE_VALIDATION=1`**

At runner startup, if `VALIDATION_DISABLED`:
```python
if VALIDATION_DISABLED:
    print(json.dumps({"type": "validation_disabled", "message": "PLURICS_DISABLE_VALIDATION=1 is set; schema validators are suppressed."}), flush=True)
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/python/runner.py
git commit -m "tr-phase4: runner invokes schema validators; SchemaValidationError; PLURICS_DISABLE_VALIDATION"
```

---

### Task 23 (= spec Task 23): Update `executor.ts` to pass validator info and map `schema_validation_failed`

**Files:**
- Modify: `packages/server/src/modules/registry/execution/executor.ts`

- [ ] **Step 1: Read `executor.ts`** to find where the tool invocation envelope is constructed (the JSON sent to the runner subprocess).

- [ ] **Step 2: Extend the invocation envelope with schema validator info**

For each input port, look up the schema definition from `SchemaRegistry`. If the schema has `validatorModule`, include it in the port's schema info sent to the runner:

```typescript
const schemaInfo = schemas.get(portSpec.schemaName);
const portEnvelope = {
  name: portSpec.schemaName,
  encoding: portSpec.encoding,
  validator_module: schemaInfo?.validatorModule ?? null,
  validator_function: schemaInfo?.validatorFunction ?? 'validate',
};
```

- [ ] **Step 3: Add `'schema_validation_failed'` to `InvocationErrorCategory` in `types.ts`**

```typescript
export type InvocationErrorCategory =
  | 'tool_not_found'
  | 'validation'
  | 'timeout'
  | 'runtime'
  | 'output_mismatch'
  | 'subprocess_crash'
  | 'python_unavailable'
  | 'schema_validation_failed';   // new
```

- [ ] **Step 4: Map the runner's `schema_validation_failed` category through to the TypeScript `InvocationResult`**

The runner already returns `{ success: false, error: { category: 'schema_validation_failed', ... } }`. The executor's response parser must pass this category through without remapping it to `runtime`.

- [ ] **Step 5: Run execution tests**

```bash
(cd packages/server && npx vitest run src/modules/registry/execution/)
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/registry/execution/executor.ts \
        packages/server/src/modules/registry/types.ts
git commit -m "tr-phase4: executor passes validator info to runner; maps schema_validation_failed"
```

---

### Task 24 (= spec Task 24): Add `PLURICS_DISABLE_VALIDATION` handling; surface `validation_disabled` TypeWarning

**Files:**
- Modify: `packages/server/src/modules/workflow/dag-executor.ts`

- [ ] **Step 1: Read the run log / event log parsing code in `dag-executor.ts`**

Find where the executor reads the runner's stdout log entries and converts them to events.

- [ ] **Step 2: Handle `validation_disabled` log entry type**

When parsing runner output, if an entry has `type: 'validation_disabled'`, append a `TypeWarning` to the run summary:

```typescript
if (logEntry.type === 'validation_disabled') {
  this.warnings.push({
    category: 'validation_disabled',
    message: logEntry.message,
    location: { nodeName: currentNodeName },
  });
}
```

The `this.warnings` list (or equivalent) is included in the `RunSnapshot`.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/workflow/dag-executor.ts
git commit -m "tr-phase4: surface validation_disabled TypeWarning in run summary"
```

---

## Sub-phase 4e — Converter Insertion at Runtime (~2 days)

*Requires 4b (Task 16 — `resolvedPlan` field on `DagExecutor`) and 4c (Tasks 20–24 — validators and executor wiring).*

### Task 25 (= spec Task 25): Implement converter materialization in `DagExecutor` tool node execution path

**Files:**
- Modify: `packages/server/src/modules/workflow/dag-executor.ts`

- [ ] **Step 1: Read the tool node execution code in `DagExecutor`**

Find the method or code block that executes a tool node (invokes the tool via `registryClient.invoke()`).

- [ ] **Step 2: Insert converter pre-invocation step**

Before invoking the target tool, check `this.resolvedPlan?.converterInsertions` for any entries where `downstreamNode === currentNodeName`:

```typescript
for (const insertion of (this.resolvedPlan?.converterInsertions ?? [])) {
  if (insertion.downstreamNode !== currentNodeName) continue;

  // 1. Retrieve the upstream handle
  const upstreamHandle = this.valueStore.getHandle(insertion.upstreamNode, insertion.upstreamPort);

  // 2. Invoke the converter tool
  const converterResult = await this.registryClient.invoke({
    toolName: insertion.converterTool,
    version: insertion.converterVersion,
    inputs: { source: upstreamHandle },
    callerContext: {
      workflowRunId: this.runId,
      nodeName: `converter(${insertion.upstreamNode}→${insertion.downstreamNode})`,
      scope: null,
    },
  });

  if (!converterResult.success) {
    throw new Error(
      `Converter ${insertion.converterTool} failed: ${converterResult.error.message}`,
    );
  }

  // 3. Store converted value under a synthetic handle key
  const syntheticKey = `converter-${insertion.upstreamNode}-${insertion.upstreamPort}-${insertion.downstreamNode}-${insertion.downstreamPort}`;
  this.valueStore.storeHandle(syntheticKey, converterResult.outputs.target);

  // 4. Replace the input binding for the downstream tool
  nodeInputOverrides[insertion.downstreamPort] = syntheticKey;
}
```

The `nodeInputOverrides` map is applied when building the tool's input dict, replacing the raw upstream reference with the converted handle. Verify the exact API for `valueStore.getHandle()` and `valueStore.storeHandle()` by reading `value-store.ts` first.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/workflow/dag-executor.ts
git commit -m "tr-phase4: materialize ConverterInsertions in DagExecutor tool node execution"
```

---

### Task 26 (= spec Task 26): Add `converter_inserted` event log entry type

**Files:**
- Modify: `packages/server/src/modules/registry/types.ts` (event log entry type union)
- Modify: `packages/server/src/modules/workflow/dag-executor.ts` (append entry after converter invocation)

- [ ] **Step 1: Add the event type to `types.ts`**

Locate the event log entry type union (likely named `RunEvent` or similar). Add:

```typescript
| {
    type: 'converter_inserted';
    converterTool: string;
    converterVersion: number;
    upstreamNode: string;
    upstreamPort: string;
    downstreamNode: string;
    downstreamPort: string;
    convertedHandle: string;
    durationMs: number;
  }
```

- [ ] **Step 2: Append to `this.eventLog` after converter invocation in `DagExecutor`**

```typescript
this.eventLog.push({
  type: 'converter_inserted',
  converterTool: insertion.converterTool,
  converterVersion: insertion.converterVersion,
  upstreamNode: insertion.upstreamNode,
  upstreamPort: insertion.upstreamPort,
  downstreamNode: insertion.downstreamNode,
  downstreamPort: insertion.downstreamPort,
  convertedHandle: syntheticKey,
  durationMs: converterDurationMs,
});
```

- [ ] **Step 3: Type-check and run workflow tests**

```bash
(cd packages/server && npx tsc --noEmit && npx vitest run src/modules/workflow/)
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/registry/types.ts \
        packages/server/src/modules/workflow/dag-executor.ts
git commit -m "tr-phase4: add converter_inserted event log entry type; append after converter invocation"
```

---

### Task 27 (= spec Task 27): Add resume-path skip logic for already-completed converter insertions

**Files:**
- Modify: `packages/server/src/modules/workflow/dag-executor.ts`

- [ ] **Step 1: Read the existing idempotent skip logic for tool nodes on resume**

Find where `DagExecutor` re-reads the event log on resume and skips already-completed tool nodes.

- [ ] **Step 2: Add analogous skip for `converter_inserted` events**

When resuming, before processing converter insertions for a node, check if a `converter_inserted` event already exists in the log for the same `(upstreamNode, upstreamPort, downstreamNode, downstreamPort)` tuple. If yes, skip re-invocation and reuse `convertedHandle` from the log entry.

```typescript
const alreadyConverted = this.eventLog.find(
  (e) =>
    e.type === 'converter_inserted' &&
    e.upstreamNode === insertion.upstreamNode &&
    e.upstreamPort === insertion.upstreamPort &&
    e.downstreamNode === insertion.downstreamNode &&
    e.downstreamPort === insertion.downstreamPort,
);

if (alreadyConverted && alreadyConverted.type === 'converter_inserted') {
  nodeInputOverrides[insertion.downstreamPort] = alreadyConverted.convertedHandle;
  continue;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/workflow/dag-executor.ts
git commit -m "tr-phase4: resume-path skips already-completed converter insertions"
```

---

### Task 28 (= spec Task 28): Write integration test — 2-node workflow with OhlcFrame→ReturnSeries converter

**Files:**
- Modify or Create: integration test file in `packages/server/src/modules/workflow/__tests__/`

- [ ] **Step 1: Locate the most appropriate existing integration test file for DAG executor**

```bash
grep -rn "dag-executor" packages/server/src/modules/workflow/__tests__/ -l
```

Add to the most relevant file, or create `dag-executor-converter.test.ts` if a new file is cleaner.

- [ ] **Step 2: Write the integration test**

```typescript
describe.skipIf(!pythonAvailable() || !libsAvailable(['pandas', 'numpy']))(
  'converter insertion end-to-end (OhlcFrame → ReturnSeries)',
  () => {
    it('executes a 2-node workflow with auto-inserted OhlcFrame→ReturnSeries converter', async () => {
      // Setup:
      //   Node A: a tool that produces an OhlcFrame
      //   Node B: a tool that consumes a ReturnSeries
      //   Converter: convert.OhlcFrame_to_ReturnSeries (already seeded)
      //
      // Workflow YAML connects A's output to B's input.
      // The type checker inserts the converter automatically.
      //
      // After executor.start() + await completion:
      // 1. eventLog contains a 'converter_inserted' entry for convert.OhlcFrame_to_ReturnSeries
      // 2. Node B received a value of schema ReturnSeries
      // 3. Overall workflow succeeded

      const yamlContent = `
name: test-ohlc-to-return
nodes:
  - name: producer
    kind: tool
    tool: <ohlc-producing tool name>
    inputs: {}
  - name: consumer
    kind: tool
    tool: <return-series-consuming tool name>
    inputs:
      returns: \${producer.outputs.ohlc}
    depends_on: [producer]
`;

      // Initialize executor with loaded seed tools
      // Run executor.start()
      // Await completion
      // Assert:
      const converterEvent = executor.eventLog.find(
        (e) => e.type === 'converter_inserted' &&
               e.converterTool === 'convert.OhlcFrame_to_ReturnSeries',
      );
      expect(converterEvent).toBeDefined();
      // Assert node B output exists in value store
    });
  },
);
```

Note: The implementer must substitute actual tool names that exist in the seed catalog (one that produces OhlcFrame, one that consumes ReturnSeries). If no such tools exist yet, a minimal fixture tool pair should be written specifically for this test.

- [ ] **Step 3: Run**

```bash
(cd packages/server && npx vitest run src/modules/workflow/__tests__/dag-executor-converter.test.ts)
```

- [ ] **Step 4: Run full test suite — confirm ≥ 395 passing, 0 failing**

```bash
(cd packages/server && npx vitest run)
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/workflow/__tests__/dag-executor-converter.test.ts
git commit -m "tr-phase4: e2e integration test for OhlcFrame→ReturnSeries converter insertion"
```

---

## Summary Table

| Task | Sub-phase | Full/Abbreviated | Description |
|---|---|---|---|
| 1 | 4a | FULL | Add 8 new structured schemas to `builtin.ts` |
| 2 | 4a | FULL | Extend `types.ts` — validator fields + converter metadata |
| 3 | 4a | FULL | `converters` SQL table; `insertConverter()`; `findConverter()` |
| 4 | 4a | FULL | `parser.ts` reads converter metadata; `validator.ts` enforces constraints |
| 5 | 4a | abbreviated | Wire `insertConverter` in `insertTool`; expose on `RegistryClient` |
| 6 | 4a | abbreviated | Write `converter-registry.test.ts` |
| 7 | 4a | abbreviated | `convert.DataFrame_to_NumpyArray` seed tool |
| 8 | 4a | abbreviated | `convert.NumpyArray_to_DataFrame` seed tool |
| 9 | 4a | abbreviated | `convert.OhlcFrame_to_ReturnSeries` seed tool |
| 10 | 4a | abbreviated | Full suite run; seed count 69 integration check |
| 11 | 4d | abbreviated | Export `ParsedWorkflowYaml` alias |
| 12 | 4d | FULL | Implement `type-parser.ts` (complete source) |
| 13 | 4d | abbreviated | Wire parser into manifest `parser.ts` |
| 14 | 4d | FULL | Write `type-parser.test.ts` (30+ cases, complete source) |
| 15 | 4b | FULL | Implement `type-checker.ts` (complete source) |
| 16 | 4b | FULL | Wire `checkWorkflow()` into `DagExecutor.start()` |
| 17 | 4b | FULL | Write `type-checker.test.ts` (10 scenarios) |
| 18 | 4b | abbreviated | E2E type-check tests in `dag-executor-tool-nodes.test.ts` |
| 19 | 4b+4d | FULL | Update `checkCompatibility()` for parametrized ports |
| 20 | 4c | abbreviated | Write 4 Python validator files |
| 21 | 4c | abbreviated | Wire `validatorModule`/`Function` into `builtin.ts` |
| 22 | 4c | abbreviated | Update `runner.py`: invoke validators; `SchemaValidationError` |
| 23 | 4c | abbreviated | Update `executor.ts`: pass validator info; map error category |
| 24 | 4c | abbreviated | Surface `validation_disabled` TypeWarning in run summary |
| 25 | 4e | abbreviated | Converter materialization in `DagExecutor` tool node path |
| 26 | 4e | abbreviated | `converter_inserted` event log entry type |
| 27 | 4e | abbreviated | Resume-path skip logic for completed converter insertions |
| 28 | 4e | abbreviated | Integration test: OhlcFrame→ReturnSeries converter end-to-end |

**Full content tasks (implementer gets complete code):** 1, 2, 3, 4, 12, 14, 15, 16, 17, 19 (10 of 28)
**Abbreviated tasks (tool list, test skeleton, commit message only):** 5–11, 13, 18, 20–28 (18 of 28)

---

## Dependency Graph

```
Task 1  (schemas)  ──────────────────────────────────────────┐
Task 2  (types)    ──────────────────────────────────────────┤
Task 3  (db)       ─────────────────────────────────┐        │
Task 4  (parser)   ──────────────────────────────┐  │        │
Task 5  (wiring)   ──── after 3,4 ───────────────┤  │        │
Tasks 6–10 (seed tools + tests) ── after 1,2,3,4,5 ─┤        │
                                                   │        │
Task 11 (alias)    ──────────────────────────────────────┐   │
Task 12 (type-parser) ───────────────────────────────┐   │   │
Task 13 (wire parser) ── after 12 ───────────────────┤   │   │
Task 14 (type-parser tests) ── after 12 ─────────────┘   │   │
                                                          │   │
Tasks 15–19 (type-checker) ── after 3,11,12 ─────────────┘   │
                                                              │
Tasks 20–24 (validators) ── independent ──────────────────────┘
                             (but logically after 1,2)
Tasks 25–28 (converter runtime) ── after 15–16 and 20–24
```

---

*Plan generated 2026-04-12. Source of truth: `docs/superpowers/specs/2026-04-12-tool-registry-phase-4-design.md`. Design authority: `docs/design/type-system.md`.*
