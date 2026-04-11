# Plurics Tool Registry — Design Document

**Version:** 0.1 (draft)
**Status:** Design — not yet implemented
**Scope:** Full specification of the Tool Registry subsystem
**Parent document:** `docs/design/overview.md` Section 4
**Related documents:** `docs/manifesto.md`, `docs/design/node-runtimes.md` (to be written)

---

## 1. Introduction

The Tool Registry is the persistent store of validated computational primitives that Plurics workflows invoke instead of writing ad-hoc code. It is the subsystem that operationalizes the manifesto's central thesis: that LLMs should reason about problems and compose validated tools, and that code should compute. Without the registry, Plurics is a workflow engine that happens to orchestrate LLMs. With the registry, Plurics is a workflow engine whose LLMs have access to a growing library of correctness guarantees.

This document specifies the registry at a level sufficient to implement it. It covers what a tool is, how tools are stored, how the registry is accessed, how tool compositions are type-checked, how versions are managed, how tests validate tools at registration time, how tools are executed at runtime, and how workflows integrate with the registry. It also defines the migration path from the current Plurics state (no registry) to a working registry with a useful seed ecosystem.

The registry is designed to be simple enough to implement in a few weeks and correct enough to serve as the foundation for all future Plurics workflows. Simplicity here is not a compromise — it is a deliberate choice. A registry that tries to solve every problem at once will not ship; a registry that solves the core problem well and leaves extensions as future work will ship and will be useful from day one.

## 2. Core Concepts

Before entering the specification, this section defines the entities that populate the registry and their relationships. Readers should internalize these definitions because the rest of the document uses them precisely.

A **tool** is a unit of deterministic computation with typed input ports, typed output ports, a Python implementation, a set of tests, and metadata. A tool is identified by a name (a string like `pandas.load_csv` or `sklearn.pca`) and a version (a monotonic integer). A tool is immutable once registered: modifying a tool creates a new version, and the old version remains available.

A **schema** is a named type used to describe the shape of data flowing between tools. Schemas are nominal: two schemas with the same name refer to the same type, two schemas with different names are distinct types regardless of structural similarity. The registry ships with a set of built-in primitive schemas (`Integer`, `Float`, `String`, `Boolean`, `List[T]`, `Dict[K,V]`, `JsonObject`) and structured schemas for common scientific computing types (`DataFrame`, `NumpyArray`, `OhlcFrame`, `FeaturesFrame`, `ReturnSeries`, `SignalSeries`, `Statistics`). Workflows can register new schemas as needed, and once registered a schema is globally available to all workflows.

A **port** is a named input or output slot on a tool, with an associated schema. A tool that computes PCA might have input ports `matrix: NumpyArray` and `n_components: Integer`, and output ports `loadings: NumpyArray` and `explained_variance: List[Float]`. Ports are how the type system describes tool signatures.

A **converter** is a special kind of tool whose purpose is to transform one schema into another when the two schemas represent equivalent information in different forms. For example, a converter from `DataFrame` to `NumpyArray` extracts the numeric values; a converter from `OhlcFrame` to `ReturnSeries` computes log returns from closing prices. Converters are registered as first-class entities so that the type checker can automatically insert them when a composition requires bridging between schemas.

A **composition** is a sequence of tool invocations where the outputs of earlier tools feed into the inputs of later tools. Compositions can be authored explicitly (in a workflow YAML as a graph of tool nodes) or implicitly (by an LLM in a reasoning node that chains tool calls). Compositions are type-checked: the schemas of connected ports must match, and where they do not match, the checker attempts to insert converters automatically.

A **tool invocation** is a concrete call to a tool with specific input values. An invocation has a caller (a reasoning node or a tool node), inputs (a dict mapping port names to values), and a result (a dict mapping output port names to values, or an error). Invocations are logged for observability and reproducibility.

The **registry** is the collection of all tools, schemas, and converters available on a Plurics installation. It lives on disk with a structured layout and is indexed by an SQLite database. The registry is local to a Plurics installation — there is no remote registry in the initial design, and sharing between installations is a manual export/import operation.

## 3. Tool Specification

A tool is defined by a directory on disk containing four things: a manifest, an implementation, a test file, and optional documentation. This section describes each.

### 3.1 The Tool Manifest

Every tool has a manifest file named `tool.yaml` that declares its identity, version, ports, and metadata. The manifest is human-readable and machine-parseable. Here is the full structure of a manifest:

```yaml
name: sklearn.pca
version: 1
description: |
  Principal Component Analysis via scikit-learn.
  Takes a numeric matrix, returns the principal components,
  loadings, and explained variance ratio.

category: decomposition
tags: [dimensionality_reduction, unsupervised, linear]

inputs:
  matrix:
    schema: NumpyArray
    required: true
    description: Input data matrix, rows are samples, columns are features.
  n_components:
    schema: Integer
    required: false
    default: null
    description: |
      Number of components to keep. If null, keep min(n_samples, n_features).
  whiten:
    schema: Boolean
    required: false
    default: false

outputs:
  components:
    schema: NumpyArray
    description: Principal axes in feature space, shape (n_components, n_features).
  loadings:
    schema: NumpyArray
    description: Projection of the data onto the principal components.
  explained_variance_ratio:
    schema: List[Float]
    description: Percentage of variance explained by each component.

implementation:
  language: python
  entry_point: tool.py:run
  requires:
    - scikit-learn>=1.3
    - numpy>=1.24

tests:
  file: tests.py
  required: true

metadata:
  author: seed
  created_at: 2026-04-15T10:00:00Z
  stability: stable
  cost_class: fast
```

The `name` field is the tool's identifier. Names follow a dotted convention where the first segment indicates the provenance or category (`sklearn`, `pandas`, `scipy`, `custom`, `workflow.math_discovery`) and the remaining segments identify the specific operation. Names must be unique within a registry at a given version; two versions of the same tool share a name and differ only in the `version` field.

The `version` field is a monotonic integer. The first registered version of a tool is version 1. When a tool is modified and re-registered, the version increments. The registry tracks all versions; workflows can pin to a specific version or request the latest.

The `inputs` and `outputs` fields declare the tool's ports. Each port has a name, a schema, an optional `required` flag (defaulting to true), an optional `default` value (meaningful only when required is false), and a human-readable description. The description is important because it is exposed to LLMs in reasoning nodes — the LLM reads the descriptions to decide which tools are relevant to its problem.

