# Tool Registry Phase 3 Full Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the remaining 52 seed tools (10 pilot already in place → 62 total after T11, 66 per the plan numbering below which includes 4 optimization tools counted from 62). Add the `SymbolicExpr` built-in schema. Land category-level integration test files. All 12 tasks commit to `main`.

**Architecture:** Same `seeds/tools/{name}/tool.yaml` + `tool.py` layout from the pilot. No new TS plumbing beyond schema addition. Each category lands in one commit.

**Tech Stack:** TypeScript ESM (NodeNext), vitest, existing `RegistryClient` API. Python 3 with scientific stack (user-installed; integration tests skip if absent).

**Source of truth:** `docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`. When this plan and the spec disagree, the spec wins.

**Test discipline:** The loader unit test asserts `result.registered + result.skipped === EXPECTED_COUNT`. Bump the count in each task commit. Integration tests use `describe.skipIf(!pythonAvailable() || !libsAvailable([...]))`. Scientific library imports go inside the `run()` function body — never at module top-level.

**Working directory for all commands:** `C:/Users/aless/PycharmProjects/ClaudeAgentAutoManager`. Run tests with `(cd packages/server && npx vitest run <path>)`.

**Commit style:** one commit per task, message `tr-phase3-full: <what>`.

---

## Task 1: SymbolicExpr built-in schema

**Files:**
- Modify: `packages/server/src/modules/registry/schemas/builtin.ts`
- Modify: Python runner (wherever `PICKLE_SCHEMAS` set is defined — locate via grep for `PICKLE_SCHEMAS`)
- Create: `packages/server/src/modules/registry/seeds/__tests__/schema.symbolic_expr.test.ts`

- [ ] **Step 1: Add `SymbolicExpr` entry to `builtin.ts`**

In `packages/server/src/modules/registry/schemas/builtin.ts`, append to the `BUILTIN_SCHEMAS` array before the closing `];`:

```typescript
  {
    name: 'SymbolicExpr',
    kind: 'structured',
    pythonRepresentation: 'sympy.Expr',
    encoding: 'pickle_b64',
    description: 'A symbolic mathematical expression (sympy.Expr). Encoded as pickle_b64.',
    source: 'builtin',
  },
```

The `PICKLE_SCHEMA_NAMES` export derives automatically from the filter, so no further change needed there.

- [ ] **Step 2: Add `SymbolicExpr` to the Python runner's `PICKLE_SCHEMAS` set**

Locate the runner file with:
```bash
grep -r "PICKLE_SCHEMAS" packages/server/
```
Add `'SymbolicExpr'` to the set alongside `'NumpyArray'` and `'DataFrame'`.

Also add the summarizer contract in the runner's summarize dispatch (same location as the NumpyArray summarizer):

```python
elif schema_name == 'SymbolicExpr':
    try:
        s = str(value)
        return s[:200] + '...' if len(s) > 200 else s
    except Exception:
        return '<unprintable SymbolicExpr>'
```

- [ ] **Step 3: Write schema registration test**

`packages/server/src/modules/registry/seeds/__tests__/schema.symbolic_expr.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BUILTIN_SCHEMAS, PICKLE_SCHEMA_NAMES } from '../../schemas/builtin.js';

describe('SymbolicExpr built-in schema', () => {
  it('is present in BUILTIN_SCHEMAS', () => {
    const schema = BUILTIN_SCHEMAS.find((s) => s.name === 'SymbolicExpr');
    expect(schema).toBeDefined();
    expect(schema!.encoding).toBe('pickle_b64');
    expect(schema!.pythonRepresentation).toBe('sympy.Expr');
  });

  it('appears in PICKLE_SCHEMA_NAMES', () => {
    expect(PICKLE_SCHEMA_NAMES).toContain('SymbolicExpr');
  });
});
```

- [ ] **Step 4: Run test — green**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/schema.symbolic_expr.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
(cd packages/server && npx tsc --noEmit)
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/registry/schemas/builtin.ts \
        packages/server/src/modules/registry/seeds/__tests__/schema.symbolic_expr.test.ts
git commit -m "tr-phase3-full: add SymbolicExpr built-in schema (pickle_b64)"
```

---

## Task 2: Descriptive stats completion (6 tools)

**Requires:** No NR Phase 2 dependency — all 6 tools have only `JsonArray`/primitive inputs.

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/stats.median/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.median/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.variance/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.variance/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.quantile/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.quantile/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.histogram/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.histogram/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.autocorrelation/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.autocorrelation/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.cross_correlation/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.cross_correlation/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 6 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 10→16)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/descriptive_stats.integration.test.ts`

- [ ] **Step 1: Bump loader test count 10→16 (red)**

In `loader.test.ts`, change the `EXPECTED_COUNT` assertion from `10` to `16`.

- [ ] **Step 2: Run loader test — confirm red**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

- [ ] **Step 3: Write all 6 tool files**

`packages/server/src/modules/registry/seeds/tools/stats.median/tool.yaml`:

```yaml
name: stats.median
version: 1
description: Compute the median of a list of numbers.
category: descriptive_stats
tags: [statistics, median, numpy]
stability: stable
cost_class: trivial
author: plurics-seeds
requires: [numpy]

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: List of numeric values.

outputs:
  - name: median
    schema: Float
    description: Median value.
```

`packages/server/src/modules/registry/seeds/tools/stats.median/tool.py`:

