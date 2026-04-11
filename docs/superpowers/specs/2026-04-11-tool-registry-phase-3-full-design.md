# Tool Registry — Phase 3 Full Slice Design Spec

**Date:** 2026-04-11
**Status:** Approved for implementation
**Scope:** Remaining 52 seed tools completing the design doc §13.1 catalog; SymbolicExpr schema; category-level integration tests
**Parent documents:** `docs/design/tool-registry.md`, `docs/superpowers/specs/2026-04-11-tool-registry-phase-3-pilot-design.md`, `MANIFESTO.md`

---

## 1. Context and Purpose

The Tool Registry Phase 3 Pilot (merged, ~10 tools across 3 categories) established:

- The canonical `tool.yaml` + `tool.py` layout under `seeds/tools/{name}/`.
- `loadSeedTools` with idempotent registration via `client.get(name)`.
- TDD pattern: loader unit test with expected count, integration tests gated by `libsAvailable([...deps])`.
- The invocation constraint: tools with `NumpyArray` or `DataFrame` **input** ports cannot be invoked end-to-end from TypeScript until the Node Runtimes Phase 2 value store lands.
- 9 built-in schemas including `NumpyArray` and `DataFrame` (both `pickle_b64`).

This slice delivers the **remaining 52 seed tools** across 9 additional categories, completes the `data_io` and `descriptive_stats` categories to their design-doc totals, and adds one new built-in schema: `SymbolicExpr`.

### Prerequisite: Node Runtimes Phase 2

Node Runtimes Phase 2 ("value store") must land **before or alongside** TR Phase 3 Full. It provides the opaque-handle mechanism (`PluricsHandle`) that lets TypeScript pass pickle envelopes between tools without deserialising them. Without NR Phase 2:

- All tools with `NumpyArray`, `DataFrame`, or `SymbolicExpr` **input** ports are registered but **not invocable** end-to-end from TypeScript.
- These tools are marked in the invocability matrix (Section 7) as "NR2-gated".
- They still appear in `list()`, `findProducers()`, `findConsumers()`, and all other discovery APIs.

---

## 2. In Scope

- **52 new seed tools** (directories under `seeds/tools/`) across 9 categories + completions of 2 existing categories.
- **SymbolicExpr built-in schema**: TypeScript declaration in `schemas/builtin.ts`, Python summarizer, entry in runner `PICKLE_SCHEMAS`.
- **Category-level integration test files**: one file per category under `seeds/__tests__/categories/`, each gated by `libsAvailable`.
- **Loader unit test bump**: expected seed count updates from 10 → 62 as categories land.
- **manifest.ts expansion**: 52 new `SeedToolDef` entries.
- **Python dependency notes** in each `tool.yaml` `requires:` field.
- No new TypeScript plumbing beyond schema addition — the loader and app.ts wiring are unchanged.

---

## 3. Out of Scope

- Automatic Python dependency installation or per-tool virtualenvs.
- CI integration testing against the scientific Python stack.
- Seed versioning/upgrade semantics.
- Tool-per-tool unit tests (only category-level integration tests).
- UI browser for seeds.
- `numpy.*` performance benchmarking.
- `SymbolicExpr` **as an input to LLM nodes** (reasoning bridge deferred).
- Regression testing on seed updates.

---

## 4. SymbolicExpr Schema

### 4.1 Motivation

The symbolic math category (`sympy.*`) uses `sympy.Expr` objects. These are not JSON-serialisable, but they pickle cleanly. They need a built-in schema parallel to `NumpyArray` and `DataFrame`.

### 4.2 TypeScript declaration (delta to `schemas/builtin.ts`)

```typescript
export const SYMBOLIC_EXPR_SCHEMA: BuiltinSchema = {
  name: 'SymbolicExpr',
  encoding: 'pickle_b64',
  pythonType: 'sympy.Expr',
  summarizer: 'str(value)',   // sympy str() gives the canonical expression string
  description: 'A symbolic mathematical expression (sympy.Expr). Encoded as pickle_b64.',
};
```