The `implementation` block declares how the tool is executed. For Python tools, `language: python`, `entry_point` points to a function in a Python file, and `requires` lists the Python package dependencies. The `requires` field is informational in the initial implementation — it documents what must be installed for the tool to work, but the registry does not automatically create virtual environments or install packages. Installation is the responsibility of the user or the workflow author.

The `tests` block points to the test file. For human-registered tools, tests are optional (the field can be omitted or `required: false`). For agent-registered tools (those created through the `onToolProposal` plugin hook), tests are mandatory and the registry rejects proposals without tests.

The `metadata` block holds information that is useful for discovery and filtering: who authored the tool, when it was created, how stable it is (`experimental`, `stable`, `deprecated`), and an informal cost class (`fast`, `medium`, `slow`) that helps LLMs reason about which tools to invoke when time matters.

### 3.2 The Implementation File

The implementation file is a Python file that defines the function pointed to by `entry_point`. The function receives the tool's inputs as keyword arguments and returns a dictionary with the tool's outputs. Here is the skeleton:

```python
# tool.py

def run(matrix, n_components=None, whiten=False):
    """
    Entry point for the sklearn.pca tool.
    Called by the Plurics tool executor with inputs as kwargs.
    Returns a dict whose keys match the declared output ports.
    """
    from sklearn.decomposition import PCA
    import numpy as np

    model = PCA(n_components=n_components, whiten=whiten)
    loadings = model.fit_transform(matrix)

    return {
        "components": model.components_,
        "loadings": loadings,
        "explained_variance_ratio": model.explained_variance_ratio_.tolist(),
    }
```

The function must accept exactly the declared input ports as kwargs (required ones always passed, optional ones passed when the caller provides a value or falls back to the manifest default). It must return exactly the declared output ports as dict keys. Any deviation from the declared signature is caught by the test runner at registration time and causes the registration to fail.

The tool executor is responsible for marshalling inputs from their transport representation (JSON over stdin when invoked as a subprocess, or in-process Python objects when called directly) into the types expected by the function, and for marshalling outputs back. For primitive schemas (`Integer`, `Float`, `String`, `Boolean`), this is trivial JSON encoding. For structured schemas (`NumpyArray`, `DataFrame`), the executor uses pickle for in-process calls and a JSON-with-base64 encoding for subprocess calls. The details of the encoding layer are specified in Section 9 (Runtime and Execution).

### 3.3 The Test File

Tests validate the tool at registration time and provide regression safety when the registry evolves. They are written in a format similar to pytest but interpreted by the Plurics test runner, which is a thin wrapper that invokes the tool and checks results.

```python
# tests.py

import numpy as np

def test_basic_pca():
    """PCA on a simple 3D dataset returns the correct number of components."""
    matrix = np.array([
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0],
        [7.0, 8.0, 9.0],
        [2.0, 1.0, 0.0],
    ])
    result = invoke_tool(matrix=matrix, n_components=2)
    assert result["loadings"].shape == (4, 2)
    assert len(result["explained_variance_ratio"]) == 2
    assert sum(result["explained_variance_ratio"]) <= 1.0 + 1e-9

def test_default_n_components():
    """When n_components is None, PCA keeps min(n_samples, n_features)."""
    matrix = np.random.randn(10, 5)
    result = invoke_tool(matrix=matrix)
    assert result["components"].shape == (5, 5)

def test_whitening():
    """When whiten=True, output columns have unit variance."""
    matrix = np.random.randn(100, 3)
    result = invoke_tool(matrix=matrix, whiten=True)
    loadings = result["loadings"]
    variances = np.var(loadings, axis=0)
    assert np.allclose(variances, 1.0, atol=0.1)
```

The `invoke_tool` function is provided by the test runner context. It invokes the tool's entry point with the given inputs and returns the result dict. Test functions follow the convention `test_*` and can contain any Python code; failures are reported via standard assertions. A tool's tests must all pass for the tool to be successfully registered.

The test runner captures timing information for each test, which becomes part of the tool's metadata (used to populate the informal `cost_class` field if not manually set). Tests that take longer than a configurable threshold (default 30 seconds) are flagged as slow; tools whose tests take longer than a hard limit (default 5 minutes) are rejected as inappropriate for the registry.

## 4. Filesystem Layout

The registry lives entirely on disk at `~/.plurics/registry/`. The layout is designed to be inspectable with standard shell tools (`ls`, `find`, `grep`) and to degrade gracefully if the metadata database becomes corrupted or out of sync.

```
~/.plurics/registry/
├── registry.db                    # SQLite index of everything
├── tools/
│   ├── sklearn.pca/
│   │   ├── v1/
│   │   │   ├── tool.yaml
│   │   │   ├── tool.py
│   │   │   ├── tests.py
│   │   │   └── README.md          # Optional, human-readable docs
│   │   └── v2/
│   │       ├── tool.yaml
│   │       ├── tool.py
│   │       └── tests.py
│   ├── pandas.load_csv/
│   │   └── v1/
│   │       └── ...
│   └── scipy.hypothesis_testing.permutation/
│       └── v1/
│           └── ...
├── schemas/
│   ├── NumpyArray.yaml
│   ├── DataFrame.yaml
│   ├── OhlcFrame.yaml
│   └── ...
├── converters/
│   ├── DataFrame_to_NumpyArray/
│   │   └── v1/
│   │       └── ...
│   └── OhlcFrame_to_ReturnSeries/
│       └── v1/
│           └── ...
└── logs/
    ├── registration.log           # Append-only log of registrations
    └── invocations.log            # Optional, sampled invocation log
```

Tool directories are named by the tool's full name (with dots preserved). Each version is a subdirectory. The contents of a version directory are the four files described in Section 3: manifest, implementation, tests, optional README.

Schema definitions are stored in a flat `schemas/` directory, one file per schema. Converters are stored under `converters/` with a naming convention `SourceSchema_to_TargetSchema` and the same per-version structure as tools. Converters are themselves tools (they have manifests, implementations, and tests), but they are indexed separately in the database for fast lookup during composition type checking.