```python
def run(values):
    import numpy as np
    if not values:
        raise ValueError("values must be a non-empty list")
    return {"median": float(np.median(values))}
```

---

`packages/server/src/modules/registry/seeds/tools/stats.variance/tool.yaml`:

```yaml
name: stats.variance
version: 1
description: Compute the variance of a list of numbers.
category: descriptive_stats
tags: [statistics, variance, numpy]
stability: stable
cost_class: trivial
author: plurics-seeds
requires: [numpy]

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: List of numeric values.

outputs:
  - name: variance
    schema: Float
    description: Population variance.
```

`packages/server/src/modules/registry/seeds/tools/stats.variance/tool.py`:

```python
def run(values):
    import numpy as np
    if not values:
        raise ValueError("values must be a non-empty list")
    return {"variance": float(np.var(values))}
```

---

`packages/server/src/modules/registry/seeds/tools/stats.quantile/tool.yaml`:

```yaml
name: stats.quantile
version: 1
description: Compute a quantile of a list of numbers.
category: descriptive_stats
tags: [statistics, quantile, percentile, numpy]
stability: stable
cost_class: trivial
author: plurics-seeds
requires: [numpy]

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: List of numeric values.
  - name: q
    schema: Float
    required: true
    description: Quantile level in [0, 1].

outputs:
  - name: quantile
    schema: Float
    description: The q-th quantile of the input values.
```

`packages/server/src/modules/registry/seeds/tools/stats.quantile/tool.py`:

```python
def run(values, q):
    import numpy as np
    if not values:
        raise ValueError("values must be a non-empty list")
    if not (0.0 <= q <= 1.0):
        raise ValueError("q must be in [0, 1]")
    return {"quantile": float(np.quantile(values, q))}
```

---

`packages/server/src/modules/registry/seeds/tools/stats.histogram/tool.yaml`:

```yaml
name: stats.histogram
version: 1
description: Compute a histogram of a list of numbers.
category: descriptive_stats
tags: [statistics, histogram, bins, numpy]
stability: stable
cost_class: trivial
author: plurics-seeds
requires: [numpy]

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: List of numeric values.
  - name: bins
    schema: Integer
    required: true
    description: Number of histogram bins.

outputs:
  - name: counts
    schema: JsonArray
    description: Count of values in each bin.
  - name: edges
    schema: JsonArray
    description: Bin edge values (length = bins + 1).
```

`packages/server/src/modules/registry/seeds/tools/stats.histogram/tool.py`:

```python
def run(values, bins):
    import numpy as np
    if not values:
        raise ValueError("values must be a non-empty list")
    if bins < 1:
        raise ValueError("bins must be >= 1")
    counts, edges = np.histogram(values, bins=bins)
    return {"counts": counts.tolist(), "edges": edges.tolist()}
```

---

`packages/server/src/modules/registry/seeds/tools/stats.autocorrelation/tool.yaml`:

```yaml
name: stats.autocorrelation
version: 1
description: Compute the autocorrelation function (ACF) of a signal up to max_lag.
category: descriptive_stats
tags: [statistics, autocorrelation, acf, numpy]
stability: stable
cost_class: low
author: plurics-seeds
requires: [numpy]

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: Real-valued time series samples.
  - name: max_lag
    schema: Integer
    required: true
    description: Maximum lag to compute (inclusive).

outputs:
  - name: acf
    schema: JsonArray
    description: Autocorrelation values at lags 0..max_lag.
```

`packages/server/src/modules/registry/seeds/tools/stats.autocorrelation/tool.py`:

```python
def run(values, max_lag):
    import numpy as np
    arr = np.array(values, dtype=float)
    n = len(arr)
    if max_lag < 0 or max_lag >= n:
        raise ValueError("max_lag must be in [0, len(values)-1]")
    arr_mean = arr - arr.mean()
    full_corr = np.correlate(arr_mean, arr_mean, mode='full')
    acf = full_corr[n - 1: n + max_lag] / full_corr[n - 1]
    return {"acf": acf.tolist()}
```

---

`packages/server/src/modules/registry/seeds/tools/stats.cross_correlation/tool.yaml`:

```yaml
name: stats.cross_correlation
version: 1
description: Compute the cross-correlation function between two equal-length signals.
category: descriptive_stats
tags: [statistics, cross-correlation, ccf, numpy]
stability: stable
cost_class: low
author: plurics-seeds
requires: [numpy]

entry_point: tool.py:run

inputs:
  - name: x
    schema: JsonArray
    required: true
    description: First signal (list of numbers).
  - name: y
    schema: JsonArray
    required: true
    description: Second signal (same length as x).

outputs:
  - name: ccf
    schema: JsonArray
    description: Cross-correlation values (length = 2*len(x) - 1).
```

`packages/server/src/modules/registry/seeds/tools/stats.cross_correlation/tool.py`:

```python
def run(x, y):
    import numpy as np
    ax = np.array(x, dtype=float)
    ay = np.array(y, dtype=float)
    if ax.shape != ay.shape:
        raise ValueError("x and y must have the same length")
    ax_norm = ax - ax.mean()
    ay_norm = ay - ay.mean()
    ccf = np.correlate(ax_norm, ay_norm, mode='full')
    denom = np.sqrt(np.dot(ax_norm, ax_norm) * np.dot(ay_norm, ay_norm))
    if denom == 0:
        raise ValueError("one of the inputs has zero variance")
    return {"ccf": (ccf / denom).tolist()}
```