Add `'SymbolicExpr'` to the `PICKLE_SCHEMAS` set in the Python runner so that pickle round-trip is applied on the same path as `NumpyArray` and `DataFrame`.

### 4.3 Summarizer contract

- `str(expr)` returns the sympy canonical string (e.g., `"x**2 + 2*x + 1"`).
- For very long expressions (> 200 chars), truncate to 200 and append `"..."`.
- Never raises — wrap in `try/except Exception: return "<unprintable SymbolicExpr>"`.

### 4.4 Schema registration

The schema is registered at server startup via the existing `schemaRegistry.register(SYMBOLIC_EXPR_SCHEMA)` call pattern. No changes to the registration flow are needed.

---

## 5. Full Tool Catalog

### Conventions

- **Input/output port notation:** `name: SchemaName`
- `JsonArray` = built-in, primitive (no pickle round-trip needed as input)
- `NumpyArray`, `DataFrame`, `SymbolicExpr` = `pickle_b64` (NR2-gated as inputs)
- `JsonObject` = structured but JSON-serialised (no pickle)
- All tools: `category` field in `tool.yaml`, `requires` field listing Python packages

---

### 5.1 Descriptive Stats — 6 completions (pilot had 4, design doc target: 10)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `stats.median` | `values: JsonArray` | `median: Float` | Yes |
| `stats.variance` | `values: JsonArray` | `variance: Float` | Yes |
| `stats.quantile` | `values: JsonArray`, `q: Float` | `quantile: Float` | Yes |
| `stats.histogram` | `values: JsonArray`, `bins: Integer` | `counts: JsonArray`, `edges: JsonArray` | Yes |
| `stats.autocorrelation` | `values: JsonArray`, `max_lag: Integer` | `acf: JsonArray` | Yes |
| `stats.cross_correlation` | `x: JsonArray`, `y: JsonArray` | `ccf: JsonArray` | Yes |

**requires:** `numpy` (all 6)

---

### 5.2 Data I/O — 4 completions (pilot had 4, design doc target: 8)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `pandas.load_parquet` | `path: String` | `df: DataFrame` | Yes — output only |
| `pandas.save_parquet` | `df: DataFrame`, `path: String` | `written: Boolean` | NR2-gated (`df` input) |
| `yaml.load` | `path: String` | `data: JsonObject` | Yes |
| `yaml.dump` | `data: JsonObject`, `path: String` | `written: Boolean` | Yes |

**requires:** `pandas`, `pyarrow` (parquet); stdlib `yaml` (yaml tools)

---

### 5.3 Hypothesis Testing (8 new tools)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `stats.t_test` | `a: NumpyArray`, `b: NumpyArray` | `statistic: Float`, `p_value: Float` | NR2-gated |
| `stats.mann_whitney` | `a: NumpyArray`, `b: NumpyArray` | `statistic: Float`, `p_value: Float` | NR2-gated |
| `stats.ks_test` | `a: NumpyArray`, `b: NumpyArray` | `statistic: Float`, `p_value: Float` | NR2-gated |
| `stats.chi_square` | `observed: NumpyArray` | `statistic: Float`, `p_value: Float`, `dof: Integer` | NR2-gated |
| `stats.permutation_test` | `a: NumpyArray`, `b: NumpyArray`, `n_resamples: Integer` | `statistic: Float`, `p_value: Float` | NR2-gated |
| `stats.bootstrap_ci` | `data: NumpyArray`, `confidence: Float`, `n_resamples: Integer` | `ci_low: Float`, `ci_high: Float` | NR2-gated |
| `stats.adf_test` | `values: NumpyArray` | `statistic: Float`, `p_value: Float`, `used_lag: Integer`, `critical_values: JsonObject` | NR2-gated |
| `stats.ljung_box` | `residuals: NumpyArray`, `lags: Integer` | `statistic: Float`, `p_value: Float` | NR2-gated |

**requires:** `numpy`, `scipy` (t_test through bootstrap_ci); `statsmodels` (adf_test, ljung_box)