The `registry.db` SQLite database holds indexed metadata for fast queries: tool names, versions, categories, tags, schema dependencies, authorship, timestamps, test results, invocation statistics. The database is a cache over the filesystem — everything in it can be reconstructed by scanning the directory tree and parsing the manifests. This cache-over-filesystem invariant is important because it means the registry degrades gracefully: if the database is deleted, lost, or corrupted, the registry runs a rebuild pass at startup that repopulates the cache from disk.

The `logs/` directory contains append-only logs that are not critical for operation but are useful for auditing. `registration.log` records every tool registration (successful or failed, with test results). `invocations.log` optionally records tool invocations with inputs, outputs, timing, and caller context — this is disabled by default because it can become large quickly, and enabled per-workflow when observability is needed.

## 5. The Registry API

The registry exposes three categories of operations: registration (adding tools), discovery (finding tools), and invocation (calling tools). Each category has an internal API used by the Plurics server and a corresponding WebSocket or REST endpoint for external access (UI, eventually MCP bridge).

### 5.1 Registration

Registration is the operation that adds a new tool, schema, or converter to the registry. It is invoked in three scenarios: (a) during initial Plurics installation when seed tools are loaded, (b) manually by a human authoring a custom tool, (c) by a workflow plugin's `onToolProposal` hook when a reasoning node proposes a new tool.

The registration flow is identical in all three scenarios:

1. **Validate manifest.** Parse `tool.yaml`, check that required fields are present, check that schema references resolve to registered schemas, check that the name does not conflict with a different tool at the same version.
2. **Validate implementation.** Load the implementation file and verify that the declared entry point exists and has the expected signature (matches the declared inputs).
3. **Run tests.** Execute the test file in the tool's context. All tests must pass. Test execution has a hard timeout (5 minutes total for a tool's test suite); tools that exceed it are rejected.
4. **Compute tool hash.** Compute a SHA-256 hash of the tool directory contents. This hash is stored in the metadata and used to detect if a tool has been modified on disk outside the registry API (which would violate the immutability invariant).
5. **Write filesystem.** Create the version directory under `tools/{name}/v{version}/` and copy the manifest, implementation, and tests into place. If a version already exists at this name, the registration fails unless the caller explicitly requested a version bump.
6. **Update database.** Insert a row into the `tools` table with the tool's metadata. Insert rows into the `tool_ports` table for each input and output. Insert rows into the `tool_schemas` table for each schema dependency.
7. **Append to registration log.** Record the registration in `logs/registration.log` with timestamp, caller, outcome, and test results.

Registration is atomic: either all steps succeed and the tool is added, or the filesystem and database are left unchanged. The implementation uses a staging directory: the tool is first built in a temporary location, validated there, and only moved into the canonical location once everything has succeeded. A failure at any step cleans up the staging directory and leaves the registry untouched.

The registration API signature, exposed at Layer 1:

```typescript
interface RegistrationRequest {
  manifestPath: string;      // Path to tool.yaml on disk
  caller: 'seed' | 'human' | 'agent';
  workflowRunId?: string;    // Present when caller is 'agent'
  testsRequired: boolean;    // True for agent, configurable for human
}

interface RegistrationResult {
  success: boolean;
  toolName: string;
  version: number;
  testsRun: number;
  testsPassed: number;
  errors: RegistrationError[];
}
```

The REST endpoint is `POST /api/registry/tools/register`, accepting a multipart upload of the tool directory. The WebSocket equivalent is the message type `registry:tool:register`. Both funnel into the same internal API.

### 5.2 Discovery

Discovery is the operation that finds tools matching some criteria. It is invoked in two scenarios: (a) when a workflow declares its tool dependencies and the engine needs to resolve them, (b) when the UI displays the tool registry browser for human inspection.

The discovery API supports several query modes:

**By name.** `get("sklearn.pca")` returns the latest version of the tool; `get("sklearn.pca", 2)` returns version 2 specifically.

**By category.** `list_by_category("decomposition")` returns all tools in that category.

**By schema.** `find_producers("NumpyArray")` returns all tools that have at least one output port of type `NumpyArray`; `find_consumers("NumpyArray")` returns all tools that have at least one input port of type `NumpyArray`. These queries support composition planning: an LLM asking "what can I do with a NumpyArray?" gets a useful list.

**By full-text search.** `search("fourier transform")` matches against tool names, descriptions, and tags. This is the fallback for LLMs describing what they want in natural language.

**By composition goal.** `find_path(source_schema, target_schema)` returns a list of tool chains that transform data of one schema into data of another schema, using converters where needed. This is the most ambitious query mode and is specified in Section 7 (Composition and Type Checking).

Discovery queries are fast because they hit the SQLite index, not the filesystem. The filesystem is touched only when the caller actually needs the tool's implementation (to invoke it) or its manifest (to display full details).

### 5.3 Invocation

Invocation is the operation that executes a tool with specific inputs. It is invoked by tool nodes in a workflow DAG and by the tool-calling layer inside reasoning node backends when an LLM makes a tool call.

The invocation flow:

1. **Resolve tool.** Look up the tool by name and version. If the version is not specified, resolve to the latest version. If the tool does not exist, return an error.
2. **Validate inputs.** Check that required input ports are all provided. Check that each input value matches the declared schema of its port. Apply default values for omitted optional inputs.
3. **Execute.** Launch a Python subprocess with the tool's directory as cwd. Pass the inputs as JSON on stdin. The subprocess imports the tool's entry point, calls it with the decoded inputs, encodes the result as JSON, writes to stdout, and exits. A hard timeout is enforced (configurable per invocation, default 5 minutes).
4. **Parse result.** Read the subprocess stdout, parse as JSON, check that it contains the declared output ports. Any deviation is a tool runtime error.
5. **Record.** Log the invocation to the database (if sampling is enabled) with timing, inputs hash, and outputs hash.
6. **Return.** Return the result to the caller.

The invocation API signature:

```typescript
interface InvocationRequest {
  toolName: string;
  version?: number;                // Defaults to latest
  inputs: Record<string, unknown>; // Keyed by port name
  timeout?: number;                // Seconds, default 300
  callerContext?: {
    workflowRunId: string;
    nodeName: string;
    scope: string | null;
  };
}

interface InvocationResult {
  success: boolean;
  outputs?: Record<string, unknown>;
  error?: {
    category: 'validation' | 'timeout' | 'runtime' | 'output_mismatch';
    message: string;
    stderr?: string;
  };
  metrics: {
    duration_ms: number;
    memory_peak_mb?: number;
  };
}
```