- [ ] **Step 4: Append 6 entries to `manifest.ts`**

```typescript
  { name: 'stats.median',            relPath: './tools/stats.median/tool.yaml' },
  { name: 'stats.variance',          relPath: './tools/stats.variance/tool.yaml' },
  { name: 'stats.quantile',          relPath: './tools/stats.quantile/tool.yaml' },
  { name: 'stats.histogram',         relPath: './tools/stats.histogram/tool.yaml' },
  { name: 'stats.autocorrelation',   relPath: './tools/stats.autocorrelation/tool.yaml' },
  { name: 'stats.cross_correlation', relPath: './tools/stats.cross_correlation/tool.yaml' },
```

- [ ] **Step 5: Run loader test — green**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: `registered + skipped === 16`.

- [ ] **Step 6: Write `descriptive_stats.integration.test.ts`**

`packages/server/src/modules/registry/seeds/__tests__/categories/descriptive_stats.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { pythonAvailable, libsAvailable } from '../helpers.js';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../../seeds/loader.js';
import { makeTmpRegistry } from '../fixtures/index.js';

const LIBS = ['numpy'];

describe('descriptive_stats seeds — integration', () => {
  let client: RegistryClient;

  beforeAll(async () => {
    client = await makeTmpRegistry();
    await loadSeedTools(client);
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'stats.median registers with correct output schema',
    async () => {
      const tool = await client.get('stats.median');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('descriptive_stats');
      expect(tool!.outputs[0].schemaName).toBe('Float');
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'stats.median invocation: median([1,2,3,4,5]) === 3.0',
    async () => {
      const result = await client.invoke('stats.median', { values: [1, 2, 3, 4, 5] });
      expect(result.median).toBeCloseTo(3.0);
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'stats.histogram returns counts + edges with correct lengths',
    async () => {
      const result = await client.invoke('stats.histogram', { values: [1,2,3,4,5,6,7,8,9,10], bins: 5 });
      expect(result.counts).toHaveLength(5);
      expect(result.edges).toHaveLength(6);
    }
  );
});
```

- [ ] **Step 7: Run integration test — passes or skips**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/categories/descriptive_stats.integration.test.ts)
```

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/stats.median/ \
        packages/server/src/modules/registry/seeds/tools/stats.variance/ \
        packages/server/src/modules/registry/seeds/tools/stats.quantile/ \
        packages/server/src/modules/registry/seeds/tools/stats.histogram/ \
        packages/server/src/modules/registry/seeds/tools/stats.autocorrelation/ \
        packages/server/src/modules/registry/seeds/tools/stats.cross_correlation/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts \
        packages/server/src/modules/registry/seeds/__tests__/categories/descriptive_stats.integration.test.ts
git commit -m "tr-phase3-full: add descriptive_stats seeds (6 tools, 10→16)"
```

---

## Task 3: Data I/O completion (4 tools)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/pandas.load_parquet/tool.yaml` + `tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/pandas.save_parquet/tool.yaml` + `tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/yaml.load/tool.yaml` + `tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/yaml.dump/tool.yaml` + `tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 4 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 16→20)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/data_io.integration.test.ts`

**Requires:** NR Phase 2 for end-to-end invocation of `pandas.save_parquet` (DataFrame input). `pandas.load_parquet`, `yaml.load`, `yaml.dump` are invocable without NR Phase 2.

**Tool list:** see spec Section 5.2 (`docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`, §5.2 Data I/O). Full port schemas, descriptions, and dependency requirements listed there.

**Pattern:** for each tool, follow the structure from Task 2. Each `tool.py` imports its library INSIDE the function body. Each `tool.yaml` declares `category: data_io` and `implementation.requires: [...]`.

- [ ] **Step 1: Write all 4 tool files (YAML + Python pairs)** — follow Task 2's idiom; see spec §5.2 for exact ports.
- [ ] **Step 2: Append 4 entries to `manifest.ts`**
- [ ] **Step 3: Bump `loader.test.ts` expected count from 16 to 20**
- [ ] **Step 4: Run loader test — green**
- [ ] **Step 5: Write `data_io.integration.test.ts` with 1-2 representative integration tests**

  Use `describe.skipIf(!pythonAvailable() || !libsAvailable(['pandas', 'pyarrow']))` for parquet tests and `describe.skipIf(!pythonAvailable())` for yaml tests. Add a full invocation test for `yaml.load` (primitive-input, invocable now).

- [ ] **Step 6: Commit as `tr-phase3-full: add data_io seeds (4 tools, 16→20)`**

---

## Task 4: Hypothesis testing (8 tools)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.yaml` (one per tool, see table below)
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.py` (one per tool)
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 8 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 20→28)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/hypothesis_testing.integration.test.ts`

**Requires:** NR Phase 2 for end-to-end invocation of all 8 tools (all have `NumpyArray` input ports).

**Tool list:** see spec Section 5.3 (`docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`, §5.3 Hypothesis Testing).