---

### 5.4 Regression — 4 completions (pilot had 2, design doc target: 6)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `sklearn.logistic_regression` | `X: NumpyArray`, `y: NumpyArray` | `coefficients: NumpyArray`, `intercept: Float`, `accuracy: Float` | NR2-gated |
| `sklearn.ridge` | `X: NumpyArray`, `y: NumpyArray`, `alpha: Float` | `coefficients: NumpyArray`, `intercept: Float`, `r_squared: Float` | NR2-gated |
| `sklearn.lasso` | `X: NumpyArray`, `y: NumpyArray`, `alpha: Float` | `coefficients: NumpyArray`, `intercept: Float`, `r_squared: Float` | NR2-gated |
| `statsmodels.glm` | `X: NumpyArray`, `y: NumpyArray`, `family: String` | `coefficients: NumpyArray`, `p_values: NumpyArray`, `aic: Float` | NR2-gated |

**requires:** `numpy`, `scikit-learn` (sklearn.*); `numpy`, `statsmodels` (statsmodels.glm)

---

### 5.5 Decomposition and Dimensionality Reduction (5 new tools)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `sklearn.pca` | `X: NumpyArray`, `n_components: Integer` | `components: NumpyArray`, `explained_variance: NumpyArray`, `transformed: NumpyArray` | NR2-gated |
| `sklearn.ica` | `X: NumpyArray`, `n_components: Integer` | `components: NumpyArray`, `transformed: NumpyArray` | NR2-gated |
| `sklearn.nmf` | `X: NumpyArray`, `n_components: Integer` | `W: NumpyArray`, `H: NumpyArray`, `reconstruction_error: Float` | NR2-gated |
| `sklearn.tsne` | `X: NumpyArray`, `n_components: Integer`, `perplexity: Float` | `embedding: NumpyArray` | NR2-gated |
| `sklearn.umap` | `X: NumpyArray`, `n_components: Integer`, `n_neighbors: Integer` | `embedding: NumpyArray` | NR2-gated |

**requires:** `numpy`, `scikit-learn` (pca, ica, nmf, tsne); `numpy`, `umap-learn` (umap)

---

### 5.6 Clustering (4 new tools)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `sklearn.kmeans` | `X: NumpyArray`, `n_clusters: Integer` | `labels: NumpyArray`, `centroids: NumpyArray`, `inertia: Float` | NR2-gated |
| `sklearn.dbscan` | `X: NumpyArray`, `eps: Float`, `min_samples: Integer` | `labels: NumpyArray`, `n_clusters: Integer` | NR2-gated |
| `sklearn.hierarchical` | `X: NumpyArray`, `n_clusters: Integer`, `linkage: String` | `labels: NumpyArray` | NR2-gated |
| `sklearn.gaussian_mixture` | `X: NumpyArray`, `n_components: Integer` | `labels: NumpyArray`, `means: NumpyArray`, `bic: Float` | NR2-gated |

**requires:** `numpy`, `scikit-learn` (all 4)

---

### 5.7 Time Series (7 new tools)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `statsmodels.arima` | `values: NumpyArray`, `order_p: Integer`, `order_d: Integer`, `order_q: Integer` | `aic: Float`, `bic: Float`, `params: NumpyArray`, `residuals: NumpyArray` | NR2-gated |
| `statsmodels.garch` | `returns: NumpyArray`, `p: Integer`, `q: Integer` | `params: NumpyArray`, `conditional_volatility: NumpyArray`, `aic: Float` | NR2-gated |
| `statsmodels.decompose` | `values: NumpyArray`, `period: Integer`, `model: String` | `trend: NumpyArray`, `seasonal: NumpyArray`, `residual: NumpyArray` | NR2-gated |
| `statsmodels.seasonal_adjust` | `values: NumpyArray`, `period: Integer` | `adjusted: NumpyArray` | NR2-gated |
| `statsmodels.granger_causality` | `data: NumpyArray`, `max_lag: Integer` | `results: JsonObject` | NR2-gated |
| `ta.compute_rsi` | `close: NumpyArray`, `period: Integer` | `rsi: NumpyArray` | NR2-gated |
| `ta.compute_atr` | `high: NumpyArray`, `low: NumpyArray`, `close: NumpyArray`, `period: Integer` | `atr: NumpyArray` | NR2-gated |