The sandboxing level is level 1 as specified in the overview: the subprocess runs as the same user as the Plurics server, with the tool's directory as cwd, a process-level timeout, and no further isolation. This is a deliberate simplicity choice: Plurics is single-user locally, tools are authored by the user or come from trusted seeds, and adding heavier sandboxing would complicate implementation without addressing a real threat.

## 6. Schema System

The schema system is what enables tool compositions to be type-checked. It is deliberately simple: schemas are named types with nominal identity, compatibility between schemas is declared explicitly through converters, and there is no structural subtyping or generic type inference beyond what is built into the primitive types.

### 6.1 Schema Definitions

A schema is defined by a YAML file in `~/.plurics/registry/schemas/`. Here is an example:

```yaml
# schemas/OhlcFrame.yaml

name: OhlcFrame
description: |
  A DataFrame holding OHLC (Open, High, Low, Close) candlestick data,
  indexed by timestamp, with numeric columns for open, high, low, close,
  and optionally volume.

kind: structured
python_representation: pandas.DataFrame

required_columns:
  - open: float
  - high: float
  - low: float
  - close: float

optional_columns:
  - volume: float

index_type: datetime64
```

The `name` is globally unique across the registry. The `kind` is either `primitive` (for types that are just tags like `Integer`, `Float`) or `structured` (for types with internal structure like `OhlcFrame`). The `python_representation` declares the concrete Python type used at runtime — for `OhlcFrame`, that's a pandas DataFrame.

For structured schemas, additional fields describe the internal structure. These fields are informational (used by the registry to generate documentation and to guide LLMs) but are not enforced at type-check time. Type checking is nominal: a tool that declares it accepts `OhlcFrame` will accept any value that came from a tool declaring its output as `OhlcFrame`, regardless of whether the actual DataFrame has the right columns at runtime. Runtime validation of structure is the responsibility of the tool itself, typically in its first few lines.

This trade-off — nominal typing over structural enforcement — is deliberate. Structural enforcement would require a full type checker for Python values, which is complexity that adds little value: the existing Python exception mechanism handles malformed inputs adequately, and the registry's role is to catch compositional mismatches (connecting a tool's output to another tool's input with a wrong type name), not to validate that every DataFrame has exactly the right columns.

### 6.2 Built-in Primitive Schemas

The registry ships with a fixed set of primitive schemas that all tools can use without registration:

| Schema | Python type | Description |
|---|---|---|
| `Integer` | `int` | Signed integer |
| `Float` | `float` | Double-precision floating point |
| `String` | `str` | UTF-8 string |
| `Boolean` | `bool` | True or false |
| `JsonObject` | `dict` | Arbitrary JSON-serializable dict |
| `JsonArray` | `list` | Arbitrary JSON-serializable list |
| `Null` | `None` | Used to mark optional outputs |

Generic primitives use a simple parameterized syntax for type tags: `List[Integer]` is a list of integers, `Dict[String, Float]` is a dict mapping strings to floats. The generic syntax is parsed by the type checker and treated as a nominal type — `List[Integer]` and `List[Float]` are distinct types, and compatibility between them is not automatic.

### 6.3 Built-in Structured Schemas

The registry also ships with structured schemas for common scientific computing types. These are seeded at installation time and can be extended by workflows that introduce domain-specific types.

| Schema | Python type | Description |
|---|---|---|
| `NumpyArray` | `np.ndarray` | Multi-dimensional numeric array |
| `DataFrame` | `pd.DataFrame` | Generic pandas DataFrame |
| `OhlcFrame` | `pd.DataFrame` | DataFrame with OHLC columns |
| `FeaturesFrame` | `pd.DataFrame` | DataFrame with computed features indexed by timestamp |
| `ReturnSeries` | `pd.Series` | Time series of returns |
| `SignalSeries` | `pd.Series` | Time series of signals (±1 or 0) |
| `Statistics` | `dict` | Dict of statistical test results |
| `SymbolicExpr` | `sympy.Expr` | SymPy symbolic expression |

A workflow that needs a schema not in the seed set can register its own by writing a schema YAML file and calling the registration API. The new schema is then globally available to all workflows.

### 6.4 Schema Versioning

Schemas themselves are versioned, but with a different policy than tools. A schema name uniquely identifies a schema, and modifications to a schema's definition are treated as backward-compatible refinements (clarifying the description, adding optional fields to structured schemas) rather than new versions. This is because schemas are used as type tags — breaking a schema's definition would break every tool that references it, and the complexity of managing schema versions throughout compositions is not worth the marginal benefit.

If a workflow needs a schema that is genuinely incompatible with an existing one, the correct action is to register a new schema with a different name (e.g., `OhlcFrameV2`) rather than to version the original. This keeps the type system's semantics simple.

## 7. Composition and Type Checking

Compositions are the way tools connect to form larger workflows. This section specifies how the type checker validates compositions and how converters are used to bridge between schemas.

### 7.1 Explicit Compositions in Workflow YAML

When a workflow YAML defines a tool node, it specifies the tool to invoke and where its inputs come from. Here is the expected syntax:

```yaml
nodes:
  load_data:
    tool: pandas.load_csv
    inputs:
      path: "{{WORKSPACE}}/data/ohlc.csv"
    # No depends_on, this is a source node

  compute_features:
    tool: custom.compute_ta_features
    inputs:
      ohlc: "${load_data.outputs.df}"
    depends_on: [load_data]

  run_pca:
    tool: sklearn.pca
    inputs:
      matrix: "${compute_features.outputs.features}"
      n_components: 5
    depends_on: [compute_features]
```

The `inputs` block declares what feeds each input port. Values can be literal (strings, numbers), templated (using workflow config substitution like `{{WORKSPACE}}`), or references to upstream node outputs (using the `${node.outputs.port}` syntax).

At parse time, the workflow engine performs type checking on the composition. For each tool node, it looks up the tool's manifest, reads the declared input port types, and verifies that each input source has a compatible type. Literal values are checked against the port type (a string literal for a port expecting `Integer` is a type error). Upstream references are checked by looking up the upstream tool's output port type.