| Tool name | Key deps |
|---|---|
| `stats.t_test` | `numpy`, `scipy` |
| `stats.mann_whitney` | `numpy`, `scipy` |
| `stats.ks_test` | `numpy`, `scipy` |
| `stats.chi_square` | `numpy`, `scipy` |
| `stats.permutation_test` | `numpy`, `scipy` |
| `stats.bootstrap_ci` | `numpy`, `scipy` |
| `stats.adf_test` | `numpy`, `statsmodels` |
| `stats.ljung_box` | `numpy`, `statsmodels` |

**Pattern:** follow the Task 2 structure for each tool. Each `tool.py` imports its scientific library inside the function body.

- [ ] **Step 1: Write all 8 tool files (YAML + Python pairs)**
- [ ] **Step 2: Append 8 entries to `manifest.ts`**
- [ ] **Step 3: Bump `loader.test.ts` expected count from 20 to 28**
- [ ] **Step 4: Run loader test — green**
- [ ] **Step 5: Write `hypothesis_testing.integration.test.ts` with 1-2 representative registration tests** (use `describe.skipIf(!pythonAvailable() || !libsAvailable(['numpy', 'scipy']))`). No invocation tests — all NR2-gated.
- [ ] **Step 6: Commit as `tr-phase3-full: add hypothesis_testing seeds (8 tools, 20→28)`**

---

## Task 5: Regression completion (4 tools)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.yaml` (one per tool)
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.py` (one per tool)
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 4 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 28→32)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/regression.integration.test.ts`

**Requires:** NR Phase 2 for end-to-end invocation of all 4 tools (`sklearn.logistic_regression`, `sklearn.ridge`, `sklearn.lasso`, `statsmodels.glm` — all have `NumpyArray` input ports).

**Tool list:** see spec Section 5.4 (`docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`, §5.4 Regression).

| Tool name | Key deps |
|---|---|
| `sklearn.logistic_regression` | `numpy`, `scikit-learn` |
| `sklearn.ridge` | `numpy`, `scikit-learn` |
| `sklearn.lasso` | `numpy`, `scikit-learn` |
| `statsmodels.glm` | `numpy`, `statsmodels` |

**Pattern:** follow Task 2 structure. Each `tool.py` imports its library inside the function body.

- [ ] **Step 1: Write all 4 tool files (YAML + Python pairs)**
- [ ] **Step 2: Append 4 entries to `manifest.ts`**
- [ ] **Step 3: Bump `loader.test.ts` expected count from 28 to 32**
- [ ] **Step 4: Run loader test — green**
- [ ] **Step 5: Write `regression.integration.test.ts` with 1-2 representative registration tests** (use `describe.skipIf(!pythonAvailable() || !libsAvailable(['numpy', 'scikit-learn']))`). No invocation tests — all NR2-gated.
- [ ] **Step 6: Commit as `tr-phase3-full: add regression seeds (4 tools, 28→32)`**

---

## Task 6: Decomposition and dimensionality (5 tools)

**Requires:** NR Phase 2 for end-to-end invocation of all 5 tools (all have `NumpyArray` input ports).

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.pca/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.pca/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.ica/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.ica/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.nmf/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.nmf/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.tsne/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.tsne/tool.py`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.umap/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.umap/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 5 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 32→37)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/decomposition.integration.test.ts`

- [ ] **Step 1: Bump loader test count 32→37 (red)**

- [ ] **Step 2: Run loader test — confirm red**

- [ ] **Step 3: Write all 5 tool files**

`packages/server/src/modules/registry/seeds/tools/sklearn.pca/tool.yaml`:

```yaml
name: sklearn.pca
version: 1
description: Principal Component Analysis — project NumpyArray data onto n_components principal axes.
category: decomposition
tags: [pca, dimensionality-reduction, scikit-learn, numpy]
stability: stable
cost_class: medium
author: plurics-seeds
requires: [numpy, scikit-learn]

entry_point: tool.py:run

inputs:
  - name: X
    schema: NumpyArray
    required: true
    description: Input data matrix (n_samples x n_features).
  - name: n_components
    schema: Integer
    required: true
    description: Number of principal components to keep.

outputs:
  - name: components
    schema: NumpyArray
    description: Principal components (n_components x n_features).
  - name: explained_variance
    schema: NumpyArray
    description: Variance explained by each component.
  - name: transformed
    schema: NumpyArray
    description: Data projected onto principal components (n_samples x n_components).
```

`packages/server/src/modules/registry/seeds/tools/sklearn.pca/tool.py`:

```python
def run(X, n_components):
    from sklearn.decomposition import PCA
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    pca = PCA(n_components=n_components)
    transformed = pca.fit_transform(X_arr)
    return {
        "components": pca.components_,
        "explained_variance": pca.explained_variance_,
        "transformed": transformed,
    }
```

---

`packages/server/src/modules/registry/seeds/tools/sklearn.ica/tool.yaml`:

```yaml
name: sklearn.ica
version: 1
description: Independent Component Analysis — separate mixed signals into independent components.
category: decomposition
tags: [ica, independent-components, scikit-learn, numpy]
stability: stable
cost_class: medium
author: plurics-seeds
requires: [numpy, scikit-learn]

entry_point: tool.py:run

inputs:
  - name: X
    schema: NumpyArray
    required: true
    description: Input data matrix (n_samples x n_features).
  - name: n_components
    schema: Integer
    required: true
    description: Number of independent components to extract.

outputs:
  - name: components
    schema: NumpyArray
    description: Unmixing matrix rows (n_components x n_features).
  - name: transformed
    schema: NumpyArray
    description: Independent component activations (n_samples x n_components).
```