**requires:** `numpy`, `statsmodels` (statsmodels.*); `numpy`, `arch` (garch); `numpy`, `ta` (ta.*)

---

### 5.8 Symbolic Math (6 new tools) — requires SymbolicExpr schema

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `sympy.simplify` | `expr: SymbolicExpr` | `result: SymbolicExpr` | NR2-gated |
| `sympy.solve` | `expr: SymbolicExpr`, `variable: String` | `solutions: JsonArray` | NR2-gated |
| `sympy.factor` | `expr: SymbolicExpr` | `result: SymbolicExpr` | NR2-gated |
| `sympy.integrate` | `expr: SymbolicExpr`, `variable: String` | `result: SymbolicExpr` | NR2-gated |
| `sympy.differentiate` | `expr: SymbolicExpr`, `variable: String` | `result: SymbolicExpr` | NR2-gated |
| `sympy.limit` | `expr: SymbolicExpr`, `variable: String`, `point: String` | `result: SymbolicExpr` | NR2-gated |

Note: `sympy.solve` returns a `JsonArray` of strings (sympy solution strings) to allow primitive output even though input is NR2-gated.

**requires:** `sympy` (all 6)

---

### 5.9 Data Transformation (8 new tools)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `pandas.filter` | `df: DataFrame`, `query: String` | `result: DataFrame` | NR2-gated |
| `pandas.groupby_agg` | `df: DataFrame`, `by: JsonArray`, `agg: JsonObject` | `result: DataFrame` | NR2-gated |
| `pandas.pivot` | `df: DataFrame`, `index: String`, `columns: String`, `values: String` | `result: DataFrame` | NR2-gated |
| `pandas.resample` | `df: DataFrame`, `rule: String`, `agg: String` | `result: DataFrame` | NR2-gated |
| `pandas.merge` | `left: DataFrame`, `right: DataFrame`, `on: JsonArray`, `how: String` | `result: DataFrame` | NR2-gated |
| `pandas.rolling` | `df: DataFrame`, `window: Integer`, `agg: String` | `result: DataFrame` | NR2-gated |
| `numpy.reshape` | `array: NumpyArray`, `shape: JsonArray` | `result: NumpyArray` | NR2-gated |
| `numpy.normalize` | `array: NumpyArray`, `norm: String` | `result: NumpyArray` | NR2-gated |

**requires:** `pandas`, `numpy` (all 8)

---

### 5.10 Optimization (4 new tools)

| Tool name | Input ports | Output ports | Invokable? |
|---|---|---|---|
| `scipy.minimize` | `x0: NumpyArray`, `method: String` | `x: NumpyArray`, `fun: Float`, `success: Boolean`, `message: String` | NR2-gated |
| `scipy.curve_fit` | `xdata: NumpyArray`, `ydata: NumpyArray`, `p0: NumpyArray` | `popt: NumpyArray`, `pcov: NumpyArray` | NR2-gated |
| `scipy.root_finding` | `x0: NumpyArray`, `method: String` | `x: NumpyArray`, `success: Boolean` | NR2-gated |
| `scipy.linprog` | `c: NumpyArray`, `A_ub: NumpyArray`, `b_ub: NumpyArray` | `x: NumpyArray`, `fun: Float`, `success: Boolean` | NR2-gated |

Note: `scipy.minimize` and `scipy.curve_fit` take a function to optimise. Since arbitrary Python callables cannot be passed through the schema system, the `tool.py` for these tools **embed a configurable function registry** (a small dict of named functions like `"rosenbrock"`, `"quadratic"`) selected by a `String` port (e.g., `func_name: String`). This is a known limitation acknowledged at spec time.