When a type mismatch is detected, the checker attempts to insert a converter. If the source type is `DataFrame` and the target type is `NumpyArray`, the checker searches the converter registry for `DataFrame_to_NumpyArray`. If the converter exists, the checker inserts it automatically as an invisible node between the two tools. If the converter does not exist, the composition is rejected with a type error: `"Cannot connect DataFrame output of compute_features to NumpyArray input of run_pca: no converter registered for DataFrame → NumpyArray."`

The invisible converter insertion is a convenience that keeps workflow YAML readable. Workflow authors do not need to manually insert conversion nodes for common transformations. But the insertion is tracked: the DAG snapshot that the engine writes includes the inserted converters so that the run is fully traceable, and the UI shows them in the visualization.

### 7.2 Implicit Compositions in Reasoning Nodes

When a reasoning node's LLM calls tools at runtime, the compositions are not known at workflow parse time. Instead, type checking happens at each tool invocation: the LLM proposes a tool call with specific inputs, and the runtime validates that the inputs match the declared port types before dispatching.

For LLMs to compose tools effectively, they need to know which tools produce what and which tools consume what. This is why the discovery API includes `find_producers` and `find_consumers` queries: the LLM, given a goal ("I need to do PCA on this dataset"), can ask the registry for tools that accept `NumpyArray` inputs and produce component outputs, and receive a filtered list.

The way this is exposed to the LLM depends on the backend. For Claude API and OpenAI-compatible backends that support tool use natively, the registry generates tool definitions in the backend's expected format (Anthropic tool use or OpenAI function calling) from the tool manifests. The LLM sees the tools as callable functions with typed parameters, and the backend translates its function call into a registry invocation. Tool call results are returned to the LLM as messages in the same format.

For local LLMs that do not support tool use natively, the backend falls back to a convention: the LLM is instructed via system prompt that it can invoke tools by writing specific JSON blocks, and the backend parses those blocks out of the output and dispatches them. This is less robust but allows modeling workflows that use local models without requiring the full tool-use protocol.

### 7.3 Converter Registry

Converters are indexed separately from tools in the database, in a table keyed by `(source_schema, target_schema)`. The type checker queries this table when it needs to bridge between two schemas, and the answer is either "yes, converter X exists" or "no, no converter available."

The converter registry supports multi-hop conversion in principle (convert `OhlcFrame` to `NumpyArray` by going through `DataFrame`), but the initial implementation only handles single-hop. Multi-hop path finding is reserved as an open question for when it becomes necessary; until then, workflows that need conversions not directly supported must register direct converters.

Converters are themselves tools, subject to the same registration rules: they have manifests, implementations, and tests. A converter's test validates that the conversion preserves the semantically meaningful content — for example, that converting `OhlcFrame` to `ReturnSeries` and then examining the result matches a reference computation.

## 8. Versioning and Evolution

Tool versioning is monotonic: every registered tool has a version, starting at 1 and incrementing by 1 each time a new version is registered for the same name. There is no semver, no major/minor/patch distinction, no semantic coupling between version numbers and compatibility.

### 8.1 Version Lifecycle

When a tool is first registered, it becomes version 1 and is marked as the "latest" version for its name. When a new version is registered for the same name, it becomes the new latest; the previous versions remain in the registry but are no longer the default for unqualified references.

Workflows can pin to a specific version in their YAML:

```yaml
run_pca:
  tool: sklearn.pca
  version: 2            # Pin to v2
  inputs: ...
```

Omitting the `version` field resolves to the latest version at parse time. This is a deliberate choice: workflows are free to pin, but the friction for not pinning is zero, and most workflows will not need to. The exception is workflows that produce findings meant to be reproducible months later — those should pin all their tool versions explicitly, and the workflow YAML is a complete record of the computational environment.

Versions older than the latest are marked with a `status` field in the database: `active` (available for use), `deprecated` (still available but discouraged), or `archived` (preserved for historical runs but not available to new workflows). Transitions between statuses are manual operations performed by the user; the registry does not automatically deprecate or archive versions.

### 8.2 Version Compatibility Metadata

When registering a new version of a tool, the caller can declare compatibility metadata: whether the new version is backward-compatible with the previous version, and what changed. This metadata is informational — it does not gate registration or automatic version resolution — but it is useful for diagnosing issues after the fact.

```yaml
# When registering sklearn.pca v2
name: sklearn.pca
version: 2
compatibility:
  backward_compatible_with: [1]
  changes:
    - "Added `svd_solver` input port with default 'auto'"
    - "Output `components` shape unchanged"
```

If `backward_compatible_with` is omitted, the default assumption is that the new version is not backward-compatible. Workflows relying on the old version must pin explicitly, or risk breaking when they re-parse against the latest.

### 8.3 Modification and Immutability

A registered tool version is immutable. The registry API does not expose any operation to modify a tool in place. If the tool's author discovers a bug after registration, the correct action is to register a new version with the fix, optionally marking the buggy version as deprecated.

The immutability is enforced by the tool hash stored in the metadata. When a tool is invoked, the registry can optionally verify the current filesystem contents against the stored hash. A mismatch indicates that someone modified the tool directly on disk, bypassing the API. This is treated as a warning rather than a hard error (because the registry cannot prevent a user from using `rm` and `vim`), but the warning is visible in the UI and in the invocation logs.

## 9. Runtime and Execution

This section describes how tools are actually executed at runtime — the mechanics that sit between an invocation request and a returned result.

### 9.1 Execution Model

Tool execution happens in a Python subprocess launched by the Plurics server. The server does not load tools into its own process, for three reasons: process isolation protects the server from tool crashes and memory leaks; subprocess execution allows parallel invocations of different tools without GIL contention; and the subprocess model means tools can have incompatible Python dependencies without colliding in the server process.

The subprocess is launched with:
- **cwd**: the tool's version directory (`~/.plurics/registry/tools/{name}/v{version}/`)
- **Python interpreter**: the system Python by default, or a configured alternative
- **stdin**: JSON-encoded input dict
- **stdout**: expected to contain JSON-encoded output dict
- **stderr**: captured for error reporting
- **timeout**: enforced by the server process, SIGTERM then SIGKILL

The subprocess runs a standard wrapper script (part of the Plurics installation) that:
1. Reads the JSON input from stdin
2. Imports the tool's entry point module
3. Calls the entry point function with the decoded inputs
4. Encodes the result as JSON
5. Writes the JSON to stdout and exits with code 0