`packages/server/src/modules/registry/seeds/tools/sklearn.ica/tool.py`:

```python
def run(X, n_components):
    from sklearn.decomposition import FastICA
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    ica = FastICA(n_components=n_components, random_state=0)
    transformed = ica.fit_transform(X_arr)
    return {
        "components": ica.components_,
        "transformed": transformed,
    }
```

---

`packages/server/src/modules/registry/seeds/tools/sklearn.nmf/tool.yaml`:

```yaml
name: sklearn.nmf
version: 1
description: Non-negative Matrix Factorization — decompose a non-negative matrix into W and H factors.
category: decomposition
tags: [nmf, matrix-factorization, scikit-learn, numpy]
stability: stable
cost_class: medium
author: plurics-seeds
requires: [numpy, scikit-learn]

entry_point: tool.py:run

inputs:
  - name: X
    schema: NumpyArray
    required: true
    description: Non-negative input matrix (n_samples x n_features).
  - name: n_components
    schema: Integer
    required: true
    description: Number of components (rank of factorization).

outputs:
  - name: W
    schema: NumpyArray
    description: Activation matrix (n_samples x n_components).
  - name: H
    schema: NumpyArray
    description: Component matrix (n_components x n_features).
  - name: reconstruction_error
    schema: Float
    description: Frobenius norm of reconstruction error.
```

`packages/server/src/modules/registry/seeds/tools/sklearn.nmf/tool.py`:

```python
def run(X, n_components):
    from sklearn.decomposition import NMF
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    model = NMF(n_components=n_components, random_state=0)
    W = model.fit_transform(X_arr)
    return {
        "W": W,
        "H": model.components_,
        "reconstruction_error": float(model.reconstruction_err_),
    }
```

---

`packages/server/src/modules/registry/seeds/tools/sklearn.tsne/tool.yaml`:

```yaml
name: sklearn.tsne
version: 1
description: t-SNE dimensionality reduction for visualization.
category: decomposition
tags: [tsne, dimensionality-reduction, visualization, scikit-learn, numpy]
stability: stable
cost_class: high
author: plurics-seeds
requires: [numpy, scikit-learn]

entry_point: tool.py:run

inputs:
  - name: X
    schema: NumpyArray
    required: true
    description: Input data matrix (n_samples x n_features).
  - name: n_components
    schema: Integer
    required: true
    description: Embedding dimensionality (usually 2 or 3).
  - name: perplexity
    schema: Float
    required: true
    description: t-SNE perplexity parameter (typically 5–50).

outputs:
  - name: embedding
    schema: NumpyArray
    description: Low-dimensional embedding (n_samples x n_components).
```

`packages/server/src/modules/registry/seeds/tools/sklearn.tsne/tool.py`:

```python
def run(X, n_components, perplexity):
    from sklearn.manifold import TSNE
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    if perplexity <= 0:
        raise ValueError("perplexity must be > 0")
    tsne = TSNE(n_components=n_components, perplexity=perplexity, random_state=0)
    embedding = tsne.fit_transform(X_arr)
    return {"embedding": embedding}
```

---

`packages/server/src/modules/registry/seeds/tools/sklearn.umap/tool.yaml`:

```yaml
name: sklearn.umap
version: 1
description: UMAP dimensionality reduction (uses umap-learn, sklearn-compatible API).
category: decomposition
tags: [umap, dimensionality-reduction, manifold, umap-learn, numpy]
stability: stable
cost_class: high
author: plurics-seeds
requires: [numpy, umap-learn]

entry_point: tool.py:run

inputs:
  - name: X
    schema: NumpyArray
    required: true
    description: Input data matrix (n_samples x n_features).
  - name: n_components
    schema: Integer
    required: true
    description: Embedding dimensionality.
  - name: n_neighbors
    schema: Integer
    required: true
    description: Size of local neighborhood for manifold approximation.

outputs:
  - name: embedding
    schema: NumpyArray
    description: Low-dimensional embedding (n_samples x n_components).
```

`packages/server/src/modules/registry/seeds/tools/sklearn.umap/tool.py`:

```python
def run(X, n_components, n_neighbors):
    from umap import UMAP
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    if n_neighbors < 2:
        raise ValueError("n_neighbors must be >= 2")
    reducer = UMAP(n_components=n_components, n_neighbors=n_neighbors, random_state=0)
    embedding = reducer.fit_transform(X_arr)
    return {"embedding": embedding}
```

- [ ] **Step 4: Append 5 entries to `manifest.ts`**

```typescript
  { name: 'sklearn.pca',  relPath: './tools/sklearn.pca/tool.yaml' },
  { name: 'sklearn.ica',  relPath: './tools/sklearn.ica/tool.yaml' },
  { name: 'sklearn.nmf',  relPath: './tools/sklearn.nmf/tool.yaml' },
  { name: 'sklearn.tsne', relPath: './tools/sklearn.tsne/tool.yaml' },
  { name: 'sklearn.umap', relPath: './tools/sklearn.umap/tool.yaml' },
```

- [ ] **Step 5: Run loader test — green**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: `registered + skipped === 37`.

- [ ] **Step 6: Write `decomposition.integration.test.ts`**