**requires:** `numpy`, `scipy` (all 4)

---

## 6. Rollout: Category-Batched Task Structure

Build in 10 category tasks. Each task group:
1. Add N tool directories under `seeds/tools/`.
2. Extend `manifest.ts` with N new `SeedToolDef` entries.
3. Bump expected count in loader unit test.
4. Add `seeds/__tests__/categories/{category}.integration.test.ts` with representative tests.

### Task order (suggested — categories with only primitive inputs first)

| Task | Category | New tools | Cumulative total |
|---|---|---|---|
| T1 | descriptive_stats completions | 6 | 16 |
| T2 | data_io completions | 4 | 20 |
| T3 | hypothesis_testing | 8 | 28 |
| T4 | regression completions | 4 | 32 |
| T5 | decomposition | 5 | 37 |
| T6 | clustering | 4 | 41 |
| T7 | time_series | 7 | 48 |
| T8 | symbolic_math + SymbolicExpr schema | 6 | 54 |
| T9 | data_transformation | 8 | 62 |
| T10 | optimization | 4 | 62 (same — overlap due to pilot) |

Final seed count: **62 tools** (10 pilot + 52 new).

### Suggested commit messages

```
feat(seeds): add descriptive_stats completions (6 tools, T1)
feat(seeds): add data_io completions (4 tools, T2)
feat(seeds): add hypothesis_testing seeds (8 tools, T3)
feat(seeds): add regression completions (4 tools, T4)
feat(seeds): add decomposition seeds (5 tools, T5)
feat(seeds): add clustering seeds (4 tools, T6)
feat(seeds): add time_series seeds (7 tools, T7)
feat(seeds): add SymbolicExpr schema + symbolic_math seeds (6 tools, T8)
feat(seeds): add data_transformation seeds (8 tools, T9)
feat(seeds): add optimization seeds (4 tools, T10)
```

---

## 7. Invocability Matrix

### Post-pilot, pre-NR Phase 2 (current state on merge of pilot)

| Category | Invocable tools | NR2-gated tools |
|---|---|---|
| data_io | `pandas.load_csv`, `json.load`, `json.dump` | `pandas.save_csv` |
| descriptive_stats | `stats.mean`, `stats.fft` | `stats.describe`, `stats.correlation_matrix` |
| regression | (none) | `sklearn.linear_regression`, `statsmodels.ols` |

### Post-TR Phase 3 Full, pre-NR Phase 2

| Category | Invocable tools | NR2-gated tools |
|---|---|---|
| data_io | `pandas.load_csv`, `json.load`, `json.dump`, `pandas.load_parquet`, `yaml.load`, `yaml.dump` | `pandas.save_csv`, `pandas.save_parquet` |
| descriptive_stats | `stats.mean`, `stats.fft`, `stats.median`, `stats.variance`, `stats.quantile`, `stats.histogram`, `stats.autocorrelation`, `stats.cross_correlation` | `stats.describe`, `stats.correlation_matrix` |
| hypothesis_testing | (none — all NumpyArray inputs) | all 8 |
| regression | (none) | all 6 |
| decomposition | (none) | all 5 |
| clustering | (none) | all 4 |
| time_series | (none) | all 7 |
| symbolic_math | (none — SymbolicExpr inputs) | all 6 |
| data_transformation | (none) | all 8 |
| optimization | (none) | all 4 |

**Invocable before NR Phase 2: 14 tools**
**NR2-gated: 48 tools**

### Post-NR Phase 2

All 62 tools become invocable end-to-end via `RegistryClient.invoke()`. The value store provides `PluricsHandle` objects that carry pickle envelopes across tool boundaries without TypeScript deserialisation.

---

## 8. Test Strategy

### 8.1 File layout

```
packages/server/src/modules/registry/seeds/__tests__/
├── loader.test.ts                    # (existing) unit test; bump expected count per task
└── categories/
    ├── descriptive_stats.integration.test.ts
    ├── data_io.integration.test.ts
    ├── hypothesis_testing.integration.test.ts
    ├── regression.integration.test.ts
    ├── decomposition.integration.test.ts
    ├── clustering.integration.test.ts
    ├── time_series.integration.test.ts
    ├── symbolic_math.integration.test.ts
    ├── data_transformation.integration.test.ts
    └── optimization.integration.test.ts
```