If the entry point raises an exception, the wrapper catches it, encodes the exception type and message as a structured error, writes the error to stdout, and exits with code 1. The server distinguishes exit code 0 (success, parse stdout as result) from exit code 1 (tool-level error, parse stdout as error dict) from other non-zero codes (process-level failure, consider the tool crashed).

### 9.2 Serialization

Primitive types (integers, floats, strings, booleans, lists, dicts of these) are serialized as JSON directly. Structured types need a more efficient encoding because JSON is a poor match for numeric arrays and DataFrames.

The serialization strategy uses Python's `pickle` for structured types, encoded as base64 inside a JSON envelope:

```json
{
  "matrix": {
    "_schema": "NumpyArray",
    "_encoding": "pickle_b64",
    "_data": "gASVUgAAAAAAAA..."
  }
}
```

The wrapper script recognizes the `_schema` and `_encoding` keys, unpickles the data, and passes the resulting Python object to the tool. On the way back, results matching a structured schema are pickled and wrapped before being written to stdout.

The pickle-based approach has known drawbacks (pickle is not secure against untrusted data, and pickle format can change between Python versions). The first drawback is acceptable under the threat model (tools are trusted). The second is mitigated by the registry being tied to a specific Python major version at installation — if the Python version changes incompatibly, tools may need to be re-registered, but this is a rare event.

For tools that want to avoid pickle for other reasons (size, portability), the manifest can declare an alternative encoding. The initial registry supports `pickle_b64` (default for structured types) and `json_literal` (for types that serialize cleanly to JSON). Additional encodings can be added in the future without changing the tool manifest format.

### 9.3 Resource Limits

Per invocation, the server enforces:
- **Wall clock timeout**: configurable per invocation, default 300 seconds. On expiration, the subprocess receives SIGTERM; if still alive after 5 seconds, SIGKILL.
- **Maximum output size**: 100 MB of stdout by default. Larger outputs are truncated and the invocation fails with `output_too_large`.
- **Maximum input size**: 100 MB of stdin by default. Larger inputs fail validation before subprocess launch.

These limits are defensive rather than security-motivated. A bug in a tool that causes infinite output or infinite computation should not bring down the Plurics server. The limits can be overridden per invocation by callers with legitimate needs (a long-running backtest might take an hour; a large computation might produce 500 MB of output), but the defaults are conservative.

There is no memory limit enforcement in the initial implementation. Python makes it awkward to enforce memory limits on subprocesses in a portable way, and the failure mode of memory exhaustion (OOM kill by the OS) is acceptable in the single-user local threat model.

### 9.4 Invocation Caching

Tools are pure functions by design: given the same inputs, they produce the same outputs. This makes invocation results cacheable. The registry supports an optional invocation cache that stores results keyed by `(tool_name, version, inputs_hash)`. When an invocation is requested with inputs that have been seen before, the cached result is returned immediately without re-executing the tool.

Caching is opt-in per tool: the manifest can declare `cacheable: true`, which signals to the registry that caching is safe. Tools with side effects (file writes, network calls) must declare `cacheable: false` (the default). The tool author is responsible for making this declaration honestly — the registry cannot detect side effects automatically.

Cache entries are stored in `~/.plurics/registry/cache/` with a retention policy configurable per installation. The cache is strictly a performance optimization; its contents are never necessary for correctness, and deleting the cache directory has no effect beyond invalidating stored results.

Cache enablement is a post-MVP feature. The initial registry implementation executes every invocation fresh; caching is added once the basic invocation flow is stable and profiling shows that caching would pay off.

## 10. Workflow Integration

This section describes how workflows interact with the registry: how they declare tool dependencies, how tool nodes invoke tools, how reasoning nodes expose tools to LLMs, and how plugins propose new tools.

### 10.1 Declaring Tool Dependencies in Workflow YAML

A workflow declares its tool dependencies in two places. First, at the top level, it can declare required tools that must be available in the registry for the workflow to run at all:

```yaml
name: sequence-explorer
version: 1

required_tools:
  - name: oeis.query
    min_version: 1
  - name: sympy.simplify
  - name: statistics.fit_linear_recurrence
    version: 2              # Pin to exactly v2

nodes:
  ...
```

At workflow parse time, the engine checks that all required tools exist in the registry. If any are missing, the workflow fails to parse with a clear error listing the missing tools.

Second, within each tool node, the `tool` field names a specific tool that this node invokes. The `tool` field can reference a tool that was not in the top-level `required_tools` list — the engine will check it at parse time anyway — but listing tools at the top level gives a clear summary of the workflow's dependencies for documentation and analysis.

### 10.2 Exposing Tools to Reasoning Nodes

Reasoning nodes receive access to a subset of the registry in their LLM context. The subset is declared in the node's YAML:

```yaml
conjecturer:
  backend: claude-api
  model: opus
  toolset:
    - category: data_analysis
    - category: symbolic_math
    - name: statistics.*         # Glob pattern
    - name: custom.my_helper
  depends_on: [profiler]
```

The `toolset` block uses three forms: `category: X` (all tools in category X), `name: X` (a specific tool), and glob patterns (`name: statistics.*` for all tools whose name starts with `statistics.`). The engine resolves these to a concrete list of tools, loads their manifests, and constructs the backend-specific tool definitions (Anthropic tool use format for Claude, OpenAI function calling format for OpenAI-compatible backends).

When the reasoning node runs, the LLM sees this toolset as available functions it can call during its turn. The model's tool calls are routed through the registry's invocation API, and results are returned as tool results in the model's response cycle. The LLM's final output (the answer it produces after composing tools) is captured as the node's signal.

The `toolset` declaration is what allows a workflow to be explicit about what an LLM can do. A reasoning node with a narrow toolset (e.g., only statistical testing tools) has a constrained action space that makes its behavior predictable and its reasoning focused. A reasoning node with a broad toolset has more freedom but also more responsibility to choose well. Workflow authors tune the granularity based on the role of each node.

### 10.3 Plugin Hooks for Tool Registration

Plugins can propose new tools for registration via the `onToolProposal` hook. This is how agent-generated tools enter the registry:

```typescript
interface WorkflowPlugin {
  // ... other hooks

  onToolProposal?(
    proposal: ToolProposal,
    registry: RegistryClient,
  ): Promise<ToolRegistrationResult>;
}

interface ToolProposal {
  name: string;
  description: string;
  manifest: ToolManifest;
  implementation: string;     // Python source code
  tests: string;              // Python source code
  proposedBy: {
    nodeName: string;
    scope: string | null;
    reason: string;           // Why the tool is needed
  };
}
```

When a reasoning node (typically a Toolsmith role) produces a signal with a `decision` indicating a tool proposal, the plugin's `onToolProposal` hook is invoked. The plugin can perform domain-specific validation (checking that the proposed tool fits the workflow's conventions, that the name follows a naming policy, that the description is non-trivial) before forwarding the proposal to the registry via `registry.register(...)`.

The registry handles the standard registration flow (validate manifest, run tests, write to disk, update database). If tests fail, the registration fails and the plugin receives the failure, which it can handle by sending feedback back to the Toolsmith node (typically as a rejection reason that the next iteration of the Toolsmith will see in its context).

The plugin hook `onToolRegression` is invoked by the registry when a regression test fails: specifically, when a new tool registration causes a previously-passing regression test on a related tool to fail. The plugin receives the regression event and can decide to rollback the new registration, accept it and accept the regression, or request manual intervention.

Regression testing is not in the MVP. The initial implementation runs a tool's own tests at registration time but does not automatically re-run tests of related tools. Adding regression testing is scheduled as a follow-up feature once the registry is stable and the test suite is large enough for regression to be a meaningful risk.

## 11. Seed Tools

The registry ships with a seed set of tools covering the standard data science and scientific computing toolkit. These seeds are written once by the Plurics maintainers and bundled with the installation. They are registered at first startup of a fresh Plurics installation, populating `~/.plurics/registry/tools/` with a ready-to-use set of primitives.

### 11.1 Seed Categories

The initial seed set targets the following categories, with approximate counts:

| Category | Count | Examples |
|---|---|---|
| **Data I/O** | 8 | `pandas.load_csv`, `pandas.load_parquet`, `pandas.save_csv`, `pandas.save_parquet`, `json.load`, `json.dump`, `yaml.load`, `yaml.dump` |
| **Descriptive statistics** | 10 | `stats.describe`, `stats.mean`, `stats.median`, `stats.variance`, `stats.quantile`, `stats.histogram`, `stats.correlation_matrix`, `stats.autocorrelation`, `stats.cross_correlation`, `stats.fft` |
| **Hypothesis testing** | 8 | `stats.t_test`, `stats.mann_whitney`, `stats.ks_test`, `stats.chi_square`, `stats.permutation_test`, `stats.bootstrap_ci`, `stats.adf_test`, `stats.ljung_box` |
| **Regression** | 6 | `sklearn.linear_regression`, `sklearn.logistic_regression`, `sklearn.ridge`, `sklearn.lasso`, `statsmodels.ols`, `statsmodels.glm` |
| **Decomposition and dimensionality** | 5 | `sklearn.pca`, `sklearn.ica`, `sklearn.nmf`, `sklearn.tsne`, `sklearn.umap` |
| **Clustering** | 4 | `sklearn.kmeans`, `sklearn.dbscan`, `sklearn.hierarchical`, `sklearn.gaussian_mixture` |
| **Time series** | 7 | `statsmodels.arima`, `statsmodels.garch`, `statsmodels.decompose`, `statsmodels.seasonal_adjust`, `statsmodels.granger_causality`, `ta.compute_rsi`, `ta.compute_atr` |
| **Symbolic math** | 6 | `sympy.simplify`, `sympy.solve`, `sympy.factor`, `sympy.integrate`, `sympy.differentiate`, `sympy.limit` |
| **Data transformation** | 8 | `pandas.filter`, `pandas.groupby_agg`, `pandas.pivot`, `pandas.resample`, `pandas.merge`, `pandas.rolling`, `numpy.reshape`, `numpy.normalize` |
| **Optimization** | 4 | `scipy.minimize`, `scipy.curve_fit`, `scipy.root_finding`, `scipy.linprog` |

Total: approximately 66 seed tools. This is enough to cover the vast majority of analysis steps that workflows will actually need, without requiring the user to register anything on day one.

### 11.2 Seed Tool Construction

Each seed tool is a thin wrapper over a library function: the implementation imports the library (pandas, scipy, sklearn, etc.), calls the appropriate function with the inputs, and returns the result. The wrapper's job is to translate between the library's native API and the registry's schema-based interface.

A seed tool's test is a small set of cases that verify the wrapper works correctly on representative inputs. These tests are fast (sub-second each) and run as part of the registration flow when the seed set is first loaded. A failing seed tool test indicates a bug in the seed implementation or an incompatibility with the installed library versions, and must be fixed before the registry is usable.

Writing the seed set is estimated at about 2 weeks of focused work: one week to write the implementations and tests, one week to refine the schemas and documentation. This is a one-time cost that produces an asset with lasting value — every Plurics installation benefits from it.

### 11.3 Seed Maintenance

Seed tools are versioned like any other tools. When a seed tool is improved (better error handling, additional parameters, updated to new library versions), a new version is released as part of a Plurics update. The existing installations continue to use their old version until they receive the update, at which point the new version is registered alongside the old one.

Seed tools are never automatically removed from a user's registry. Even if a seed tool is deprecated or replaced in a newer Plurics release, old installations retain their copy. This is important for reproducibility: a workflow that ran successfully a year ago must still be able to resume today with the same tool versions.

## 12. Open Questions

This section lists known open questions that will be addressed in future iterations of the registry design. These are items that were deferred from the current design to keep the scope manageable.

**Multi-hop converter path finding.** The current design supports only single-hop conversions between schemas. A workflow that needs to convert `OhlcFrame` to `NumpyArray` via `DataFrame` must either register a direct converter or chain manually. A future enhancement can implement path finding in the converter graph so that multi-hop paths are discovered and inserted automatically.

**Automatic regression testing on tool registration.** The current design runs a tool's own tests at registration but does not automatically re-run tests of related tools. When the registry grows large, regression on related tools becomes a real concern — a new version of a commonly-used tool can silently break downstream tools that depend on it. A future enhancement can implement a regression test runner that identifies related tools and runs their tests before finalizing a registration.