`packages/server/src/modules/registry/seeds/__tests__/categories/decomposition.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { pythonAvailable, libsAvailable } from '../helpers.js';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../../seeds/loader.js';
import { makeTmpRegistry } from '../fixtures/index.js';

const LIBS = ['numpy', 'scikit-learn'];

describe('decomposition seeds — integration', () => {
  let client: RegistryClient;

  beforeAll(async () => {
    client = await makeTmpRegistry();
    await loadSeedTools(client);
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'sklearn.pca registers with correct category and output count',
    async () => {
      const tool = await client.get('sklearn.pca');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('decomposition');
      expect(tool!.outputs).toHaveLength(3);
      const outNames = tool!.outputs.map((o) => o.name);
      expect(outNames).toContain('components');
      expect(outNames).toContain('explained_variance');
      expect(outNames).toContain('transformed');
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'sklearn.umap registers with requires including umap-learn',
    async () => {
      const tool = await client.get('sklearn.umap');
      expect(tool).toBeDefined();
      expect(tool!.requires).toContain('umap-learn');
    }
  );

  // Note: invocation tests for all decomposition tools are NR2-gated.
  // Add invocation tests in the NR Phase 2 slice.
});
```

- [ ] **Step 7: Run integration test — passes or skips**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/categories/decomposition.integration.test.ts)
```

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/sklearn.pca/ \
        packages/server/src/modules/registry/seeds/tools/sklearn.ica/ \
        packages/server/src/modules/registry/seeds/tools/sklearn.nmf/ \
        packages/server/src/modules/registry/seeds/tools/sklearn.tsne/ \
        packages/server/src/modules/registry/seeds/tools/sklearn.umap/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts \
        packages/server/src/modules/registry/seeds/__tests__/categories/decomposition.integration.test.ts
git commit -m "tr-phase3-full: add decomposition seeds (5 tools, 32→37)"
```

---

## Task 7: Clustering (4 tools)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.yaml` (one per tool)
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.py` (one per tool)
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 4 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 37→41)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/clustering.integration.test.ts`

**Requires:** NR Phase 2 for end-to-end invocation of all 4 tools (all have `NumpyArray` input ports).

**Tool list:** see spec Section 5.6 (`docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`, §5.6 Clustering).

| Tool name | Key deps |
|---|---|
| `sklearn.kmeans` | `numpy`, `scikit-learn` |
| `sklearn.dbscan` | `numpy`, `scikit-learn` |
| `sklearn.hierarchical` | `numpy`, `scikit-learn` |
| `sklearn.gaussian_mixture` | `numpy`, `scikit-learn` |

**Pattern:** for each tool, follow the structure from Task 6 (decomposition — the reference full-content example for pickle-input-heavy categories). Each `tool.py` imports its scientific library inside the function body.

- [ ] **Step 1: Write all 4 tool files (YAML + Python pairs)**
- [ ] **Step 2: Append 4 entries to `manifest.ts`**
- [ ] **Step 3: Bump `loader.test.ts` expected count from 37 to 41**
- [ ] **Step 4: Run loader test — green**
- [ ] **Step 5: Write `clustering.integration.test.ts` with 1-2 representative registration tests** (use `describe.skipIf(!pythonAvailable() || !libsAvailable(['numpy', 'scikit-learn']))`). No invocation tests — all NR2-gated.
- [ ] **Step 6: Commit as `tr-phase3-full: add clustering seeds (4 tools, 37→41)`**

---

## Task 8: Time series (7 tools)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.yaml` (one per tool)
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.py` (one per tool)
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 7 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 41→48)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/time_series.integration.test.ts`

**Requires:** NR Phase 2 for end-to-end invocation of all 7 tools (all have `NumpyArray` input ports).

**Tool list:** see spec Section 5.7 (`docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`, §5.7 Time Series).

| Tool name | Key deps |
|---|---|
| `statsmodels.arima` | `numpy`, `statsmodels` |
| `statsmodels.garch` | `numpy`, `arch` (note: uses `arch` package, not statsmodels directly — see spec §10.2) |
| `statsmodels.decompose` | `numpy`, `statsmodels` |
| `statsmodels.seasonal_adjust` | `numpy`, `statsmodels` |
| `statsmodels.granger_causality` | `numpy`, `statsmodels` |
| `ta.compute_rsi` | `numpy`, `ta` |
| `ta.compute_atr` | `numpy`, `ta` |

**Pattern:** for each tool, follow the Task 6 structure. For `statsmodels.garch`, use `from arch import arch_model` inside the function body (see spec §10.2 for rationale).

- [ ] **Step 1: Write all 7 tool files (YAML + Python pairs)**
- [ ] **Step 2: Append 7 entries to `manifest.ts`**
- [ ] **Step 3: Bump `loader.test.ts` expected count from 41 to 48**
- [ ] **Step 4: Run loader test — green**
- [ ] **Step 5: Write `time_series.integration.test.ts` with 1-2 representative registration tests** (use `describe.skipIf(!pythonAvailable() || !libsAvailable(['numpy', 'statsmodels']))`). No invocation tests — all NR2-gated.
- [ ] **Step 6: Commit as `tr-phase3-full: add time_series seeds (7 tools, 41→48)`**

---

## Task 9: Symbolic math (6 tools)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.yaml` (one per tool)
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.py` (one per tool)
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 6 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 48→54)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/symbolic_math.integration.test.ts`