### 8.2 Per-file pattern

Each integration test file:

```typescript
// example: hypothesis_testing.integration.test.ts
import { libsAvailable, pythonAvailable } from '../helpers';
import { RegistryClient } from '../../client';
import { makeTmpRegistry } from '../fixtures';

const LIBS = ['numpy', 'scipy'];

describe('hypothesis_testing seeds', () => {
  let client: RegistryClient;

  beforeAll(async () => {
    client = await makeTmpRegistry();
    await loadSeedTools(client);
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'stats.t_test registers successfully',
    async () => {
      const tool = await client.get('stats.t_test');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('hypothesis_testing');
    }
  );

  // Note: invocation test for NR2-gated tools is deferred to NR Phase 2 slice.
  // Registration test above confirms the tool manifests are valid.
});
```

For categories with primitive-input-only tools (descriptive_stats, data_io), add a full invocation test in addition to the registration test.

### 8.3 Representative invocation tests per category

| Category | Representative invocation test (post-NR2) | Primitive-invocable now? |
|---|---|---|
| descriptive_stats | `stats.median([1,2,3,4,5]) → 3.0` | Yes |
| data_io | `yaml.load(path) → JsonObject` | Yes |
| hypothesis_testing | `stats.t_test(a, b) → {statistic, p_value}` | No (NR2) |
| regression | `sklearn.ridge(X, y, alpha=1.0) → coefficients` | No (NR2) |
| decomposition | `sklearn.pca(X, 2) → transformed` | No (NR2) |
| clustering | `sklearn.kmeans(X, 3) → labels` | No (NR2) |
| time_series | `statsmodels.arima(values, 1, 1, 1) → aic` | No (NR2) |
| symbolic_math | `sympy.simplify(expr) → result` | No (NR2) |
| data_transformation | `pandas.filter(df, query) → result` | No (NR2) |
| optimization | `scipy.linprog(c, A_ub, b_ub) → x` | No (NR2) |

### 8.4 Loader unit test bump schedule

The `loader.test.ts` asserts `result.registered + result.skipped === EXPECTED_COUNT`. Bump `EXPECTED_COUNT` in each task commit:

| After task | EXPECTED_COUNT |
|---|---|
| Pilot (current) | 10 |
| T1 | 16 |
| T2 | 20 |
| T3 | 28 |
| T4 | 32 |
| T5 | 37 |
| T6 | 41 |
| T7 | 48 |
| T8 | 54 |
| T9 | 62 |
| T10 | 62 |

---

## 9. Python Dependency Manifest

Each `tool.yaml` declares a `requires:` list. The server does not install these. The full dependency surface for all 62 seed tools:

| Package | Tools |
|---|---|
| `numpy` | stats.fft, stats.median/variance/quantile/histogram/autocorrelation/cross_correlation, all sklearn.*, all scipy.*, all statsmodels.*, ta.*, numpy.reshape, numpy.normalize |
| `pandas` | all pandas.*, stats.describe, stats.correlation_matrix |
| `pyarrow` | pandas.load_parquet, pandas.save_parquet |
| `scipy` | stats.t_test, stats.mann_whitney, stats.ks_test, stats.chi_square, stats.permutation_test, stats.bootstrap_ci, scipy.minimize, scipy.curve_fit, scipy.root_finding, scipy.linprog |
| `scikit-learn` | sklearn.linear_regression, sklearn.logistic_regression, sklearn.ridge, sklearn.lasso, sklearn.pca, sklearn.ica, sklearn.nmf, sklearn.tsne, sklearn.kmeans, sklearn.dbscan, sklearn.hierarchical, sklearn.gaussian_mixture |
| `statsmodels` | statsmodels.ols, statsmodels.glm, stats.adf_test, stats.ljung_box, statsmodels.arima, statsmodels.decompose, statsmodels.seasonal_adjust, statsmodels.granger_causality |
| `arch` | statsmodels.garch |
| `ta` | ta.compute_rsi, ta.compute_atr |
| `umap-learn` | sklearn.umap |
| `sympy` | sympy.simplify, sympy.solve, sympy.factor, sympy.integrate, sympy.differentiate, sympy.limit |