**Shared registries across installations.** The current design is local: each Plurics installation has its own registry. A team of researchers who want to share tools must manually export and import tool directories. A future enhancement can add a sync protocol (git-based or equivalent) for shared registries, with mechanisms for handling name conflicts and version divergence.

**Dynamic environment management.** The current design does not install Python dependencies automatically. Tools declare `requires` in their manifest, but the user is responsible for ensuring those dependencies are available in the Python environment Plurics uses. A future enhancement can create per-tool or per-category virtual environments automatically, isolating tool dependencies from each other.

**MCP server bridge.** The registry is conceptually MCP-compatible but does not expose the protocol. A future enhancement can add an MCP server layer on top of the registry, making Plurics tools accessible to any MCP client (other agent frameworks, IDEs, etc.). This is a thin adaptation layer rather than a redesign.

**Tool-authoring UI.** The current design assumes tools are authored by editing files on disk or via programmatic registration from plugins. A future enhancement can add a UI for authoring, testing, and registering tools interactively from the Plurics frontend — useful for iterative development of domain-specific tools.

**Invocation caching.** Mentioned in Section 9.4. Not in the MVP, added later once the basic invocation flow is stable and profiling justifies the complexity.

These questions are all addressable with additive changes to the current design. None of them require revisiting the core architecture (tool manifests, filesystem layout, registration flow, invocation model, type system).

## 13. Implementation Plan

This section sketches the concrete implementation steps to bring the Tool Registry from the current state (nothing) to a working MVP.

### Phase 1 — Core registry (estimated 1 week)

Build the foundational pieces: the filesystem layout, the SQLite schema, the manifest parser, the registration API, and the discovery API. At the end of this phase, a tool can be registered programmatically via a TypeScript API, stored on disk, indexed in the database, and retrieved by name.

- Define the `registry.db` SQLite schema: `tools`, `tool_ports`, `schemas`, `converters`, `tool_metadata`, `registration_log` tables.
- Implement `ToolManifest` TypeScript types and YAML parser with validation.
- Implement `RegistryClient.register(manifestPath)`: validation, filesystem write, database insert.
- Implement `RegistryClient.get(name, version?)`, `RegistryClient.list(filters)`, `RegistryClient.findProducers(schema)`, `RegistryClient.findConsumers(schema)`.
- Implement the staging directory pattern for atomic registration.

### Phase 2 — Tool execution (estimated 1 week)

Build the invocation layer: the Python wrapper script, the subprocess execution, the JSON serialization with pickle encoding for structured types, the timeout enforcement, and the result parsing. At the end of this phase, a registered tool can be invoked with inputs and return outputs.

- Write the Python wrapper script (`runner.py`) that reads stdin, imports entry point, encodes outputs.
- Implement `RegistryClient.invoke(name, inputs, options)` in TypeScript: subprocess spawn, input encoding, output decoding, error handling.
- Implement pickle-base64 encoding and decoding for structured schemas.
- Enforce timeout via subprocess kill.
- Add invocation logging (initially to stdout, later to `logs/invocations.log`).

### Phase 3 — Seed tools (estimated 2 weeks)

Write the seed tool set. This is the most time-consuming phase, but it is mostly mechanical: for each of the ~66 seeds, write the manifest YAML, the Python implementation wrapper, and a handful of tests.

- Start with Data I/O and Descriptive Statistics (fastest and simplest).
- Then Hypothesis Testing, Regression, Decomposition, Clustering.
- Then Time Series and Symbolic Math.
- Then Data Transformation and Optimization.
- Write a seed-loading script that registers all seeds at Plurics startup if the registry is empty.

### Phase 4 — Schema system and type checking (estimated 1 week)

Implement the schema registry and the type checker for compositions. Extend the workflow YAML parser to validate tool node compositions at parse time.

- Implement `SchemaRegistry` with built-in primitives and structured schemas.
- Implement the type checker: walk the workflow DAG, check each tool node's inputs against the sources, insert converters where needed.
- Parse the `${node.outputs.port}` reference syntax.
- Emit clear type errors with source locations in the workflow YAML.

### Phase 5 — Workflow integration (estimated 1 week)

Wire the registry into the workflow engine. Extend tool nodes to invoke tools via the registry. Extend reasoning nodes to expose toolsets to LLMs via tool-use format generation.

- Add `tool` and `inputs` fields to tool node YAML parsing.
- Add `toolset` field to reasoning node YAML parsing and resolve to concrete tools.
- For Claude backends: generate Anthropic tool use definitions from tool manifests.
- For OpenAI-compatible backends: generate OpenAI function calling definitions.
- Route LLM tool calls through the registry's invocation API.

### Phase 6 — Plugin hooks (estimated 3 days)

Add the plugin hooks for tool proposal and registration.

- Add `declareTools`, `onToolProposal`, `onToolRegression` to `WorkflowPlugin` interface.
- Wire `onToolProposal` into the signal handling flow: when a signal with a tool proposal decision is received, invoke the plugin hook and route to the registry.
- Add error feedback loop: if registration fails, the plugin receives the failure and can feed back to the next node invocation.

### Phase 7 — UI (estimated 1 week)

Add a tool registry browser to the Plurics frontend. This is the last phase and can be deferred if necessary — the registry is fully functional without a UI, via the programmatic API and the workflow YAML.

- Add a REST endpoint for listing and retrieving tools from the registry.
- Add a React component for the tool browser: list view with filters by category and tags, detail view showing the manifest and tests, search bar with full-text search.
- Add a tool invocation preview: let the user invoke a tool manually with test inputs and see the output. Useful for debugging tools during development.

### Total timeline

The estimated total is approximately 7 weeks of focused work for a full Tool Registry MVP including seed tools and UI. This can be compressed if the seed tools are written in parallel with the core implementation (which is the recommended approach), bringing the serial path down to about 5 weeks.

The registry is useful from the end of Phase 3 (after ~4 weeks): at that point, workflows can invoke seed tools through the workflow engine, and the primary value of the registry — letting LLMs compose validated primitives instead of writing code — is realized. Phases 4 through 7 are refinements that make the registry more powerful, more observable, and more ergonomic, but they are not blockers for initial use.

---

*This document is the authoritative design reference for the Plurics Tool Registry. Changes to the design should be proposed as pull requests against this document, discussed, and committed alongside the corresponding code changes. The document is expected to evolve as implementation reveals issues and open questions are resolved.*