**Requires:** Task 1 (`SymbolicExpr` schema) must be merged before this task. NR Phase 2 for end-to-end invocation of all 6 tools (all have `SymbolicExpr` input ports — see spec §10.4 for the bootstrap problem note).

**Tool list:** see spec Section 5.8 (`docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`, §5.8 Symbolic Math).

| Tool name | Inputs | Output schema |
|---|---|---|
| `sympy.simplify` | `expr: SymbolicExpr` | `result: SymbolicExpr` |
| `sympy.solve` | `expr: SymbolicExpr`, `variable: String` | `solutions: JsonArray` |
| `sympy.factor` | `expr: SymbolicExpr` | `result: SymbolicExpr` |
| `sympy.integrate` | `expr: SymbolicExpr`, `variable: String` | `result: SymbolicExpr` |
| `sympy.differentiate` | `expr: SymbolicExpr`, `variable: String` | `result: SymbolicExpr` |
| `sympy.limit` | `expr: SymbolicExpr`, `variable: String`, `point: String` | `result: SymbolicExpr` |

**Note:** `sympy.solve` outputs `JsonArray` of strings (sympy solution strings) even though its input is NR2-gated.

**Pattern:** follow Task 6 structure. All `tool.py` files use `import sympy` inside the function body. The `SymbolicExpr` input port is declared in `tool.yaml` — the runner handles pickle round-trip automatically because `SymbolicExpr` is in `PICKLE_SCHEMA_NAMES`.

- [ ] **Step 1: Write all 6 tool files (YAML + Python pairs)**
- [ ] **Step 2: Append 6 entries to `manifest.ts`**
- [ ] **Step 3: Bump `loader.test.ts` expected count from 48 to 54**
- [ ] **Step 4: Run loader test — green**
- [ ] **Step 5: Write `symbolic_math.integration.test.ts` with 1-2 representative registration tests** (use `describe.skipIf(!pythonAvailable() || !libsAvailable(['sympy']))`). No invocation tests — all NR2-gated.
- [ ] **Step 6: Commit as `tr-phase3-full: add symbolic_math seeds (6 tools, 48→54)`**

---

## Task 10: Data transformation (8 tools)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.yaml` (one per tool)
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.py` (one per tool)
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 8 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 54→62)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/data_transformation.integration.test.ts`

**Requires:** NR Phase 2 for end-to-end invocation of all 8 tools (all have `DataFrame` or `NumpyArray` input ports).

**Tool list:** see spec Section 5.9 (`docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`, §5.9 Data Transformation).

| Tool name | Key deps |
|---|---|
| `pandas.filter` | `pandas`, `numpy` |
| `pandas.groupby_agg` | `pandas`, `numpy` |
| `pandas.pivot` | `pandas`, `numpy` |
| `pandas.resample` | `pandas`, `numpy` |
| `pandas.merge` | `pandas`, `numpy` |
| `pandas.rolling` | `pandas`, `numpy` |
| `numpy.reshape` | `numpy` |
| `numpy.normalize` | `numpy` |

**Pattern:** for each tool, follow the Task 6 structure. Each `tool.py` imports its library inside the function body.

- [ ] **Step 1: Write all 8 tool files (YAML + Python pairs)**
- [ ] **Step 2: Append 8 entries to `manifest.ts`**
- [ ] **Step 3: Bump `loader.test.ts` expected count from 54 to 62**
- [ ] **Step 4: Run loader test — green**
- [ ] **Step 5: Write `data_transformation.integration.test.ts` with 1-2 representative registration tests** (use `describe.skipIf(!pythonAvailable() || !libsAvailable(['pandas', 'numpy']))`). No invocation tests — all NR2-gated.
- [ ] **Step 6: Commit as `tr-phase3-full: add data_transformation seeds (8 tools, 54→62)`**

---

## Task 11: Optimization (4 tools)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.yaml` (one per tool)
- Create: `packages/server/src/modules/registry/seeds/tools/<name>/tool.py` (one per tool)
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts` (append 4 entries)
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts` (bump 62→66)
- Create: `packages/server/src/modules/registry/seeds/__tests__/categories/optimization.integration.test.ts`

**Requires:** NR Phase 2 for end-to-end invocation of all 4 tools (all have `NumpyArray` input ports).

**Tool list:** see spec Section 5.10 (`docs/superpowers/specs/2026-04-11-tool-registry-phase-3-full-design.md`, §5.10 Optimization).

| Tool name | Key deps | Special note |
|---|---|---|
| `scipy.minimize` | `numpy`, `scipy` | Named-function registry (see below) |
| `scipy.curve_fit` | `numpy`, `scipy` | Named-function registry (see below) |
| `scipy.root_finding` | `numpy`, `scipy` | Named-function registry (see below) |
| `scipy.linprog` | `numpy`, `scipy` | Standard port-based invocation |

**Special note — named-function registry for `scipy.minimize`, `scipy.curve_fit`, `scipy.root_finding`:**

These tools require a callable that cannot be passed through the schema system. Per the Manifesto, `eval`/`exec` are explicitly rejected. The `tool.py` for these tools embeds a configurable function registry selected by a `func_name: String` input port:

```python
# This pattern applies to scipy.minimize, scipy.curve_fit, scipy.root_finding.
# Extend FUNCTIONS to add more named functions; do not use eval/exec.

FUNCTIONS = {
    'rosenbrock': lambda x: (1 - x[0])**2 + 100 * (x[1] - x[0]**2)**2,
    'quadratic':  lambda x: x[0]**2 + x[1]**2,
    'sphere':     lambda x: sum(xi**2 for xi in x),
}

def run(x0, method, func_name):
    from scipy.optimize import minimize
    import numpy as np
    if func_name not in FUNCTIONS:
        raise ValueError(f"Unknown func_name '{func_name}'. Available: {list(FUNCTIONS)}")
    result = minimize(FUNCTIONS[func_name], np.array(x0), method=method)
    return {
        "x": result.x,
        "fun": float(result.fun),
        "success": bool(result.success),
        "message": str(result.message),
    }
```

For `scipy.curve_fit`, the `FUNCTIONS` dict holds candidate model functions `f(x, *params)`:

```python
FUNCTIONS = {
    'linear':    lambda x, a, b: a * x + b,
    'quadratic': lambda x, a, b, c: a * x**2 + b * x + c,
    'exponential': lambda x, a, b: a * np.exp(b * x),
}
```

This is a known limitation acknowledged at spec time (spec §10.1). Extending the registry with user-defined functions is deferred.

**Pattern:** for `scipy.linprog`, follow the standard Task 6 structure (no function registry needed). For the three registry-based tools, use the pattern above.

- [ ] **Step 1: Write all 4 tool files (YAML + Python pairs)**
- [ ] **Step 2: Append 4 entries to `manifest.ts`**
- [ ] **Step 3: Bump `loader.test.ts` expected count from 62 to 66**
- [ ] **Step 4: Run loader test — green**
- [ ] **Step 5: Write `optimization.integration.test.ts` with 1-2 representative registration tests** (use `describe.skipIf(!pythonAvailable() || !libsAvailable(['numpy', 'scipy']))`). Confirm `scipy.minimize` has a `func_name` input port. No invocation tests — all NR2-gated.
- [ ] **Step 6: Commit as `tr-phase3-full: add optimization seeds (4 tools, 62→66)`**

---

## Task 12: Full module sweep (verification — no new code)

**Files:** none created or modified.

- [ ] **Step 1: Run the full registry test suite**

```bash
(cd packages/server && npx vitest run src/modules/registry)
```

Expected: all tests pass or skip. No failures.

- [ ] **Step 2: Verify loader registers ~66 tools**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: `registered + skipped === 66`.

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
(cd packages/server && npx tsc --noEmit)
```

Expected: no errors.

- [ ] **Step 4: Confirm all 10 category integration test files exist**

```bash
ls packages/server/src/modules/registry/seeds/__tests__/categories/
```

Expected: 10 files:
- `descriptive_stats.integration.test.ts`
- `data_io.integration.test.ts`
- `hypothesis_testing.integration.test.ts`
- `regression.integration.test.ts`
- `decomposition.integration.test.ts`
- `clustering.integration.test.ts`
- `time_series.integration.test.ts`
- `symbolic_math.integration.test.ts`
- `data_transformation.integration.test.ts`
- `optimization.integration.test.ts`

- [ ] **Step 5: Confirm `manifest.ts` entry count**

```bash
grep -c "relPath" packages/server/src/modules/registry/seeds/manifest.ts
```

Expected: `66` (10 pilot + 56 new).

- [ ] **Step 6: Note on integration tests without scientific Python stack**

Tests that gate on `libsAvailable([...])` will **auto-skip** if the libraries are not installed. This is correct behavior for CI environments without the scientific Python stack. No action needed.

- [ ] **Step 7: Commit sweep summary**

```bash
git commit --allow-empty -m "tr-phase3-full: sweep complete — 66 tools registered, all integration tests pass or skip"
```

---

## Appendix: Loader count bump schedule

| After task | `EXPECTED_COUNT` in `loader.test.ts` |
|---|---|
| Pilot (baseline) | 10 |
| Task 2 — descriptive_stats | 16 |
| Task 3 — data_io | 20 |
| Task 4 — hypothesis_testing | 28 |
| Task 5 — regression | 32 |
| Task 6 — decomposition | 37 |
| Task 7 — clustering | 41 |
| Task 8 — time_series | 48 |
| Task 9 — symbolic_math | 54 |
| Task 10 — data_transformation | 62 |
| Task 11 — optimization | 66 |

## Appendix: Full → abbreviated task map

| Task | Type | Rationale |
|---|---|---|
| Task 1 — SymbolicExpr schema | Full | Schema addition requires exact TS + Python code |
| Task 2 — descriptive_stats | **Full** | First full category example; all tools primitive-input-only |
| Task 3 — data_io | Abbreviated | Same pattern; see spec §5.2 |
| Task 4 — hypothesis_testing | Abbreviated | See spec §5.3 |
| Task 5 — regression | Abbreviated | See spec §5.4 |
| Task 6 — decomposition | **Full** | Second full example; all tools pickle-input-heavy |
| Task 7 — clustering | Abbreviated | See spec §5.6 |
| Task 8 — time_series | Abbreviated | See spec §5.7 |
| Task 9 — symbolic_math | Abbreviated | See spec §5.8; Task 1 prerequisite noted |
| Task 10 — data_transformation | Abbreviated | See spec §5.9 |
| Task 11 — optimization | Abbreviated with function-registry pattern verbatim | See spec §5.10 and §10.1 |
| Task 12 — sweep | Verification only | No new code |