### Minimal install for all invocable tools (pre-NR2)

```
pip install numpy pandas pyarrow pyyaml
```

### Full install for all 62 tools (post-NR2)

```
pip install numpy pandas pyarrow scipy scikit-learn statsmodels arch ta umap-learn sympy pyyaml
```

---

## 10. Architecture Notes

### 10.1 scipy.minimize / scipy.curve_fit function selection

These tools require a callable. Since arbitrary Python callables cannot be passed through the schema system, the `tool.py` embeds a named-function registry:

```python
FUNCTIONS = {
    'rosenbrock': lambda x: (1 - x[0])**2 + 100*(x[1] - x[0]**2)**2,
    'quadratic':  lambda x: x[0]**2 + x[1]**2,
}
```

The `func_name: String` input port selects the function. Extending with user-defined functions is deferred. This is a known limitation of the schema-based invocation model — it does not support first-class functions. The alternative (eval/exec) is explicitly rejected per the Manifesto.

### 10.2 statsmodels.garch uses arch package

Despite the tool name `statsmodels.garch`, the implementation uses the `arch` package (`from arch import arch_model`), not statsmodels directly. The tool name reflects the conceptual category (time-series volatility modelling) not the import path. The `requires: [arch, numpy]` field makes this explicit.

### 10.3 sklearn.umap uses umap-learn package

`umap-learn` is not part of scikit-learn. The `requires: [umap-learn, numpy]` field and the tool name convention `sklearn.umap` (indicating the sklearn-compatible API surface, not the package name) are the only hints. Implementation: `from umap import UMAP`.

### 10.4 SymbolicExpr input bootstrap problem

Until NR Phase 2 lands, there is no way to create a `SymbolicExpr` value as a workflow input from the TypeScript layer. This means the 6 sympy tools are NR2-gated even though sympy itself installs cleanly. Post-NR2, a `sympy.parse_expr` seed tool (out of scope here) could be added to create `SymbolicExpr` values from `String` inputs, completing the round-trip.

---

## 11. Relationship to Subsequent Slices

| Slice | Dependency on TR Phase 3 Full |
|---|---|
| Node Runtimes Phase 2 | Prerequisite (concurrent or prior). Unlocks 48 NR2-gated tools. |
| TR Phase 4 (user-defined tools) | Inherits the same `tool.yaml` + `tool.py` layout validated by phases 3 pilot + full. |
| LLM-to-tool bridge | Consumers of the `findProducers`/`findConsumers` graph built from all 62 seeds. |
| Workflow presets | Can reference seed tools by name in YAML workflow definitions once all 62 are registered. |
| sympy input bootstrap | `sympy.parse_expr` seed (String → SymbolicExpr) deferred to a future minor slice. |

---

## 12. Acceptance Criteria

- [ ] `loadSeedTools` registers 62 tools idempotently (loader unit test passes with `EXPECTED_COUNT = 62`).
- [ ] `SymbolicExpr` schema registered at startup; appears in `schemaRegistry.list()`.
- [ ] All 10 category integration test files exist under `seeds/__tests__/categories/`.
- [ ] Integration tests for descriptive_stats and data_io completions pass with numpy/pandas installed.
- [ ] Integration tests for all other categories skip gracefully when libraries are absent.
- [ ] No TypeScript compilation errors introduced by schema addition.
- [ ] `manifest.ts` contains exactly 62 `SeedToolDef` entries.
- [ ] Each `tool.yaml` contains a `category:` field matching the category table above.
- [ ] Each `tool.yaml` contains a `requires:` list matching Section 9.
