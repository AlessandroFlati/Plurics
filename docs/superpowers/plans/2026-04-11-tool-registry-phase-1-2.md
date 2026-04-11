# Tool Registry Phase 1+2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first implementation slice of the Plurics Tool Registry — core storage + indexing + execution — so a developer can register a `tool.yaml`+`tool.py` via a TypeScript API and invoke it to receive a result.

**Architecture:** New server module at `packages/server/src/modules/registry/` with clean internal separation: `manifest/` (parse + validate YAML), `storage/` (filesystem layout at `~/.plurics/registry/` + SQLite index), `schemas/` (built-in primitive + structured schemas), `execution/` (Python subprocess runner with JSON stdio transport), composed by a public `RegistryClient`.

**Tech Stack:** TypeScript ESM (NodeNext), vitest, better-sqlite3 12.8, yaml 2.8, uuid 10, Node `child_process.spawn`, Python 3 runner (stdlib only: `json`, `base64`, `pickle`, `importlib.util`).

**Source of truth:** `docs/superpowers/specs/2026-04-11-tool-registry-phase-1-2-design.md`. When this plan and the spec disagree, the spec wins.

**Test discipline:** Every task that produces code follows red-green-commit: write the failing test, run it to confirm it fails for the right reason, implement the minimum to pass, run the test to confirm it passes, then commit. Integration tests that require Python use `describe.skipIf(!pythonAvailable)` so CI without Python still passes.

**Working directory for all commands:** `C:/Users/aless/PycharmProjects/ClaudeAgentAutoManager` (repository root). The server package is at `packages/server`. Tests run with `npm test --workspace=packages/server -- <file>` or via `cd packages/server && npx vitest run <file>`.

---

## Phase 1 — Skeleton, types, built-in schemas

### Task 1: Create module skeleton and public index

**Files:**
- Create: `packages/server/src/modules/registry/index.ts`
- Create: `packages/server/src/modules/registry/README.md`

- [ ] **Step 1: Create the module directory tree**

```bash
mkdir -p packages/server/src/modules/registry/manifest/__tests__
mkdir -p packages/server/src/modules/registry/storage/__tests__
mkdir -p packages/server/src/modules/registry/schemas/__tests__
mkdir -p packages/server/src/modules/registry/execution/__tests__
mkdir -p packages/server/src/modules/registry/__tests__/fixtures
mkdir -p packages/server/src/modules/registry/python
```

- [ ] **Step 2: Create a placeholder public index**

`packages/server/src/modules/registry/index.ts`:

```typescript
// Public entry point for the Plurics Tool Registry module.
// Everything internal to `registry/` stays internal; only the symbols
// re-exported here are consumable from the rest of the server.

export {};
```

- [ ] **Step 3: Create a minimal README to keep empty dirs tracked by git**

`packages/server/src/modules/registry/README.md`:

```markdown
# @plurics/core — registry module

Implementation of the Plurics Tool Registry. See
`docs/superpowers/specs/2026-04-11-tool-registry-phase-1-2-design.md`
for the design this module implements.

Public API lives in `registry-client.ts` and is re-exported from `index.ts`.
```

- [ ] **Step 4: Commit the skeleton**

```bash
git add packages/server/src/modules/registry/
git commit -m "registry: scaffold module skeleton"
```

---

### Task 2: Write the public types module

**Files:**
- Create: `packages/server/src/modules/registry/types.ts`

No tests — this file contains only type declarations, which the TypeScript compiler validates structurally when the rest of the module uses them.

- [ ] **Step 1: Write `types.ts` with the full public surface**

`packages/server/src/modules/registry/types.ts`:

```typescript
// Public types for the Plurics Tool Registry.
// See docs/superpowers/specs/2026-04-11-tool-registry-phase-1-2-design.md §7.

export type ToolCaller = 'seed' | 'human' | 'agent';
export type PortDirection = 'input' | 'output';
export type Stability = 'experimental' | 'stable' | 'deprecated';
export type CostClass = 'fast' | 'medium' | 'slow';
export type ToolStatus = 'active' | 'deprecated' | 'archived';
export type SchemaKind = 'primitive' | 'structured';
export type SchemaEncoding = 'json_literal' | 'pickle_b64';
export type SchemaSource = 'builtin' | 'user';

// ---------- Schemas ----------

export interface SchemaDef {
  name: string;
  kind: SchemaKind;
  pythonRepresentation: string | null;
  encoding: SchemaEncoding;
  description: string | null;
  source: SchemaSource;
}

// ---------- Tool manifests (post-parse, pre-validation) ----------

export interface ToolPortSpec {
  schema: string;
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface ToolManifest {
  name: string;
  version: number;
  description: string;
  category?: string;
  tags?: string[];
  inputs: Record<string, ToolPortSpec>;
  outputs: Record<string, ToolPortSpec>;
  implementation: {
    language: 'python';
    entryPoint: string;        // "tool.py:run"
    requires?: string[];
  };
  tests?: {
    file: string;              // "tests.py"
    required: boolean;
  };
  metadata?: {
    author?: string;
    createdAt?: string;
    stability?: Stability;
    costClass?: CostClass;
  };
}

// ---------- Tool records (resolved from the DB) ----------

export interface ResolvedPort {
  name: string;
  direction: PortDirection;
  schemaName: string;
  required: boolean;
  default: unknown;
  description: string | null;
  position: number;
}

export interface ToolRecord {
  name: string;
  version: number;
  description: string;
  category: string | null;
  tags: string[];
  inputs: ResolvedPort[];
  outputs: ResolvedPort[];
  entryPoint: string;
  language: 'python';
  requires: string[];
  stability: Stability | null;
  costClass: CostClass | null;
  author: string | null;
  createdAt: string;
  toolHash: string;
  status: ToolStatus;
  directory: string;           // absolute path to the v{N} dir
}

// ---------- Registration ----------

export interface RegistrationRequest {
  manifestPath: string;
  caller: ToolCaller;
  testsRequired?: boolean;
  workflowRunId?: string;
}

export type RegistrationError = {
  category:
    | 'manifest_parse'
    | 'manifest_validation'
    | 'schema_unknown'
    | 'entry_point_missing'
    | 'version_conflict'
    | 'test_failure'
    | 'filesystem'
    | 'database'
    | 'internal';
  message: string;
  path?: string;
};

export type RegistrationResult =
  | {
      success: true;
      toolName: string;
      version: number;
      toolHash: string;
      testsRun: number;
      testsPassed: number;
      directory: string;
    }
  | {
      success: false;
      toolName: string;
      version: number | null;
      errors: RegistrationError[];
    };

// ---------- Discovery ----------

export interface ListFilters {
  category?: string;
  tags?: string[];
  stability?: Stability;
  statusIn?: ToolStatus[];
}

// ---------- Invocation ----------

export interface InvocationRequest {
  toolName: string;
  version?: number;
  inputs: Record<string, unknown>;
  timeoutMs?: number;
  callerContext?: {
    workflowRunId: string;
    nodeName: string;
    scope: string | null;
  };
}

export type InvocationErrorCategory =
  | 'tool_not_found'
  | 'validation'
  | 'timeout'
  | 'runtime'
  | 'output_mismatch'
  | 'subprocess_crash'
  | 'python_unavailable';

export type InvocationResult =
  | {
      success: true;
      outputs: Record<string, unknown>;
      metrics: { durationMs: number };
    }
  | {
      success: false;
      error: {
        category: InvocationErrorCategory;
        message: string;
        stderr?: string;
      };
      metrics: { durationMs: number };
    };

// ---------- Client options ----------

export interface RegistryClientOptions {
  rootDir?: string;          // defaults to ~/.plurics/registry; override via PLURICS_REGISTRY_ROOT
  pythonPath?: string;       // absolute path; resolved at initialize() if omitted
}
```

- [ ] **Step 2: Ensure the file compiles by running the server type-check**

```bash
npx --workspace=packages/server tsc --noEmit
```

Expected: no errors. If there are errors, fix them inline before committing.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/types.ts
git commit -m "registry: add public types"
```

---

### Task 3: Built-in schema definitions

**Files:**
- Create: `packages/server/src/modules/registry/schemas/builtin.ts`

No tests needed — this is a static data file consumed by `schema-registry.ts` which is tested in Task 4.

- [ ] **Step 1: Write the built-in schema catalogue**

`packages/server/src/modules/registry/schemas/builtin.ts`:

```typescript
import type { SchemaDef } from '../types.js';

// Built-in primitive and structured schemas available to every tool without
// registration. Kept in sync with python/runner.py's PICKLE_SCHEMAS set.
//
// Spec reference: design doc §6 and §11 — this slice ships 7 primitives plus
// 2 structured schemas so the pickle output path is exercised end-to-end.

export const BUILTIN_SCHEMAS: readonly SchemaDef[] = [
  {
    name: 'Integer',
    kind: 'primitive',
    pythonRepresentation: 'int',
    encoding: 'json_literal',
    description: 'Signed integer.',
    source: 'builtin',
  },
  {
    name: 'Float',
    kind: 'primitive',
    pythonRepresentation: 'float',
    encoding: 'json_literal',
    description: 'Double-precision floating point.',
    source: 'builtin',
  },
  {
    name: 'String',
    kind: 'primitive',
    pythonRepresentation: 'str',
    encoding: 'json_literal',
    description: 'UTF-8 string.',
    source: 'builtin',
  },
  {
    name: 'Boolean',
    kind: 'primitive',
    pythonRepresentation: 'bool',
    encoding: 'json_literal',
    description: 'True or false.',
    source: 'builtin',
  },
  {
    name: 'JsonObject',
    kind: 'primitive',
    pythonRepresentation: 'dict',
    encoding: 'json_literal',
    description: 'Arbitrary JSON-serializable dict.',
    source: 'builtin',
  },
  {
    name: 'JsonArray',
    kind: 'primitive',
    pythonRepresentation: 'list',
    encoding: 'json_literal',
    description: 'Arbitrary JSON-serializable list.',
    source: 'builtin',
  },
  {
    name: 'Null',
    kind: 'primitive',
    pythonRepresentation: 'None',
    encoding: 'json_literal',
    description: 'Used to mark optional outputs.',
    source: 'builtin',
  },
  {
    name: 'NumpyArray',
    kind: 'structured',
    pythonRepresentation: 'numpy.ndarray',
    encoding: 'pickle_b64',
    description: 'Multi-dimensional numeric array.',
    source: 'builtin',
  },
  {
    name: 'DataFrame',
    kind: 'structured',
    pythonRepresentation: 'pandas.DataFrame',
    encoding: 'pickle_b64',
    description: 'Generic pandas DataFrame.',
    source: 'builtin',
  },
];

/** Schemas whose values move across the stdio boundary as pickle+base64. */
export const PICKLE_SCHEMA_NAMES: readonly string[] = BUILTIN_SCHEMAS
  .filter((s) => s.encoding === 'pickle_b64')
  .map((s) => s.name);
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/modules/registry/schemas/builtin.ts
git commit -m "registry: define built-in primitive and structured schemas"
```

---

### Task 4: Schema registry with tests

**Files:**
- Create: `packages/server/src/modules/registry/schemas/schema-registry.ts`
- Create: `packages/server/src/modules/registry/schemas/__tests__/schema-registry.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/schemas/__tests__/schema-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '../schema-registry.js';
import { BUILTIN_SCHEMAS } from '../builtin.js';

describe('SchemaRegistry', () => {
  it('loads all built-in schemas at construction', () => {
    const reg = new SchemaRegistry();
    for (const s of BUILTIN_SCHEMAS) {
      expect(reg.get(s.name)).toEqual(s);
    }
  });

  it('returns null for unknown schemas', () => {
    const reg = new SchemaRegistry();
    expect(reg.get('NotAThing')).toBeNull();
  });

  it('has() mirrors get()', () => {
    const reg = new SchemaRegistry();
    expect(reg.has('Integer')).toBe(true);
    expect(reg.has('NotAThing')).toBe(false);
  });

  it('list() returns all built-ins', () => {
    const reg = new SchemaRegistry();
    const listed = reg.list();
    expect(listed).toHaveLength(BUILTIN_SCHEMAS.length);
    expect(new Set(listed.map((s) => s.name)))
      .toEqual(new Set(BUILTIN_SCHEMAS.map((s) => s.name)));
  });

  it('encodingOf() returns json_literal for primitives', () => {
    const reg = new SchemaRegistry();
    expect(reg.encodingOf('Integer')).toBe('json_literal');
    expect(reg.encodingOf('String')).toBe('json_literal');
  });

  it('encodingOf() returns pickle_b64 for structured schemas', () => {
    const reg = new SchemaRegistry();
    expect(reg.encodingOf('NumpyArray')).toBe('pickle_b64');
    expect(reg.encodingOf('DataFrame')).toBe('pickle_b64');
  });

  it('encodingOf() throws for unknown schemas', () => {
    const reg = new SchemaRegistry();
    expect(() => reg.encodingOf('Mystery')).toThrow(/unknown schema/i);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/schemas/__tests__/schema-registry.test.ts
```

Expected: FAIL — `Cannot find module '../schema-registry.js'`.

- [ ] **Step 3: Write the minimal implementation**

`packages/server/src/modules/registry/schemas/schema-registry.ts`:

```typescript
import type { SchemaDef, SchemaEncoding } from '../types.js';
import { BUILTIN_SCHEMAS } from './builtin.js';

export class SchemaRegistry {
  private readonly byName: Map<string, SchemaDef>;

  constructor() {
    this.byName = new Map();
    for (const s of BUILTIN_SCHEMAS) {
      this.byName.set(s.name, s);
    }
  }

  get(name: string): SchemaDef | null {
    return this.byName.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  list(): SchemaDef[] {
    return [...this.byName.values()];
  }

  encodingOf(name: string): SchemaEncoding {
    const s = this.byName.get(name);
    if (!s) {
      throw new Error(`unknown schema: ${name}`);
    }
    return s.encoding;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/schemas/__tests__/schema-registry.test.ts
```

Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/schemas/
git commit -m "registry: add schema registry with built-in lookups"
```

---

## Phase 2 — Manifest parser and validator

### Task 5: Manifest YAML parser with tests

**Files:**
- Create: `packages/server/src/modules/registry/manifest/parser.ts`
- Create: `packages/server/src/modules/registry/manifest/__tests__/parser.test.ts`

The parser is responsible for turning YAML bytes into a typed `ToolManifest` object. It performs *structural* checks only (required top-level fields present, correct types) — semantic validation (schema refs, port uniqueness) is in `validator.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/manifest/__tests__/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseToolManifest, ManifestParseError } from '../parser.js';

const MINIMAL_YAML = `
name: test.echo_int
version: 1
description: Echo an integer.

inputs:
  value:
    schema: Integer
    required: true
    description: the value to echo

outputs:
  echoed:
    schema: Integer
    description: same as input

implementation:
  language: python
  entry_point: tool.py:run
`;

describe('parseToolManifest', () => {
  it('parses a minimal manifest', () => {
    const m = parseToolManifest(MINIMAL_YAML);
    expect(m.name).toBe('test.echo_int');
    expect(m.version).toBe(1);
    expect(m.description).toBe('Echo an integer.');
    expect(m.inputs.value).toEqual({
      schema: 'Integer',
      required: true,
      description: 'the value to echo',
    });
    expect(m.outputs.echoed).toEqual({
      schema: 'Integer',
      description: 'same as input',
    });
    expect(m.implementation).toEqual({
      language: 'python',
      entryPoint: 'tool.py:run',
    });
  });

  it('parses optional top-level fields', () => {
    const yaml = `${MINIMAL_YAML}
category: testing
tags: [fixture, primitive]
metadata:
  author: seed
  stability: stable
  cost_class: fast
`;
    const m = parseToolManifest(yaml);
    expect(m.category).toBe('testing');
    expect(m.tags).toEqual(['fixture', 'primitive']);
    expect(m.metadata?.author).toBe('seed');
    expect(m.metadata?.stability).toBe('stable');
    expect(m.metadata?.costClass).toBe('fast');
  });

  it('parses tests block when present', () => {
    const yaml = `${MINIMAL_YAML}
tests:
  file: tests.py
  required: true
`;
    const m = parseToolManifest(yaml);
    expect(m.tests).toEqual({ file: 'tests.py', required: true });
  });

  it('parses implementation.requires', () => {
    const yaml = `
name: x.y
version: 1
description: d
inputs: {}
outputs: {}
implementation:
  language: python
  entry_point: tool.py:run
  requires:
    - numpy>=1.24
    - scipy
`;
    const m = parseToolManifest(yaml);
    expect(m.implementation.requires).toEqual(['numpy>=1.24', 'scipy']);
  });

  it('throws ManifestParseError on malformed YAML', () => {
    expect(() => parseToolManifest('name: [unclosed')).toThrow(ManifestParseError);
  });

  it('throws when name is missing', () => {
    expect(() => parseToolManifest('version: 1\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run'))
      .toThrow(/name/);
  });

  it('throws when version is missing or not an integer', () => {
    expect(() => parseToolManifest('name: x\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run'))
      .toThrow(/version/);
    expect(() => parseToolManifest('name: x\nversion: "abc"\ndescription: d\ninputs: {}\noutputs: {}\nimplementation:\n  language: python\n  entry_point: tool.py:run'))
      .toThrow(/version/);
  });

  it('throws when implementation.language is not python', () => {
    const yaml = `
name: x
version: 1
description: d
inputs: {}
outputs: {}
implementation:
  language: rust
  entry_point: tool.py:run
`;
    expect(() => parseToolManifest(yaml)).toThrow(/python/);
  });

  it('throws when a port is missing a schema', () => {
    const yaml = `
name: x
version: 1
description: d
inputs:
  broken:
    required: true
outputs: {}
implementation:
  language: python
  entry_point: tool.py:run
`;
    expect(() => parseToolManifest(yaml)).toThrow(/schema/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/manifest/__tests__/parser.test.ts
```

Expected: FAIL — `Cannot find module '../parser.js'`.

- [ ] **Step 3: Write the parser**

`packages/server/src/modules/registry/manifest/parser.ts`:

```typescript
import { parse as parseYaml } from 'yaml';
import type { ToolManifest, ToolPortSpec, Stability, CostClass } from '../types.js';

export class ManifestParseError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = 'ManifestParseError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, path: string): string {
  if (typeof v !== 'string') {
    throw new ManifestParseError(`${path} must be a string`, path);
  }
  return v;
}

function asOptionalString(v: unknown, path: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new ManifestParseError(`${path} must be a string`, path);
  }
  return v;
}

function asInteger(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new ManifestParseError(`${path} must be an integer`, path);
  }
  return v;
}

function asPortMap(v: unknown, path: string): Record<string, ToolPortSpec> {
  if (v === undefined || v === null) return {};
  if (!isRecord(v)) {
    throw new ManifestParseError(`${path} must be a mapping`, path);
  }
  const out: Record<string, ToolPortSpec> = {};
  for (const [key, raw] of Object.entries(v)) {
    const portPath = `${path}.${key}`;
    if (!isRecord(raw)) {
      throw new ManifestParseError(`${portPath} must be a mapping`, portPath);
    }
    const schema = raw.schema;
    if (typeof schema !== 'string') {
      throw new ManifestParseError(`${portPath}.schema is required and must be a string`, portPath);
    }
    const port: ToolPortSpec = { schema };
    if ('required' in raw) {
      if (typeof raw.required !== 'boolean') {
        throw new ManifestParseError(`${portPath}.required must be a boolean`, portPath);
      }
      port.required = raw.required;
    }
    if ('default' in raw) {
      port.default = raw.default;
    }
    if ('description' in raw) {
      port.description = asOptionalString(raw.description, `${portPath}.description`);
    }
    out[key] = port;
  }
  return out;
}

export function parseToolManifest(yamlText: string): ToolManifest {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    throw new ManifestParseError(`YAML parse error: ${(err as Error).message}`);
  }
  if (!isRecord(doc)) {
    throw new ManifestParseError('manifest must be a mapping at the top level');
  }

  const name = asString(doc.name, 'name');
  const version = asInteger(doc.version, 'version');
  const description = asString(doc.description, 'description');

  const implRaw = doc.implementation;
  if (!isRecord(implRaw)) {
    throw new ManifestParseError('implementation is required and must be a mapping', 'implementation');
  }
  const language = asString(implRaw.language, 'implementation.language');
  if (language !== 'python') {
    throw new ManifestParseError(`implementation.language must be "python" (got "${language}")`, 'implementation.language');
  }
  const entryPoint = asString(implRaw.entry_point, 'implementation.entry_point');
  let requires: string[] | undefined;
  if ('requires' in implRaw && implRaw.requires !== undefined) {
    if (!Array.isArray(implRaw.requires) || implRaw.requires.some((r) => typeof r !== 'string')) {
      throw new ManifestParseError('implementation.requires must be a list of strings', 'implementation.requires');
    }
    requires = implRaw.requires as string[];
  }

  const manifest: ToolManifest = {
    name,
    version,
    description,
    inputs: asPortMap(doc.inputs, 'inputs'),
    outputs: asPortMap(doc.outputs, 'outputs'),
    implementation: { language: 'python', entryPoint, ...(requires ? { requires } : {}) },
  };

  if ('category' in doc) {
    manifest.category = asOptionalString(doc.category, 'category');
  }
  if ('tags' in doc && doc.tags !== undefined) {
    if (!Array.isArray(doc.tags) || doc.tags.some((t) => typeof t !== 'string')) {
      throw new ManifestParseError('tags must be a list of strings', 'tags');
    }
    manifest.tags = doc.tags as string[];
  }
  if ('tests' in doc && doc.tests !== undefined) {
    if (!isRecord(doc.tests)) {
      throw new ManifestParseError('tests must be a mapping', 'tests');
    }
    const file = asString(doc.tests.file, 'tests.file');
    const required = doc.tests.required;
    if (typeof required !== 'boolean') {
      throw new ManifestParseError('tests.required must be a boolean', 'tests.required');
    }
    manifest.tests = { file, required };
  }
  if ('metadata' in doc && doc.metadata !== undefined) {
    if (!isRecord(doc.metadata)) {
      throw new ManifestParseError('metadata must be a mapping', 'metadata');
    }
    const md = doc.metadata;
    const meta: NonNullable<ToolManifest['metadata']> = {};
    if (md.author !== undefined) {
      meta.author = asString(md.author, 'metadata.author');
    }
    if (md.created_at !== undefined) {
      meta.createdAt = asString(md.created_at, 'metadata.created_at');
    }
    if (md.stability !== undefined) {
      const s = asString(md.stability, 'metadata.stability');
      if (s !== 'experimental' && s !== 'stable' && s !== 'deprecated') {
        throw new ManifestParseError(
          `metadata.stability must be one of experimental|stable|deprecated (got "${s}")`,
          'metadata.stability',
        );
      }
      meta.stability = s as Stability;
    }
    if (md.cost_class !== undefined) {
      const c = asString(md.cost_class, 'metadata.cost_class');
      if (c !== 'fast' && c !== 'medium' && c !== 'slow') {
        throw new ManifestParseError(
          `metadata.cost_class must be one of fast|medium|slow (got "${c}")`,
          'metadata.cost_class',
        );
      }
      meta.costClass = c as CostClass;
    }
    manifest.metadata = meta;
  }

  return manifest;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/manifest/__tests__/parser.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/manifest/parser.ts packages/server/src/modules/registry/manifest/__tests__/parser.test.ts
git commit -m "registry: add tool manifest YAML parser"
```

---

### Task 6: Manifest validator with tests

**Files:**
- Create: `packages/server/src/modules/registry/manifest/validator.ts`
- Create: `packages/server/src/modules/registry/manifest/__tests__/validator.test.ts`

The validator takes a parsed `ToolManifest` plus a `SchemaRegistry` and returns an array of `RegistrationError` objects. Empty array = valid. The validator does not throw — its errors are data the registration flow inspects and reports.

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/manifest/__tests__/validator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateToolManifest } from '../validator.js';
import { SchemaRegistry } from '../../schemas/schema-registry.js';
import type { ToolManifest } from '../../types.js';

function baseManifest(): ToolManifest {
  return {
    name: 'test.thing',
    version: 1,
    description: 'd',
    inputs: { a: { schema: 'Integer', required: true } },
    outputs: { r: { schema: 'Integer' } },
    implementation: { language: 'python', entryPoint: 'tool.py:run' },
  };
}

describe('validateToolManifest', () => {
  const schemas = new SchemaRegistry();

  it('accepts a valid manifest', () => {
    expect(validateToolManifest(baseManifest(), schemas)).toEqual([]);
  });

  it('rejects empty name', () => {
    const m = baseManifest();
    m.name = '';
    const errors = validateToolManifest(m, schemas);
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe('manifest_validation');
    expect(errors[0].message).toMatch(/name/);
  });

  it('rejects version < 1', () => {
    const m = baseManifest();
    m.version = 0;
    const errors = validateToolManifest(m, schemas);
    expect(errors[0].category).toBe('manifest_validation');
    expect(errors[0].message).toMatch(/version/);
  });

  it('rejects unknown input schema', () => {
    const m = baseManifest();
    m.inputs.a.schema = 'NotAType';
    const errors = validateToolManifest(m, schemas);
    expect(errors[0].category).toBe('schema_unknown');
    expect(errors[0].path).toBe('inputs.a.schema');
    expect(errors[0].message).toMatch(/NotAType/);
  });

  it('rejects unknown output schema', () => {
    const m = baseManifest();
    m.outputs.r.schema = 'Bogus';
    const errors = validateToolManifest(m, schemas);
    expect(errors[0].category).toBe('schema_unknown');
    expect(errors[0].path).toBe('outputs.r.schema');
  });

  it('rejects overlapping input and output port names', () => {
    const m = baseManifest();
    m.inputs.collision = { schema: 'Integer' };
    m.outputs.collision = { schema: 'Integer' };
    const errors = validateToolManifest(m, schemas);
    expect(errors.some((e) => /collision/.test(e.message))).toBe(true);
  });

  it('rejects a tool with no outputs', () => {
    const m = baseManifest();
    m.outputs = {};
    const errors = validateToolManifest(m, schemas);
    expect(errors[0].message).toMatch(/at least one output/);
  });

  it('rejects an entry_point that is not "file.py:function"', () => {
    const m = baseManifest();
    m.implementation.entryPoint = 'no_colon_here';
    const errors = validateToolManifest(m, schemas);
    expect(errors[0].message).toMatch(/entry_point/);
  });

  it('accumulates multiple errors in one pass', () => {
    const m = baseManifest();
    m.name = '';
    m.version = -1;
    m.inputs.a.schema = 'Bogus';
    const errors = validateToolManifest(m, schemas);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/manifest/__tests__/validator.test.ts
```

Expected: FAIL — `Cannot find module '../validator.js'`.

- [ ] **Step 3: Write the validator**

`packages/server/src/modules/registry/manifest/validator.ts`:

```typescript
import type { RegistrationError, ToolManifest } from '../types.js';
import type { SchemaRegistry } from '../schemas/schema-registry.js';

const NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const ENTRY_POINT_REGEX = /^[^:]+\.py:[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateToolManifest(
  manifest: ToolManifest,
  schemas: SchemaRegistry,
): RegistrationError[] {
  const errors: RegistrationError[] = [];

  if (!manifest.name || manifest.name.trim() === '') {
    errors.push({ category: 'manifest_validation', message: 'name must be non-empty', path: 'name' });
  } else if (!NAME_REGEX.test(manifest.name)) {
    errors.push({
      category: 'manifest_validation',
      message: `name "${manifest.name}" must match ${NAME_REGEX}`,
      path: 'name',
    });
  }

  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    errors.push({
      category: 'manifest_validation',
      message: `version must be a positive integer (got ${manifest.version})`,
      path: 'version',
    });
  }

  if (!manifest.description || manifest.description.trim() === '') {
    errors.push({ category: 'manifest_validation', message: 'description must be non-empty', path: 'description' });
  }

  if (Object.keys(manifest.outputs).length === 0) {
    errors.push({
      category: 'manifest_validation',
      message: 'a tool must declare at least one output port',
      path: 'outputs',
    });
  }

  for (const [portName, port] of Object.entries(manifest.inputs)) {
    if (!schemas.has(port.schema)) {
      errors.push({
        category: 'schema_unknown',
        message: `input port "${portName}" references unknown schema "${port.schema}"`,
        path: `inputs.${portName}.schema`,
      });
    }
  }
  for (const [portName, port] of Object.entries(manifest.outputs)) {
    if (!schemas.has(port.schema)) {
      errors.push({
        category: 'schema_unknown',
        message: `output port "${portName}" references unknown schema "${port.schema}"`,
        path: `outputs.${portName}.schema`,
      });
    }
  }

  for (const inputName of Object.keys(manifest.inputs)) {
    if (manifest.outputs[inputName] !== undefined) {
      errors.push({
        category: 'manifest_validation',
        message: `port name "${inputName}" is used for both input and output`,
        path: `outputs.${inputName}`,
      });
    }
  }

  if (!ENTRY_POINT_REGEX.test(manifest.implementation.entryPoint)) {
    errors.push({
      category: 'manifest_validation',
      message: `implementation.entry_point must match "<file>.py:<function>" (got "${manifest.implementation.entryPoint}")`,
      path: 'implementation.entry_point',
    });
  }

  return errors;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/manifest/__tests__/validator.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/manifest/validator.ts packages/server/src/modules/registry/manifest/__tests__/validator.test.ts
git commit -m "registry: add manifest semantic validator"
```

---

## Phase 3 — Storage layer: filesystem + SQLite

### Task 7: Filesystem paths and layout

**Files:**
- Create: `packages/server/src/modules/registry/storage/filesystem.ts`
- Create: `packages/server/src/modules/registry/storage/__tests__/filesystem.test.ts`

This task establishes the directory layout helpers — path resolution and the `ensureLayout()` function that creates the top-level directories. Staging, atomic move, and hashing come in Tasks 8 and 9.

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/storage/__tests__/filesystem.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryLayout } from '../filesystem.js';

describe('RegistryLayout', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-reg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exposes the configured root', () => {
    const layout = new RegistryLayout(tmpRoot);
    expect(layout.rootDir).toBe(tmpRoot);
  });

  it('derives child directory paths', () => {
    const layout = new RegistryLayout(tmpRoot);
    expect(layout.toolsDir).toBe(path.join(tmpRoot, 'tools'));
    expect(layout.schemasDir).toBe(path.join(tmpRoot, 'schemas'));
    expect(layout.stagingDir).toBe(path.join(tmpRoot, 'staging'));
    expect(layout.logsDir).toBe(path.join(tmpRoot, 'logs'));
    expect(layout.dbPath).toBe(path.join(tmpRoot, 'registry.db'));
    expect(layout.runnerPath).toBe(path.join(tmpRoot, 'runner.py'));
  });

  it('toolVersionDir joins name and version', () => {
    const layout = new RegistryLayout(tmpRoot);
    expect(layout.toolVersionDir('sklearn.pca', 2))
      .toBe(path.join(tmpRoot, 'tools', 'sklearn.pca', 'v2'));
  });

  it('ensureLayout creates all required directories', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    expect(fs.existsSync(layout.toolsDir)).toBe(true);
    expect(fs.existsSync(layout.schemasDir)).toBe(true);
    expect(fs.existsSync(layout.stagingDir)).toBe(true);
    expect(fs.existsSync(layout.logsDir)).toBe(true);
  });

  it('ensureLayout is idempotent', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    layout.ensureLayout();
    expect(fs.existsSync(layout.toolsDir)).toBe(true);
  });

  it('defaults to ~/.plurics/registry when no root is given', () => {
    const layout = new RegistryLayout();
    expect(layout.rootDir).toBe(path.join(os.homedir(), '.plurics', 'registry'));
  });

  it('honours PLURICS_REGISTRY_ROOT env var', () => {
    const prior = process.env.PLURICS_REGISTRY_ROOT;
    process.env.PLURICS_REGISTRY_ROOT = tmpRoot;
    try {
      const layout = new RegistryLayout();
      expect(layout.rootDir).toBe(tmpRoot);
    } finally {
      if (prior === undefined) delete process.env.PLURICS_REGISTRY_ROOT;
      else process.env.PLURICS_REGISTRY_ROOT = prior;
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/storage/__tests__/filesystem.test.ts
```

Expected: FAIL — `Cannot find module '../filesystem.js'`.

- [ ] **Step 3: Write the implementation**

`packages/server/src/modules/registry/storage/filesystem.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function resolveDefaultRoot(): string {
  const envOverride = process.env.PLURICS_REGISTRY_ROOT;
  if (envOverride && envOverride.trim() !== '') return envOverride;
  return path.join(os.homedir(), '.plurics', 'registry');
}

export class RegistryLayout {
  readonly rootDir: string;
  readonly toolsDir: string;
  readonly schemasDir: string;
  readonly stagingDir: string;
  readonly logsDir: string;
  readonly dbPath: string;
  readonly runnerPath: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? resolveDefaultRoot();
    this.toolsDir = path.join(this.rootDir, 'tools');
    this.schemasDir = path.join(this.rootDir, 'schemas');
    this.stagingDir = path.join(this.rootDir, 'staging');
    this.logsDir = path.join(this.rootDir, 'logs');
    this.dbPath = path.join(this.rootDir, 'registry.db');
    this.runnerPath = path.join(this.rootDir, 'runner.py');
  }

  toolVersionDir(name: string, version: number): string {
    return path.join(this.toolsDir, name, `v${version}`);
  }

  ensureLayout(): void {
    for (const d of [this.rootDir, this.toolsDir, this.schemasDir, this.stagingDir, this.logsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/storage/__tests__/filesystem.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/storage/filesystem.ts packages/server/src/modules/registry/storage/__tests__/filesystem.test.ts
git commit -m "registry: add filesystem layout helpers"
```

---

### Task 8: Staging, atomic commit, and tool hash

**Files:**
- Modify: `packages/server/src/modules/registry/storage/filesystem.ts`
- Modify: `packages/server/src/modules/registry/storage/__tests__/filesystem.test.ts`

Extends `RegistryLayout` with the staging workflow and directory hashing. The hash is a SHA-256 of the sorted `(relative_path, content_bytes)` pairs — deterministic across runs and operating systems.

- [ ] **Step 1: Append new failing tests**

Append to `packages/server/src/modules/registry/storage/__tests__/filesystem.test.ts` (inside the same file, after the existing `describe` block — add a new top-level `describe`):

```typescript
import { hashToolDirectory } from '../filesystem.js';

describe('RegistryLayout — staging', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-reg-stage-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('createStagingDir returns an empty, existing directory', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const staged = layout.createStagingDir();
    expect(fs.existsSync(staged)).toBe(true);
    expect(fs.readdirSync(staged)).toEqual([]);
    expect(staged.startsWith(layout.stagingDir)).toBe(true);
  });

  it('createStagingDir is unique per call', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const a = layout.createStagingDir();
    const b = layout.createStagingDir();
    expect(a).not.toBe(b);
  });

  it('commitStaging moves staged contents to the version directory', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const staged = layout.createStagingDir();
    fs.writeFileSync(path.join(staged, 'tool.yaml'), 'name: x');
    fs.writeFileSync(path.join(staged, 'tool.py'), 'def run(): return {}');

    const target = layout.toolVersionDir('x.y', 1);
    layout.commitStaging(staged, target);

    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(path.join(target, 'tool.yaml'), 'utf8')).toBe('name: x');
  });

  it('commitStaging refuses to overwrite an existing target', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const staged = layout.createStagingDir();
    fs.writeFileSync(path.join(staged, 'tool.yaml'), 'name: x');
    const target = layout.toolVersionDir('x.y', 1);
    fs.mkdirSync(target, { recursive: true });
    expect(() => layout.commitStaging(staged, target)).toThrow(/exists/);
  });

  it('cleanupStaging removes a directory silently', () => {
    const layout = new RegistryLayout(tmpRoot);
    layout.ensureLayout();
    const staged = layout.createStagingDir();
    fs.writeFileSync(path.join(staged, 'f.txt'), 'hi');
    layout.cleanupStaging(staged);
    expect(fs.existsSync(staged)).toBe(false);
    layout.cleanupStaging(staged); // no throw on missing
  });
});

describe('hashToolDirectory', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-hash-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('produces a deterministic SHA-256 hex string', () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(tmpRoot, 'b.txt'), 'world');
    const h1 = hashToolDirectory(tmpRoot);
    const h2 = hashToolDirectory(tmpRoot);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when file contents change', () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'hello');
    const h1 = hashToolDirectory(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'HELLO');
    const h2 = hashToolDirectory(tmpRoot);
    expect(h1).not.toBe(h2);
  });

  it('changes when a file is added', () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'hello');
    const h1 = hashToolDirectory(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, 'b.txt'), 'new');
    const h2 = hashToolDirectory(tmpRoot);
    expect(h1).not.toBe(h2);
  });

  it('walks subdirectories deterministically', () => {
    fs.mkdirSync(path.join(tmpRoot, 'sub'));
    fs.writeFileSync(path.join(tmpRoot, 'sub', 'x.txt'), 'x');
    fs.writeFileSync(path.join(tmpRoot, 'top.txt'), 't');
    expect(hashToolDirectory(tmpRoot)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd packages/server && npx vitest run src/modules/registry/storage/__tests__/filesystem.test.ts
```

Expected: FAIL — `hashToolDirectory is not exported`, missing `createStagingDir`, etc.

- [ ] **Step 3: Extend `filesystem.ts`**

Append to `packages/server/src/modules/registry/storage/filesystem.ts`:

```typescript
// ---------- Additions from Task 8 ----------

import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

// Extend the class via declaration merging by adding methods directly below.
// (In TypeScript the methods above and these share the same class body at
//  source level — merging is not needed; instead, incorporate the methods
//  into the original class body as shown in the consolidated file.)
```

> **Consolidation note:** instead of append-only diffs, replace the whole `filesystem.ts` file with the consolidated version below. This avoids declaration-merging gymnastics.

`packages/server/src/modules/registry/storage/filesystem.ts` (full replacement):

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

function resolveDefaultRoot(): string {
  const envOverride = process.env.PLURICS_REGISTRY_ROOT;
  if (envOverride && envOverride.trim() !== '') return envOverride;
  return path.join(os.homedir(), '.plurics', 'registry');
}

export class RegistryLayout {
  readonly rootDir: string;
  readonly toolsDir: string;
  readonly schemasDir: string;
  readonly stagingDir: string;
  readonly logsDir: string;
  readonly dbPath: string;
  readonly runnerPath: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? resolveDefaultRoot();
    this.toolsDir = path.join(this.rootDir, 'tools');
    this.schemasDir = path.join(this.rootDir, 'schemas');
    this.stagingDir = path.join(this.rootDir, 'staging');
    this.logsDir = path.join(this.rootDir, 'logs');
    this.dbPath = path.join(this.rootDir, 'registry.db');
    this.runnerPath = path.join(this.rootDir, 'runner.py');
  }

  toolVersionDir(name: string, version: number): string {
    return path.join(this.toolsDir, name, `v${version}`);
  }

  ensureLayout(): void {
    for (const d of [this.rootDir, this.toolsDir, this.schemasDir, this.stagingDir, this.logsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  createStagingDir(): string {
    fs.mkdirSync(this.stagingDir, { recursive: true });
    const dir = path.join(this.stagingDir, randomUUID());
    fs.mkdirSync(dir);
    return dir;
  }

  commitStaging(stagedDir: string, targetDir: string): void {
    if (fs.existsSync(targetDir)) {
      throw new Error(`target directory already exists: ${targetDir}`);
    }
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(stagedDir, targetDir);
  }

  cleanupStaging(stagedDir: string): void {
    fs.rmSync(stagedDir, { recursive: true, force: true });
  }
}

/**
 * Compute SHA-256 over (relativePath, contentBytes) pairs, sorted by path
 * (POSIX separators for cross-OS stability). Directories are walked
 * recursively; symlinks are followed as regular files.
 */
export function hashToolDirectory(dir: string): string {
  const entries: Array<{ rel: string; content: Buffer }> = [];

  const walk = (current: string, prefix: string): void => {
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const child = path.join(current, item.name);
      const rel = prefix === '' ? item.name : `${prefix}/${item.name}`;
      if (item.isDirectory()) {
        walk(child, rel);
      } else if (item.isFile()) {
        entries.push({ rel, content: fs.readFileSync(child) });
      }
    }
  };

  walk(dir, '');
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const hash = createHash('sha256');
  for (const { rel, content } of entries) {
    hash.update(rel);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}
```

Also remove the transitional "Additions from Task 8" placeholder block if you wrote it — the consolidated file above is complete.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd packages/server && npx vitest run src/modules/registry/storage/__tests__/filesystem.test.ts
```

Expected: PASS (all ~12 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/storage/filesystem.ts packages/server/src/modules/registry/storage/__tests__/filesystem.test.ts
git commit -m "registry: add staging, atomic commit, and directory hashing"
```

---

### Task 9: SQLite database schema and migrations

**Files:**
- Create: `packages/server/src/modules/registry/storage/db.ts`
- Create: `packages/server/src/modules/registry/storage/__tests__/db.test.ts`

Opens an SQLite database at a given path, applies schema migrations, and exposes a thin typed wrapper. Only the schema bootstrap is implemented in this task — CRUD methods come in Task 10.

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/storage/__tests__/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryDb } from '../db.js';

describe('RegistryDb — schema', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: RegistryDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-db-'));
    dbPath = path.join(tmpDir, 'r.db');
    db = new RegistryDb(dbPath);
    db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the database file', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('writes schema_version = 1 in registry_meta', () => {
    expect(db.schemaVersion()).toBe(1);
  });

  it('creates all expected tables', () => {
    const tables = db.listTables();
    expect(tables).toEqual(
      expect.arrayContaining([
        'tools',
        'tool_ports',
        'schemas',
        'registration_log',
        'registry_meta',
      ]),
    );
  });

  it('initialize is idempotent on an already-initialized db', () => {
    db.close();
    const db2 = new RegistryDb(dbPath);
    db2.initialize();
    expect(db2.schemaVersion()).toBe(1);
    db2.close();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/storage/__tests__/db.test.ts
```

Expected: FAIL — `Cannot find module '../db.js'`.

- [ ] **Step 3: Write the database wrapper**

`packages/server/src/modules/registry/storage/db.ts`:

```typescript
import Database from 'better-sqlite3';
import type { Database as DbType } from 'better-sqlite3';

const EXPECTED_SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS registry_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
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

CREATE INDEX IF NOT EXISTS idx_tools_name     ON tools(name);
CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category);
CREATE INDEX IF NOT EXISTS idx_tools_status   ON tools(status);

CREATE TABLE IF NOT EXISTS tool_ports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id      INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL,
  port_name    TEXT NOT NULL,
  schema_name  TEXT NOT NULL,
  required     INTEGER,
  default_json TEXT,
  description  TEXT,
  position     INTEGER NOT NULL,
  UNIQUE(tool_id, direction, port_name)
);

CREATE INDEX IF NOT EXISTS idx_ports_schema ON tool_ports(schema_name, direction);

CREATE TABLE IF NOT EXISTS schemas (
  name                  TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,
  python_representation TEXT,
  encoding              TEXT NOT NULL,
  description           TEXT,
  source                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  version        INTEGER,
  caller         TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  error_message  TEXT,
  tests_run      INTEGER,
  tests_passed   INTEGER,
  duration_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_registration_log_timestamp ON registration_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_registration_log_tool      ON registration_log(tool_name);
`;

export class RegistryDb {
  private db: DbType | null = null;

  constructor(private readonly dbPath: string) {}

  initialize(): void {
    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_V1);

    const row = this.db
      .prepare('SELECT value FROM registry_meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;

    if (row === undefined) {
      this.db
        .prepare('INSERT INTO registry_meta (key, value) VALUES (?, ?)')
        .run('schema_version', String(EXPECTED_SCHEMA_VERSION));
    } else if (Number(row.value) !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(
        `registry.db schema_version ${row.value} is not supported (expected ${EXPECTED_SCHEMA_VERSION})`,
      );
    }
  }

  schemaVersion(): number {
    const row = this.raw()
      .prepare('SELECT value FROM registry_meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    if (!row) throw new Error('schema_version row missing');
    return Number(row.value);
  }

  listTables(): string[] {
    return (this.raw()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>).map((r) => r.name);
  }

  raw(): DbType {
    if (!this.db) throw new Error('RegistryDb not initialized');
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/storage/__tests__/db.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/storage/db.ts packages/server/src/modules/registry/storage/__tests__/db.test.ts
git commit -m "registry: add SQLite schema bootstrap"
```

---

### Task 10: Tool and port CRUD with transactions

**Files:**
- Modify: `packages/server/src/modules/registry/storage/db.ts`
- Modify: `packages/server/src/modules/registry/storage/__tests__/db.test.ts`

Adds `insertTool`, `getTool`, `getAllVersions`, `listTools`, `findProducers`, `findConsumers`, `insertSchema`, `listSchemas`, `appendRegistrationLog`, and a `withTransaction` helper. The insertion of a tool and its ports happens in a single SQL transaction so partial failure leaves the DB unchanged.

- [ ] **Step 1: Append new failing tests**

Append a new `describe` block to `packages/server/src/modules/registry/storage/__tests__/db.test.ts`:

```typescript
import type { ToolRecord, ResolvedPort, SchemaDef } from '../../types.js';

function sampleTool(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return {
    name: 'test.thing',
    version: 1,
    description: 'd',
    category: 'testing',
    tags: ['fixture'],
    inputs: [
      { name: 'a', direction: 'input', schemaName: 'Integer', required: true, default: undefined, description: null, position: 0 },
    ],
    outputs: [
      { name: 'r', direction: 'output', schemaName: 'Integer', required: false, default: undefined, description: null, position: 0 },
    ],
    entryPoint: 'tool.py:run',
    language: 'python',
    requires: [],
    stability: 'stable',
    costClass: 'fast',
    author: 'test',
    createdAt: '2026-04-11T00:00:00Z',
    toolHash: 'deadbeef',
    status: 'active',
    directory: '/tmp/test.thing/v1',
    ...overrides,
  };
}

describe('RegistryDb — tool CRUD', () => {
  let tmpDir: string;
  let db: RegistryDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-db-crud-'));
    db = new RegistryDb(path.join(tmpDir, 'r.db'));
    db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('insertTool persists a tool and its ports', () => {
    db.insertTool(sampleTool(), 0, 0, true);
    const got = db.getTool('test.thing');
    expect(got).not.toBeNull();
    expect(got!.name).toBe('test.thing');
    expect(got!.inputs).toHaveLength(1);
    expect(got!.inputs[0].schemaName).toBe('Integer');
    expect(got!.outputs).toHaveLength(1);
  });

  it('getTool returns null when missing', () => {
    expect(db.getTool('nope')).toBeNull();
  });

  it('getTool returns the latest active version when version omitted', () => {
    db.insertTool(sampleTool({ version: 1 }), 0, 0, false);
    db.insertTool(sampleTool({ version: 2, toolHash: 'feedbeef' }), 0, 0, false);
    expect(db.getTool('test.thing')!.version).toBe(2);
  });

  it('getTool respects explicit version', () => {
    db.insertTool(sampleTool({ version: 1 }), 0, 0, false);
    db.insertTool(sampleTool({ version: 2, toolHash: 'feedbeef' }), 0, 0, false);
    expect(db.getTool('test.thing', 1)!.version).toBe(1);
  });

  it('insertTool rejects duplicate (name, version)', () => {
    db.insertTool(sampleTool(), 0, 0, false);
    expect(() => db.insertTool(sampleTool(), 0, 0, false)).toThrow();
  });

  it('listTools returns active tools by default', () => {
    db.insertTool(sampleTool({ name: 'a' }), 0, 0, false);
    db.insertTool(sampleTool({ name: 'b' }), 0, 0, false);
    expect(db.listTools().map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('listTools filters by category', () => {
    db.insertTool(sampleTool({ name: 'a', category: 'x' }), 0, 0, false);
    db.insertTool(sampleTool({ name: 'b', category: 'y' }), 0, 0, false);
    expect(db.listTools({ category: 'x' }).map((t) => t.name)).toEqual(['a']);
  });

  it('findProducers returns tools with matching output schema', () => {
    const t = sampleTool({
      name: 'p',
      outputs: [{ name: 'arr', direction: 'output', schemaName: 'NumpyArray', required: false, default: undefined, description: null, position: 0 }],
    });
    db.insertTool(t, 0, 0, false);
    db.insertTool(sampleTool({ name: 'q' }), 0, 0, false);
    expect(db.findProducers('NumpyArray').map((r) => r.name)).toEqual(['p']);
  });

  it('findConsumers returns tools with matching input schema', () => {
    const t = sampleTool({
      name: 'c',
      inputs: [{ name: 'df', direction: 'input', schemaName: 'DataFrame', required: true, default: undefined, description: null, position: 0 }],
    });
    db.insertTool(t, 0, 0, false);
    expect(db.findConsumers('DataFrame').map((r) => r.name)).toEqual(['c']);
  });

  it('insertSchema + listSchemas round-trip', () => {
    const s: SchemaDef = { name: 'Integer', kind: 'primitive', pythonRepresentation: 'int', encoding: 'json_literal', description: null, source: 'builtin' };
    db.insertSchema(s);
    expect(db.listSchemas()).toEqual([s]);
  });

  it('appendRegistrationLog writes an auditable row', () => {
    db.appendRegistrationLog({
      timestamp: '2026-04-11T00:00:00Z',
      toolName: 'x',
      version: 1,
      caller: 'human',
      outcome: 'success',
      errorMessage: null,
      testsRun: 0,
      testsPassed: 0,
      durationMs: 10,
    });
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM registration_log').get()).toEqual({ n: 1 });
  });

  it('withTransaction rolls back on error', () => {
    expect(() => {
      db.withTransaction(() => {
        db.insertTool(sampleTool({ name: 'rollback' }), 0, 0, false);
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(db.getTool('rollback')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd packages/server && npx vitest run src/modules/registry/storage/__tests__/db.test.ts
```

Expected: FAIL — methods `insertTool`, `getTool`, etc. do not exist.

- [ ] **Step 3: Extend `db.ts` with CRUD methods**

Replace the contents of `packages/server/src/modules/registry/storage/db.ts` with the consolidated version below (previous Task 9 content plus new methods):

```typescript
import Database from 'better-sqlite3';
import type { Database as DbType } from 'better-sqlite3';
import type {
  ToolRecord,
  ResolvedPort,
  SchemaDef,
  ListFilters,
  ToolStatus,
  Stability,
  CostClass,
} from '../types.js';

const EXPECTED_SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS registry_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
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

CREATE INDEX IF NOT EXISTS idx_tools_name     ON tools(name);
CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category);
CREATE INDEX IF NOT EXISTS idx_tools_status   ON tools(status);

CREATE TABLE IF NOT EXISTS tool_ports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id      INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL,
  port_name    TEXT NOT NULL,
  schema_name  TEXT NOT NULL,
  required     INTEGER,
  default_json TEXT,
  description  TEXT,
  position     INTEGER NOT NULL,
  UNIQUE(tool_id, direction, port_name)
);

CREATE INDEX IF NOT EXISTS idx_ports_schema ON tool_ports(schema_name, direction);

CREATE TABLE IF NOT EXISTS schemas (
  name                  TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,
  python_representation TEXT,
  encoding              TEXT NOT NULL,
  description           TEXT,
  source                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  version        INTEGER,
  caller         TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  error_message  TEXT,
  tests_run      INTEGER,
  tests_passed   INTEGER,
  duration_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_registration_log_timestamp ON registration_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_registration_log_tool      ON registration_log(tool_name);
`;

export interface RegistrationLogRow {
  timestamp: string;
  toolName: string;
  version: number | null;
  caller: 'seed' | 'human' | 'agent';
  outcome: 'success' | 'failure';
  errorMessage: string | null;
  testsRun: number | null;
  testsPassed: number | null;
  durationMs: number | null;
}

interface ToolRow {
  id: number;
  name: string;
  version: number;
  description: string | null;
  category: string | null;
  tags_json: string | null;
  entry_point: string;
  language: string;
  requires_json: string | null;
  stability: string | null;
  cost_class: string | null;
  author: string | null;
  created_at: string;
  tool_hash: string;
  tests_required: number;
  tests_passed: number | null;
  tests_run: number | null;
  status: string;
}

interface PortRow {
  port_name: string;
  direction: string;
  schema_name: string;
  required: number | null;
  default_json: string | null;
  description: string | null;
  position: number;
}

export class RegistryDb {
  private db: DbType | null = null;

  constructor(private readonly dbPath: string) {}

  initialize(): void {
    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_V1);
    const row = this.db
      .prepare('SELECT value FROM registry_meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    if (row === undefined) {
      this.db
        .prepare('INSERT INTO registry_meta (key, value) VALUES (?, ?)')
        .run('schema_version', String(EXPECTED_SCHEMA_VERSION));
    } else if (Number(row.value) !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(
        `registry.db schema_version ${row.value} is not supported (expected ${EXPECTED_SCHEMA_VERSION})`,
      );
    }
  }

  schemaVersion(): number {
    const row = this.raw()
      .prepare('SELECT value FROM registry_meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    if (!row) throw new Error('schema_version row missing');
    return Number(row.value);
  }

  listTables(): string[] {
    return (this.raw()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>).map((r) => r.name);
  }

  raw(): DbType {
    if (!this.db) throw new Error('RegistryDb not initialized');
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  withTransaction<T>(fn: () => T): T {
    const db = this.raw();
    const wrapped = db.transaction(fn);
    return wrapped();
  }

  // ---------- Tools ----------

  insertTool(record: ToolRecord, testsRun: number, testsPassed: number, testsRequired: boolean): void {
    const db = this.raw();
    const insertToolStmt = db.prepare(`
      INSERT INTO tools (
        name, version, description, category, tags_json,
        entry_point, language, requires_json, stability, cost_class,
        author, created_at, tool_hash, tests_required, tests_passed, tests_run, status
      ) VALUES (
        @name, @version, @description, @category, @tags_json,
        @entry_point, @language, @requires_json, @stability, @cost_class,
        @author, @created_at, @tool_hash, @tests_required, @tests_passed, @tests_run, @status
      )
    `);
    const insertPortStmt = db.prepare(`
      INSERT INTO tool_ports (
        tool_id, direction, port_name, schema_name, required, default_json, description, position
      ) VALUES (
        @tool_id, @direction, @port_name, @schema_name, @required, @default_json, @description, @position
      )
    `);

    const toolInfo = insertToolStmt.run({
      name: record.name,
      version: record.version,
      description: record.description,
      category: record.category,
      tags_json: JSON.stringify(record.tags),
      entry_point: record.entryPoint,
      language: record.language,
      requires_json: JSON.stringify(record.requires),
      stability: record.stability,
      cost_class: record.costClass,
      author: record.author,
      created_at: record.createdAt,
      tool_hash: record.toolHash,
      tests_required: testsRequired ? 1 : 0,
      tests_passed: testsPassed,
      tests_run: testsRun,
      status: record.status,
    });
    const toolId = Number(toolInfo.lastInsertRowid);

    for (const p of record.inputs) {
      insertPortStmt.run({
        tool_id: toolId,
        direction: 'input',
        port_name: p.name,
        schema_name: p.schemaName,
        required: p.required ? 1 : 0,
        default_json: p.default === undefined ? null : JSON.stringify(p.default),
        description: p.description,
        position: p.position,
      });
    }
    for (const p of record.outputs) {
      insertPortStmt.run({
        tool_id: toolId,
        direction: 'output',
        port_name: p.name,
        schema_name: p.schemaName,
        required: null,
        default_json: null,
        description: p.description,
        position: p.position,
      });
    }
  }

  getTool(name: string, version?: number): ToolRecord | null {
    const db = this.raw();
    let row: ToolRow | undefined;
    if (version === undefined) {
      row = db
        .prepare("SELECT * FROM tools WHERE name = ? AND status = 'active' ORDER BY version DESC LIMIT 1")
        .get(name) as ToolRow | undefined;
    } else {
      row = db.prepare('SELECT * FROM tools WHERE name = ? AND version = ?').get(name, version) as ToolRow | undefined;
    }
    if (!row) return null;
    return this.hydrateTool(row);
  }

  getAllVersions(name: string): ToolRecord[] {
    const db = this.raw();
    const rows = db
      .prepare('SELECT * FROM tools WHERE name = ? ORDER BY version DESC')
      .all(name) as ToolRow[];
    return rows.map((r) => this.hydrateTool(r));
  }

  listTools(filters: ListFilters = {}): ToolRecord[] {
    const db = this.raw();
    const statusIn = filters.statusIn ?? ['active'];
    const placeholders = statusIn.map(() => '?').join(',');
    const params: unknown[] = [...statusIn];
    let sql = `SELECT * FROM tools WHERE status IN (${placeholders})`;
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.stability) {
      sql += ' AND stability = ?';
      params.push(filters.stability);
    }
    sql += ' ORDER BY name, version DESC';
    const rows = db.prepare(sql).all(...params) as ToolRow[];
    const hydrated = rows.map((r) => this.hydrateTool(r));
    if (filters.tags && filters.tags.length > 0) {
      const required = new Set(filters.tags);
      return hydrated.filter((t) => {
        const have = new Set(t.tags);
        for (const tag of required) if (!have.has(tag)) return false;
        return true;
      });
    }
    return hydrated;
  }

  findProducers(schemaName: string): ToolRecord[] {
    return this.findByPortSchema(schemaName, 'output');
  }

  findConsumers(schemaName: string): ToolRecord[] {
    return this.findByPortSchema(schemaName, 'input');
  }

  private findByPortSchema(schemaName: string, direction: 'input' | 'output'): ToolRecord[] {
    const db = this.raw();
    const rows = db
      .prepare(
        `SELECT DISTINCT tools.* FROM tools
           JOIN tool_ports ON tool_ports.tool_id = tools.id
          WHERE tool_ports.schema_name = ? AND tool_ports.direction = ? AND tools.status = 'active'
          ORDER BY tools.name, tools.version DESC`,
      )
      .all(schemaName, direction) as ToolRow[];
    return rows.map((r) => this.hydrateTool(r));
  }

  private hydrateTool(row: ToolRow): ToolRecord {
    const db = this.raw();
    const ports = db
      .prepare(
        'SELECT port_name, direction, schema_name, required, default_json, description, position FROM tool_ports WHERE tool_id = ? ORDER BY direction, position',
      )
      .all(row.id) as PortRow[];
    const inputs: ResolvedPort[] = [];
    const outputs: ResolvedPort[] = [];
    for (const p of ports) {
      const resolved: ResolvedPort = {
        name: p.port_name,
        direction: p.direction as 'input' | 'output',
        schemaName: p.schema_name,
        required: p.required === 1,
        default: p.default_json === null ? undefined : JSON.parse(p.default_json),
        description: p.description,
        position: p.position,
      };
      if (p.direction === 'input') inputs.push(resolved);
      else outputs.push(resolved);
    }
    return {
      name: row.name,
      version: row.version,
      description: row.description ?? '',
      category: row.category,
      tags: row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [],
      inputs,
      outputs,
      entryPoint: row.entry_point,
      language: 'python',
      requires: row.requires_json ? (JSON.parse(row.requires_json) as string[]) : [],
      stability: row.stability as Stability | null,
      costClass: row.cost_class as CostClass | null,
      author: row.author,
      createdAt: row.created_at,
      toolHash: row.tool_hash,
      status: row.status as ToolStatus,
      directory: '', // filled in by the client layer which knows the layout
    };
  }

  // ---------- Schemas ----------

  insertSchema(schema: SchemaDef): void {
    this.raw()
      .prepare(
        `INSERT OR REPLACE INTO schemas (name, kind, python_representation, encoding, description, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        schema.name,
        schema.kind,
        schema.pythonRepresentation,
        schema.encoding,
        schema.description,
        schema.source,
      );
  }

  listSchemas(): SchemaDef[] {
    const rows = this.raw()
      .prepare('SELECT * FROM schemas ORDER BY name')
      .all() as Array<{
        name: string;
        kind: string;
        python_representation: string | null;
        encoding: string;
        description: string | null;
        source: string;
      }>;
    return rows.map((r) => ({
      name: r.name,
      kind: r.kind as 'primitive' | 'structured',
      pythonRepresentation: r.python_representation,
      encoding: r.encoding as 'json_literal' | 'pickle_b64',
      description: r.description,
      source: r.source as 'builtin' | 'user',
    }));
  }

  // ---------- Registration log ----------

  appendRegistrationLog(row: RegistrationLogRow): void {
    this.raw()
      .prepare(
        `INSERT INTO registration_log
         (timestamp, tool_name, version, caller, outcome, error_message, tests_run, tests_passed, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.timestamp,
        row.toolName,
        row.version,
        row.caller,
        row.outcome,
        row.errorMessage,
        row.testsRun,
        row.testsPassed,
        row.durationMs,
      );
  }
}
```

- [ ] **Step 4: Run all db tests and confirm they pass**

```bash
cd packages/server && npx vitest run src/modules/registry/storage/__tests__/db.test.ts
```

Expected: PASS (all tests including the new CRUD suite).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/storage/db.ts packages/server/src/modules/registry/storage/__tests__/db.test.ts
git commit -m "registry: add tool/port/schema/log CRUD with transactions"
```

---

## Phase 4 — RegistryClient: registration and discovery

### Task 11: RegistryClient skeleton with initialize + lifecycle

**Files:**
- Create: `packages/server/src/modules/registry/registry-client.ts`
- Create: `packages/server/src/modules/registry/__tests__/registry-client.test.ts`

First pass at `RegistryClient`: constructor, `initialize()` (creates directories, opens DB, loads built-in schemas into the DB table, copies the runner — deferred), `close()`. Registration and discovery come in Tasks 12-14.

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/__tests__/registry-client.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryClient } from '../registry-client.js';
import { BUILTIN_SCHEMAS } from '../schemas/builtin.js';

describe('RegistryClient — lifecycle', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('initialize creates the directory layout and DB', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    expect(fs.existsSync(path.join(tmpRoot, 'tools'))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'registry.db'))).toBe(true);
    rc.close();
  });

  it('initialize populates the schemas table with built-ins', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    const names = rc.listSchemas().map((s) => s.name).sort();
    expect(names).toEqual([...BUILTIN_SCHEMAS.map((s) => s.name)].sort());
    rc.close();
  });

  it('getSchema returns a built-in schema by name', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    expect(rc.getSchema('Integer')?.encoding).toBe('json_literal');
    expect(rc.getSchema('NumpyArray')?.encoding).toBe('pickle_b64');
    expect(rc.getSchema('NotAThing')).toBeNull();
    rc.close();
  });

  it('initialize is idempotent', async () => {
    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    rc1.close();
    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    expect(rc2.listSchemas().length).toBe(BUILTIN_SCHEMAS.length);
    rc2.close();
  });

  it('close is idempotent', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    rc.close();
    rc.close();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: FAIL — `Cannot find module '../registry-client.js'`.

- [ ] **Step 3: Write the skeleton implementation**

`packages/server/src/modules/registry/registry-client.ts`:

```typescript
import type {
  RegistryClientOptions,
  SchemaDef,
  ToolRecord,
  RegistrationRequest,
  RegistrationResult,
  InvocationRequest,
  InvocationResult,
  ListFilters,
} from './types.js';
import { RegistryLayout } from './storage/filesystem.js';
import { RegistryDb } from './storage/db.js';
import { SchemaRegistry } from './schemas/schema-registry.js';
import { BUILTIN_SCHEMAS } from './schemas/builtin.js';

export class RegistryClient {
  private readonly layout: RegistryLayout;
  private readonly db: RegistryDb;
  private readonly schemas: SchemaRegistry;
  private readonly pythonPath: string | null;
  private initialized = false;

  constructor(options: RegistryClientOptions = {}) {
    this.layout = new RegistryLayout(options.rootDir);
    this.db = new RegistryDb(this.layout.dbPath);
    this.schemas = new SchemaRegistry();
    this.pythonPath = options.pythonPath ?? null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.layout.ensureLayout();
    this.db.initialize();
    // Seed the schemas table with built-ins (idempotent — INSERT OR REPLACE).
    for (const s of BUILTIN_SCHEMAS) {
      this.db.insertSchema(s);
    }
    this.initialized = true;
  }

  close(): void {
    this.db.close();
    this.initialized = false;
  }

  listSchemas(): SchemaDef[] {
    return this.schemas.list();
  }

  getSchema(name: string): SchemaDef | null {
    return this.schemas.get(name);
  }

  // Stubs filled in by subsequent tasks.

  register(_request: RegistrationRequest): Promise<RegistrationResult> {
    throw new Error('register() not implemented');
  }

  get(_name: string, _version?: number): ToolRecord | null {
    throw new Error('get() not implemented');
  }

  getAllVersions(_name: string): ToolRecord[] {
    throw new Error('getAllVersions() not implemented');
  }

  list(_filters?: ListFilters): ToolRecord[] {
    throw new Error('list() not implemented');
  }

  findProducers(_schemaName: string): ToolRecord[] {
    throw new Error('findProducers() not implemented');
  }

  findConsumers(_schemaName: string): ToolRecord[] {
    throw new Error('findConsumers() not implemented');
  }

  invoke(_request: InvocationRequest): Promise<InvocationResult> {
    throw new Error('invoke() not implemented');
  }

  rebuildFromFilesystem(): Promise<void> {
    throw new Error('rebuildFromFilesystem() not implemented');
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/registry-client.ts packages/server/src/modules/registry/__tests__/registry-client.test.ts
git commit -m "registry: add RegistryClient lifecycle + schema introspection"
```

---

### Task 12: Registration flow — happy path

**Files:**
- Modify: `packages/server/src/modules/registry/registry-client.ts`
- Modify: `packages/server/src/modules/registry/__tests__/registry-client.test.ts`

Implements `register()` for the happy path: parse manifest, validate, stage, copy files, compute hash, write SQL transaction, atomic rename. This task covers caller `human` only — `agent` caller with tests is stubbed to return an `internal` error.

- [ ] **Step 1: Append a new `describe` block to the test file**

Append to `packages/server/src/modules/registry/__tests__/registry-client.test.ts`:

```typescript
describe('RegistryClient — register', () => {
  let tmpRoot: string;
  let rc: RegistryClient;
  let sourceDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-reg-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-src-'));
    rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
  });

  afterEach(() => {
    rc.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, version: number): string {
    const dir = path.join(sourceDir, `${name}-v${version}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: ${name}
version: ${version}
description: fixture for tests
inputs:
  value:
    schema: Integer
    required: true
outputs:
  echoed:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(
      path.join(dir, 'tool.py'),
      'def run(value):\n    return {"echoed": value}\n',
    );
    return path.join(dir, 'tool.yaml');
  }

  it('registers a valid manifest and writes the version dir', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const result = await rc.register({ manifestPath, caller: 'human' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.toolName).toBe('test.echo_int');
    expect(result.version).toBe(1);
    expect(fs.existsSync(path.join(tmpRoot, 'tools', 'test.echo_int', 'v1', 'tool.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'tools', 'test.echo_int', 'v1', 'tool.py'))).toBe(true);
    expect(result.toolHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a manifest with parse errors', async () => {
    const bad = path.join(sourceDir, 'bad.yaml');
    fs.writeFileSync(bad, 'name: [unclosed');
    const result = await rc.register({ manifestPath: bad, caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('manifest_parse');
  });

  it('rejects a manifest referencing an unknown schema', async () => {
    const dir = path.join(sourceDir, 'badschema');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: x
version: 1
description: d
inputs:
  a:
    schema: Bogus
outputs:
  r:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(path.join(dir, 'tool.py'), 'def run(a):\n    return {"r": a}\n');
    const result = await rc.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => e.category === 'schema_unknown')).toBe(true);
  });

  it('rejects a duplicate (name, version)', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const first = await rc.register({ manifestPath, caller: 'human' });
    expect(first.success).toBe(true);
    const second = await rc.register({ manifestPath, caller: 'human' });
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.errors[0].category).toBe('version_conflict');
  });

  it('rejects a manifest whose entry-point file is missing', async () => {
    const dir = path.join(sourceDir, 'noimpl');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: x
version: 1
description: d
inputs: {}
outputs:
  r:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    // No tool.py written.
    const result = await rc.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('entry_point_missing');
  });

  it('agent caller with testsRequired returns an internal stub error', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const result = await rc.register({ manifestPath, caller: 'agent', testsRequired: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('internal');
    expect(result.errors[0].message).toMatch(/not implemented/);
  });

  it('appends a success row to registration_log on success', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    await rc.register({ manifestPath, caller: 'human' });
    // Peek at the file-level log mirror.
    const logPath = path.join(tmpRoot, 'logs', 'registration.log');
    const logText = fs.readFileSync(logPath, 'utf8');
    expect(logText).toMatch(/test\.echo_int/);
    expect(logText).toMatch(/success/);
  });

  it('cleans up staging on failure', async () => {
    const bad = path.join(sourceDir, 'bad.yaml');
    fs.writeFileSync(bad, 'name: [unclosed');
    await rc.register({ manifestPath: bad, caller: 'human' });
    const stagingEntries = fs.readdirSync(path.join(tmpRoot, 'staging'));
    expect(stagingEntries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: FAIL — `register() not implemented`.

- [ ] **Step 3: Implement `register()`**

Replace the stub `register()` in `packages/server/src/modules/registry/registry-client.ts` and add the required imports. Full updated file structure:

At the top, add imports:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseToolManifest, ManifestParseError } from './manifest/parser.js';
import { validateToolManifest } from './manifest/validator.js';
import { hashToolDirectory } from './storage/filesystem.js';
import type {
  RegistrationError,
  ResolvedPort,
  ToolManifest,
  ToolRecord,
} from './types.js';
```

Replace the stub `register()` method with this full implementation (keep all the other stubs and lifecycle methods in place):

```typescript
  async register(request: RegistrationRequest): Promise<RegistrationResult> {
    const start = Date.now();
    const caller = request.caller;

    // Stub: agent-caller tests are not implemented in phase 1+2.
    if (caller === 'agent' && request.testsRequired === true) {
      return {
        success: false,
        toolName: '',
        version: null,
        errors: [{
          category: 'internal',
          message: 'agent-caller tests not implemented in phase 1+2',
        }],
      };
    }

    // 1. Read + parse the manifest.
    let yamlText: string;
    try {
      yamlText = fs.readFileSync(request.manifestPath, 'utf8');
    } catch (err) {
      return this.failRegistration('', null, [{
        category: 'filesystem',
        message: `cannot read manifest at ${request.manifestPath}: ${(err as Error).message}`,
      }], start, caller);
    }

    let manifest: ToolManifest;
    try {
      manifest = parseToolManifest(yamlText);
    } catch (err) {
      if (err instanceof ManifestParseError) {
        return this.failRegistration('', null, [{
          category: 'manifest_parse',
          message: err.message,
          ...(err.path ? { path: err.path } : {}),
        }], start, caller);
      }
      throw err;
    }

    // 2. Semantic validation.
    const validationErrors = validateToolManifest(manifest, this.schemas);
    if (validationErrors.length > 0) {
      return this.failRegistration(manifest.name, manifest.version, validationErrors, start, caller);
    }

    // 3. Version conflict.
    const existing = this.db.getTool(manifest.name, manifest.version);
    if (existing !== null) {
      return this.failRegistration(manifest.name, manifest.version, [{
        category: 'version_conflict',
        message: `tool ${manifest.name} version ${manifest.version} already registered`,
      }], start, caller);
    }

    // 4. Verify the entry-point file exists.
    const sourceDir = path.dirname(request.manifestPath);
    const [entryFile] = manifest.implementation.entryPoint.split(':');
    const entryPath = path.join(sourceDir, entryFile);
    if (!fs.existsSync(entryPath)) {
      return this.failRegistration(manifest.name, manifest.version, [{
        category: 'entry_point_missing',
        message: `entry point file not found: ${entryPath}`,
      }], start, caller);
    }

    // 5. Tests stub: not run in this slice for non-agent callers.
    const testsRequired = request.testsRequired ?? false;
    const testsRun = 0;
    const testsPassed = 0;

    // 6. Stage: copy manifest + impl + optional files into a staging dir.
    const staged = this.layout.createStagingDir();
    try {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const name = e.name;
        if (name === 'tool.yaml' || name === entryFile || name === 'tests.py' || name === 'README.md') {
          fs.copyFileSync(path.join(sourceDir, name), path.join(staged, name));
        }
      }

      // 7. Compute hash over the staged contents.
      const toolHash = hashToolDirectory(staged);

      // 8. Build the ToolRecord.
      const now = new Date().toISOString();
      const targetDir = this.layout.toolVersionDir(manifest.name, manifest.version);
      const record: ToolRecord = {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        category: manifest.category ?? null,
        tags: manifest.tags ?? [],
        inputs: this.portsFromManifest(manifest.inputs, 'input'),
        outputs: this.portsFromManifest(manifest.outputs, 'output'),
        entryPoint: manifest.implementation.entryPoint,
        language: 'python',
        requires: manifest.implementation.requires ?? [],
        stability: manifest.metadata?.stability ?? null,
        costClass: manifest.metadata?.costClass ?? null,
        author: manifest.metadata?.author ?? null,
        createdAt: manifest.metadata?.createdAt ?? now,
        toolHash,
        status: 'active',
        directory: targetDir,
      };

      // 9. SQL transaction + atomic rename.
      try {
        this.db.withTransaction(() => {
          this.db.insertTool(record, testsRun, testsPassed, testsRequired);
          this.db.appendRegistrationLog({
            timestamp: now,
            toolName: manifest.name,
            version: manifest.version,
            caller,
            outcome: 'success',
            errorMessage: null,
            testsRun,
            testsPassed,
            durationMs: Date.now() - start,
          });
        });
      } catch (err) {
        this.layout.cleanupStaging(staged);
        return this.failRegistration(manifest.name, manifest.version, [{
          category: 'database',
          message: `SQL insert failed: ${(err as Error).message}`,
        }], start, caller);
      }

      try {
        this.layout.commitStaging(staged, targetDir);
      } catch (err) {
        // Best-effort rollback of the DB row we just inserted.
        this.layout.cleanupStaging(staged);
        return this.failRegistration(manifest.name, manifest.version, [{
          category: 'filesystem',
          message: `staging commit failed: ${(err as Error).message}`,
        }], start, caller);
      }

      this.appendRegistrationLogFile({
        timestamp: now,
        toolName: manifest.name,
        version: manifest.version,
        caller,
        outcome: 'success',
        errorMessage: null,
        durationMs: Date.now() - start,
      });

      return {
        success: true,
        toolName: manifest.name,
        version: manifest.version,
        toolHash,
        testsRun,
        testsPassed,
        directory: targetDir,
      };
    } catch (err) {
      this.layout.cleanupStaging(staged);
      return this.failRegistration(manifest.name, manifest.version, [{
        category: 'internal',
        message: (err as Error).message,
      }], start, caller);
    }
  }

  private portsFromManifest(
    ports: Record<string, import('./types.js').ToolPortSpec>,
    direction: 'input' | 'output',
  ): ResolvedPort[] {
    return Object.entries(ports).map(([name, spec], idx) => ({
      name,
      direction,
      schemaName: spec.schema,
      required: spec.required ?? true,
      default: spec.default,
      description: spec.description ?? null,
      position: idx,
    }));
  }

  private failRegistration(
    toolName: string,
    version: number | null,
    errors: RegistrationError[],
    start: number,
    caller: 'seed' | 'human' | 'agent',
  ): RegistrationResult {
    const now = new Date().toISOString();
    const errorMessage = errors.map((e) => e.message).join('; ');
    try {
      this.db.appendRegistrationLog({
        timestamp: now,
        toolName,
        version,
        caller,
        outcome: 'failure',
        errorMessage,
        testsRun: null,
        testsPassed: null,
        durationMs: Date.now() - start,
      });
    } catch {
      // Fall through: failure logging is best-effort.
    }
    this.appendRegistrationLogFile({
      timestamp: now,
      toolName,
      version,
      caller,
      outcome: 'failure',
      errorMessage,
      durationMs: Date.now() - start,
    });
    return { success: false, toolName, version, errors };
  }

  private appendRegistrationLogFile(row: {
    timestamp: string;
    toolName: string;
    version: number | null;
    caller: string;
    outcome: string;
    errorMessage: string | null;
    durationMs: number;
  }): void {
    const line = `${row.timestamp}\t${row.outcome}\t${row.caller}\t${row.toolName}\tv${row.version ?? '?'}\t${row.durationMs}ms\t${row.errorMessage ?? ''}\n`;
    try {
      fs.appendFileSync(path.join(this.layout.logsDir, 'registration.log'), line);
    } catch {
      // Best-effort.
    }
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: PASS (all tests including the new register suite).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/registry-client.ts packages/server/src/modules/registry/__tests__/registry-client.test.ts
git commit -m "registry: implement register() happy and error paths"
```

---

### Task 13: Discovery methods wired through the DB

**Files:**
- Modify: `packages/server/src/modules/registry/registry-client.ts`
- Modify: `packages/server/src/modules/registry/__tests__/registry-client.test.ts`

Replaces the discovery stubs with real DB-backed implementations. The `ToolRecord.directory` field is filled in here (the DB layer leaves it empty because it does not know the layout root).

- [ ] **Step 1: Append new failing tests**

Append another `describe` block to `packages/server/src/modules/registry/__tests__/registry-client.test.ts`:

```typescript
describe('RegistryClient — discovery', () => {
  let tmpRoot: string;
  let rc: RegistryClient;
  let sourceDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-disc-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-src-disc-'));
    rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
  });

  afterEach(() => {
    rc.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  async function registerSimple(name: string, version: number, opts: { inputSchema?: string; outputSchema?: string; category?: string } = {}): Promise<void> {
    const dir = path.join(sourceDir, `${name}-v${version}`);
    fs.mkdirSync(dir, { recursive: true });
    const cat = opts.category ? `\ncategory: ${opts.category}` : '';
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: ${name}
version: ${version}
description: d${cat}
inputs:
  a:
    schema: ${opts.inputSchema ?? 'Integer'}
    required: true
outputs:
  r:
    schema: ${opts.outputSchema ?? 'Integer'}
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(path.join(dir, 'tool.py'), 'def run(a):\n    return {"r": a}\n');
    const result = await rc.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    if (!result.success) {
      throw new Error(`fixture registration failed: ${JSON.stringify(result.errors)}`);
    }
  }

  it('get() returns null for unknown tools', async () => {
    expect(rc.get('nope')).toBeNull();
  });

  it('get() returns the latest active version', async () => {
    await registerSimple('alpha', 1);
    await registerSimple('alpha', 2);
    const got = rc.get('alpha');
    expect(got?.version).toBe(2);
    expect(got?.directory.endsWith(path.join('tools', 'alpha', 'v2'))).toBe(true);
  });

  it('get() honours explicit version', async () => {
    await registerSimple('alpha', 1);
    await registerSimple('alpha', 2);
    expect(rc.get('alpha', 1)?.version).toBe(1);
  });

  it('getAllVersions returns all versions newest-first', async () => {
    await registerSimple('alpha', 1);
    await registerSimple('alpha', 2);
    const versions = rc.getAllVersions('alpha').map((t) => t.version);
    expect(versions).toEqual([2, 1]);
  });

  it('list() returns all active tools', async () => {
    await registerSimple('a', 1);
    await registerSimple('b', 1);
    expect(rc.list().map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('list() filters by category', async () => {
    await registerSimple('a', 1, { category: 'x' });
    await registerSimple('b', 1, { category: 'y' });
    expect(rc.list({ category: 'x' }).map((t) => t.name)).toEqual(['a']);
  });

  it('findProducers returns tools producing the given schema', async () => {
    await registerSimple('p', 1, { outputSchema: 'NumpyArray' });
    await registerSimple('q', 1, { outputSchema: 'Integer' });
    expect(rc.findProducers('NumpyArray').map((t) => t.name)).toEqual(['p']);
  });

  it('findConsumers returns tools consuming the given schema', async () => {
    await registerSimple('c', 1, { inputSchema: 'DataFrame', outputSchema: 'Integer' });
    await registerSimple('d', 1);
    expect(rc.findConsumers('DataFrame').map((t) => t.name)).toEqual(['c']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: FAIL — `get() not implemented`.

- [ ] **Step 3: Implement discovery methods**

Replace the five discovery stubs in `packages/server/src/modules/registry/registry-client.ts` with real implementations that delegate to the DB and fill in the `directory` field:

```typescript
  get(name: string, version?: number): ToolRecord | null {
    const record = this.db.getTool(name, version);
    return record ? this.withDirectory(record) : null;
  }

  getAllVersions(name: string): ToolRecord[] {
    return this.db.getAllVersions(name).map((r) => this.withDirectory(r));
  }

  list(filters?: ListFilters): ToolRecord[] {
    return this.db.listTools(filters).map((r) => this.withDirectory(r));
  }

  findProducers(schemaName: string): ToolRecord[] {
    return this.db.findProducers(schemaName).map((r) => this.withDirectory(r));
  }

  findConsumers(schemaName: string): ToolRecord[] {
    return this.db.findConsumers(schemaName).map((r) => this.withDirectory(r));
  }

  private withDirectory(record: ToolRecord): ToolRecord {
    return { ...record, directory: this.layout.toolVersionDir(record.name, record.version) };
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/registry-client.ts packages/server/src/modules/registry/__tests__/registry-client.test.ts
git commit -m "registry: implement discovery methods (get/list/findProducers/findConsumers)"
```

---

### Task 14: rebuildFromFilesystem — recover from missing DB

**Files:**
- Modify: `packages/server/src/modules/registry/registry-client.ts`
- Modify: `packages/server/src/modules/registry/__tests__/registry-client.test.ts`

Implements `rebuildFromFilesystem()`: walks `tools/`, re-parses each `tool.yaml`, and re-populates the `tools`/`tool_ports` tables. Also wires it into `initialize()` so that if `registry.db` is absent but `tools/` has content (user deleted the DB), the registry recovers on next startup.

- [ ] **Step 1: Append a failing test**

Append to `packages/server/src/modules/registry/__tests__/registry-client.test.ts`:

```typescript
describe('RegistryClient — rebuildFromFilesystem', () => {
  let tmpRoot: string;
  let sourceDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-rebuild-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-src-rebuild-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('repopulates the DB after registry.db is deleted', async () => {
    const dir = path.join(sourceDir, 'alpha');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: alpha
version: 1
description: d
inputs:
  a:
    schema: Integer
    required: true
outputs:
  r:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(path.join(dir, 'tool.py'), 'def run(a):\n    return {"r": a}\n');

    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    const regResult = await rc1.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    expect(regResult.success).toBe(true);
    rc1.close();

    // Delete the DB but leave the tools directory intact.
    fs.rmSync(path.join(tmpRoot, 'registry.db'), { force: true });

    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    const got = rc2.get('alpha');
    expect(got).not.toBeNull();
    expect(got?.version).toBe(1);
    rc2.close();
  });

  it('rebuildFromFilesystem is idempotent when called explicitly', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    await rc.rebuildFromFilesystem();
    await rc.rebuildFromFilesystem();
    expect(rc.list()).toEqual([]);
    rc.close();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: FAIL — the new describe block fails because `rebuildFromFilesystem` still throws, and because `initialize()` does not automatically recover.

- [ ] **Step 3: Implement rebuild + wire into initialize**

Replace the `rebuildFromFilesystem()` stub in `registry-client.ts` with this implementation and update `initialize()`:

```typescript
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.layout.ensureLayout();
    const dbExistedBefore = fs.existsSync(this.layout.dbPath);
    this.db.initialize();
    for (const s of BUILTIN_SCHEMAS) {
      this.db.insertSchema(s);
    }
    this.initialized = true;
    if (!dbExistedBefore && fs.existsSync(this.layout.toolsDir)) {
      const hasContent = fs.readdirSync(this.layout.toolsDir).length > 0;
      if (hasContent) {
        await this.rebuildFromFilesystem();
      }
    }
  }

  async rebuildFromFilesystem(): Promise<void> {
    if (!this.initialized) {
      throw new Error('rebuildFromFilesystem called before initialize');
    }
    if (!fs.existsSync(this.layout.toolsDir)) return;

    // Truncate the derived tables (registration_log is kept).
    const raw = this.db.raw();
    raw.exec('DELETE FROM tool_ports; DELETE FROM tools;');

    const toolNames = fs.readdirSync(this.layout.toolsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const toolName of toolNames) {
      const toolDir = path.join(this.layout.toolsDir, toolName);
      const versions = fs.readdirSync(toolDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
        .map((d) => d.name);
      for (const v of versions) {
        const versionDir = path.join(toolDir, v);
        const manifestPath = path.join(versionDir, 'tool.yaml');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = parseToolManifest(fs.readFileSync(manifestPath, 'utf8'));
          const errors = validateToolManifest(manifest, this.schemas);
          if (errors.length > 0) continue;
          const record: ToolRecord = {
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            category: manifest.category ?? null,
            tags: manifest.tags ?? [],
            inputs: this.portsFromManifest(manifest.inputs, 'input'),
            outputs: this.portsFromManifest(manifest.outputs, 'output'),
            entryPoint: manifest.implementation.entryPoint,
            language: 'python',
            requires: manifest.implementation.requires ?? [],
            stability: manifest.metadata?.stability ?? null,
            costClass: manifest.metadata?.costClass ?? null,
            author: manifest.metadata?.author ?? null,
            createdAt: manifest.metadata?.createdAt ?? new Date().toISOString(),
            toolHash: hashToolDirectory(versionDir),
            status: 'active',
            directory: versionDir,
          };
          this.db.insertTool(record, 0, 0, false);
        } catch {
          // Skip malformed versions; operator can inspect logs/registration.log.
        }
      }
    }
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/registry-client.ts packages/server/src/modules/registry/__tests__/registry-client.test.ts
git commit -m "registry: add rebuildFromFilesystem with auto-recovery on init"
```

---

## Phase 5 — Execution: Python runner, subprocess, executor

### Task 15: The Python runner script

**Files:**
- Create: `packages/server/src/modules/registry/python/runner.py`

No TDD for this task — the runner is exercised end-to-end by the executor integration tests in Task 19. This task writes the runner and a single direct-invocation smoke test that can be run manually to confirm the script is well-formed.

- [ ] **Step 1: Write the runner**

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
               "output_schemas": { port_name: schema_name, ... }
             }
  stdout - JSON envelope:
             on success (exit 0): { "ok": true, "outputs": { ... } }
             on tool error (exit 1): { "ok": false, "error": {...} }
             on runner error (exit 2): empty stdout, stderr carries details

Structured schemas listed in PICKLE_SCHEMAS are transported as
  { "_schema": name, "_encoding": "pickle_b64", "_data": base64 }
on both sides. All other values pass through the JSON encoder directly.

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


def decode_value(raw, schema_name):
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
        return {
            "_schema": schema_name,
            "_encoding": "pickle_b64",
            "_data": base64.b64encode(pickle.dumps(value)).decode("ascii"),
        }
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

    try:
        fn = load_entry_point(tool_dir, entry_point)
    except Exception as e:
        sys.stderr.write("load failed: %s\n%s" % (e, traceback.format_exc()))
        return 2

    try:
        decoded = {
            name: decode_value(raw_inputs[name], input_schemas.get(name, "JsonObject"))
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

- [ ] **Step 2: Smoke-test the runner manually (optional sanity check)**

This is a one-shot manual verification, not a committed test. From the repo root:

```bash
mkdir -p /tmp/plurics-runner-smoke
cat > /tmp/plurics-runner-smoke/tool.py <<'PY'
def run(value):
    return {"echoed": value}
PY
echo '{"inputs": {"value": 42}, "input_schemas": {"value": "Integer"}, "output_schemas": {"echoed": "Integer"}}' | \
  python packages/server/src/modules/registry/python/runner.py /tmp/plurics-runner-smoke tool.py:run
```

Expected stdout (exit 0): `{"ok": true, "outputs": {"echoed": 42}}`

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/python/runner.py
git commit -m "registry: add Python runner script for tool execution"
```

---

### Task 16: Subprocess wrapper with timeout and output cap

**Files:**
- Create: `packages/server/src/modules/registry/execution/subprocess.ts`
- Create: `packages/server/src/modules/registry/execution/__tests__/subprocess.test.ts`

Generic subprocess runner used by the executor. Independent of the registry domain — takes a command, args, stdin, timeout, and output cap, returns a tagged union. Tested using `node -e` as a fake interpreter so the tests run without Python.

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/execution/__tests__/subprocess.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runSubprocess } from '../subprocess.js';

const NODE = process.execPath;

describe('runSubprocess', () => {
  it('returns exit=0 and captures stdout for a successful process', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'process.stdout.write("hi")'],
      stdin: '',
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('exit');
    if (result.kind !== 'exit') return;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hi');
  });

  it('forwards stdin to the child', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'let d=""; process.stdin.on("data", c=>d+=c); process.stdin.on("end", ()=>process.stdout.write(d))'],
      stdin: 'from-parent',
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('exit');
    if (result.kind !== 'exit') return;
    expect(result.stdout).toBe('from-parent');
  });

  it('captures non-zero exit codes', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'process.exit(7)'],
      stdin: '',
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('exit');
    if (result.kind !== 'exit') return;
    expect(result.exitCode).toBe(7);
  });

  it('returns timeout when the process exceeds the deadline', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      stdin: '',
      timeoutMs: 200,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('timeout');
  });

  it('truncates and fails when stdout exceeds maxOutputBytes', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'process.stdout.write("x".repeat(10_000))'],
      stdin: '',
      timeoutMs: 5_000,
      maxOutputBytes: 100,
    });
    expect(result.kind).toBe('output_too_large');
  });

  it('returns spawn_error when the command cannot be launched', async () => {
    const result = await runSubprocess({
      command: '/nonexistent/binary/here',
      args: [],
      stdin: '',
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('spawn_error');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/subprocess.test.ts
```

Expected: FAIL — `Cannot find module '../subprocess.js'`.

- [ ] **Step 3: Implement the subprocess runner**

`packages/server/src/modules/registry/execution/subprocess.ts`:

```typescript
import { spawn } from 'node:child_process';

export interface SubprocessRequest {
  command: string;
  args: string[];
  stdin: string;
  timeoutMs: number;
  maxOutputBytes: number;
  cwd?: string;
}

export type SubprocessResult =
  | { kind: 'exit'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'timeout' }
  | { kind: 'output_too_large'; stdout: string; stderr: string }
  | { kind: 'spawn_error'; message: string };

export function runSubprocess(req: SubprocessRequest): Promise<SubprocessResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(req.command, req.args, {
        cwd: req.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ kind: 'spawn_error', message: (err as Error).message });
      return;
    }

    let settled = false;
    const settle = (r: SubprocessResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > req.maxOutputBytes) {
        truncated = true;
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= req.maxOutputBytes) {
        stderrChunks.push(chunk);
      }
    });

    child.on('error', (err) => {
      settle({ kind: 'spawn_error', message: err.message });
    });

    child.on('exit', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (truncated) {
        settle({ kind: 'output_too_large', stdout, stderr });
        return;
      }
      settle({ kind: 'exit', exitCode: code ?? -1, stdout, stderr });
    });

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const hardKill = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 5_000);
      hardKill.unref();
      settle({ kind: 'timeout' });
    }, req.timeoutMs);
    timer.unref();

    child.stdin.on('error', () => { /* ignore EPIPE on early child exit */ });
    try {
      child.stdin.end(req.stdin);
    } catch {
      // Child already exited; the exit handler will settle.
    }
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/subprocess.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/execution/subprocess.ts packages/server/src/modules/registry/execution/__tests__/subprocess.test.ts
git commit -m "registry: add subprocess wrapper with timeout and output cap"
```

---

### Task 17: TS-side input/output encoding

**Files:**
- Create: `packages/server/src/modules/registry/execution/encoding.ts`
- Create: `packages/server/src/modules/registry/execution/__tests__/encoding.test.ts`

Thin helpers for translating between the `InvocationRequest.inputs` shape, the JSON envelope sent to the runner, and the decoded `outputs` dict returned to the caller. Primitive schemas pass through; pickle schemas in inputs are rejected (opaque pickle envelopes as outputs are passed through).

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/execution/__tests__/encoding.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  encodeInputs,
  decodeOutputs,
  buildEnvelope,
  EncodingError,
} from '../encoding.js';
import { SchemaRegistry } from '../../schemas/schema-registry.js';

describe('encodeInputs', () => {
  const schemas = new SchemaRegistry();

  it('passes primitive values through unchanged', () => {
    const inputSchemas = { a: 'Integer', b: 'String', c: 'Boolean' };
    const encoded = encodeInputs({ a: 1, b: 'x', c: true }, inputSchemas, schemas);
    expect(encoded).toEqual({ a: 1, b: 'x', c: true });
  });

  it('rejects pickle schema on inputs', () => {
    const inputSchemas = { m: 'NumpyArray' };
    expect(() => encodeInputs({ m: [1, 2, 3] }, inputSchemas, schemas)).toThrow(EncodingError);
  });

  it('rejects unknown schema', () => {
    const inputSchemas = { a: 'Bogus' };
    expect(() => encodeInputs({ a: 1 }, inputSchemas, schemas)).toThrow(/unknown schema/i);
  });
});

describe('decodeOutputs', () => {
  const schemas = new SchemaRegistry();

  it('passes primitive values through unchanged', () => {
    const outputSchemas = { r: 'Integer' };
    expect(decodeOutputs({ r: 7 }, outputSchemas, schemas)).toEqual({ r: 7 });
  });

  it('preserves pickle envelopes opaquely for structured outputs', () => {
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'abc' };
    const outputSchemas = { arr: 'NumpyArray' };
    expect(decodeOutputs({ arr: envelope }, outputSchemas, schemas)).toEqual({ arr: envelope });
  });
});

describe('buildEnvelope', () => {
  it('returns a string with inputs, input_schemas, output_schemas', () => {
    const text = buildEnvelope({ a: 1 }, { a: 'Integer' }, { r: 'Integer' });
    const parsed = JSON.parse(text);
    expect(parsed.inputs).toEqual({ a: 1 });
    expect(parsed.input_schemas).toEqual({ a: 'Integer' });
    expect(parsed.output_schemas).toEqual({ r: 'Integer' });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/encoding.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement encoding**

`packages/server/src/modules/registry/execution/encoding.ts`:

```typescript
import type { SchemaRegistry } from '../schemas/schema-registry.js';

export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodingError';
  }
}

export function encodeInputs(
  values: Record<string, unknown>,
  inputSchemas: Record<string, string>,
  schemas: SchemaRegistry,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const schemaName = inputSchemas[name];
    if (!schemaName) {
      throw new EncodingError(`input "${name}" has no declared schema`);
    }
    if (!schemas.has(schemaName)) {
      throw new EncodingError(`unknown schema "${schemaName}" on input "${name}"`);
    }
    if (schemas.encodingOf(schemaName) === 'pickle_b64') {
      throw new EncodingError(
        `pickle input schemas are not supported in phase 1+2 (input "${name}" has schema "${schemaName}")`,
      );
    }
    out[name] = value;
  }
  return out;
}

export function decodeOutputs(
  raw: Record<string, unknown>,
  outputSchemas: Record<string, string>,
  schemas: SchemaRegistry,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const schemaName = outputSchemas[name] ?? 'JsonObject';
    if (schemas.has(schemaName) && schemas.encodingOf(schemaName) === 'pickle_b64') {
      // Opaque passthrough — caller treats the envelope as a sealed handle.
      out[name] = value;
    } else {
      out[name] = value;
    }
  }
  return out;
}

export function buildEnvelope(
  inputs: Record<string, unknown>,
  inputSchemas: Record<string, string>,
  outputSchemas: Record<string, string>,
): string {
  return JSON.stringify({
    inputs,
    input_schemas: inputSchemas,
    output_schemas: outputSchemas,
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/encoding.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/execution/encoding.ts packages/server/src/modules/registry/execution/__tests__/encoding.test.ts
git commit -m "registry: add TS-side input/output encoding helpers"
```

---

### Task 18: Python discovery and runner deployment in initialize

**Files:**
- Modify: `packages/server/src/modules/registry/registry-client.ts`
- Modify: `packages/server/src/modules/registry/__tests__/registry-client.test.ts`

Extends `initialize()` to (a) probe for a Python interpreter and (b) copy `python/runner.py` from the server package into the registry root. If Python is not found, `initialize()` still succeeds but `invoke()` will later fail with `python_unavailable`.

- [ ] **Step 1: Append failing tests**

Append to `packages/server/src/modules/registry/__tests__/registry-client.test.ts`:

```typescript
import { fileURLToPath } from 'node:url';

describe('RegistryClient — runner deployment', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-runner-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('copies runner.py to the registry root on initialize', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    const dest = path.join(tmpRoot, 'runner.py');
    expect(fs.existsSync(dest)).toBe(true);
    const body = fs.readFileSync(dest, 'utf8');
    expect(body).toMatch(/Plurics tool runner/);
    rc.close();
  });

  it('does not rewrite runner.py when the source is unchanged', async () => {
    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    const dest = path.join(tmpRoot, 'runner.py');
    const mtimeBefore = fs.statSync(dest).mtimeMs;
    rc1.close();
    // Small sleep so mtime has a chance to differ if we do rewrite.
    await new Promise((r) => setTimeout(r, 30));
    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    const mtimeAfter = fs.statSync(dest).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
    rc2.close();
  });

  it('rewrites runner.py when its content changed', async () => {
    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    rc1.close();
    // Simulate a stale local copy.
    fs.writeFileSync(path.join(tmpRoot, 'runner.py'), '# stale\n');
    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    const body = fs.readFileSync(path.join(tmpRoot, 'runner.py'), 'utf8');
    expect(body).toMatch(/Plurics tool runner/);
    rc2.close();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: FAIL — `runner.py` is not being copied on init.

- [ ] **Step 3: Add runner deployment + Python discovery to `initialize`**

Add these imports near the top of `registry-client.ts`:

```typescript
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
```

Add two fields and helpers inside the class:

```typescript
  private resolvedPythonPath: string | null = null;

  /** Resolved Python interpreter; null if probing failed. */
  get python(): string | null {
    return this.resolvedPythonPath;
  }
```

Replace `initialize()` to end with runner deployment and Python probe:

```typescript
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.layout.ensureLayout();
    const dbExistedBefore = fs.existsSync(this.layout.dbPath);
    this.db.initialize();
    for (const s of BUILTIN_SCHEMAS) {
      this.db.insertSchema(s);
    }
    this.initialized = true;
    if (!dbExistedBefore && fs.existsSync(this.layout.toolsDir)) {
      const hasContent = fs.readdirSync(this.layout.toolsDir).length > 0;
      if (hasContent) {
        await this.rebuildFromFilesystem();
      }
    }
    this.deployRunner();
    this.resolvedPythonPath = this.pythonPath ?? this.probePython();
  }

  private deployRunner(): void {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = path.resolve(here, 'python', 'runner.py');
    const dest = this.layout.runnerPath;
    const sourceBytes = fs.readFileSync(source);
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    let destHash: string | null = null;
    if (fs.existsSync(dest)) {
      destHash = createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    }
    if (destHash !== sourceHash) {
      fs.writeFileSync(dest, sourceBytes);
    }
  }

  private probePython(): string | null {
    const candidates = process.platform === 'win32'
      ? ['python', 'py']
      : ['python3', 'python'];
    for (const cmd of candidates) {
      try {
        const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
        const r = spawnSync(cmd, args, { encoding: 'utf8' });
        if (r.status === 0) {
          return cmd === 'py' ? 'py' : cmd;
        }
      } catch {
        // continue
      }
    }
    return null;
  }
```

**Important:** the runner resolution uses `import.meta.url` and walks up from the compiled JS location. For `tsx` / dev mode this resolves to the source TS directory. For `tsc` build mode this resolves to `dist/modules/registry/`. Ensure `python/runner.py` is part of the build output. Add a line to `packages/server/package.json` scripts so the runner is copied on build:

Modify `packages/server/package.json` — change `"build"` to:

```json
    "build": "tsc && node -e \"require('fs').cpSync('src/modules/registry/python', 'dist/modules/registry/python', {recursive:true})\""
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts
```

Expected: PASS (all runner-deployment tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/registry-client.ts packages/server/src/modules/registry/__tests__/registry-client.test.ts packages/server/package.json
git commit -m "registry: deploy Python runner and probe interpreter on initialize"
```

---

### Task 19: Executor happy path with test fixtures

**Files:**
- Create: `packages/server/src/modules/registry/execution/executor.ts`
- Create: `packages/server/src/modules/registry/execution/__tests__/executor.test.ts`
- Create test fixtures under `packages/server/src/modules/registry/__tests__/fixtures/`

The executor composes subprocess + encoding + registry. This task covers the happy path plus `tool_not_found` and `validation` — the error paths (`runtime`, `timeout`, `output_mismatch`, `subprocess_crash`) come in Task 20.

**Fixture files to create:**

`packages/server/src/modules/registry/__tests__/fixtures/echo_int/tool.yaml`:

```yaml
name: test.echo_int
version: 1
description: Echo an integer unchanged.
category: testing
inputs:
  value:
    schema: Integer
    required: true
    description: value to echo
outputs:
  echoed:
    schema: Integer
    description: same as input
implementation:
  language: python
  entry_point: tool.py:run
```

`packages/server/src/modules/registry/__tests__/fixtures/echo_int/tool.py`:

```python
def run(value):
    return {"echoed": value}
```

`packages/server/src/modules/registry/__tests__/fixtures/numpy_sum/tool.yaml`:

```yaml
name: test.numpy_sum
version: 1
description: Sum a JSON list of numbers and return both the array and the sum.
category: testing
inputs:
  values:
    schema: JsonArray
    required: true
outputs:
  array:
    schema: NumpyArray
  sum:
    schema: Float
implementation:
  language: python
  entry_point: tool.py:run
  requires:
    - numpy
```

`packages/server/src/modules/registry/__tests__/fixtures/numpy_sum/tool.py`:

```python
def run(values):
    import numpy as np
    arr = np.array(values, dtype=float)
    return {"array": arr, "sum": float(arr.sum())}
```

- [ ] **Step 1: Write the failing test**

`packages/server/src/modules/registry/execution/__tests__/executor.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RegistryClient } from '../../registry-client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', '..', '__tests__', 'fixtures');

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
  const r = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-c', 'import numpy'],
    { encoding: 'utf8' },
  );
  return r.status === 0;
})();

describe.skipIf(!pythonAvailable())('Executor — happy path (integration)', () => {
  let tmpRoot: string;
  let rc: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-exec-'));
    rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
  });

  afterEach(() => {
    rc.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns tool_not_found for a missing tool', async () => {
    const result = await rc.invoke({ toolName: 'missing', inputs: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.category).toBe('tool_not_found');
  });

  it('returns validation error when required input is missing', async () => {
    const reg = await rc.register({
      manifestPath: path.join(FIXTURES, 'echo_int', 'tool.yaml'),
      caller: 'human',
    });
    expect(reg.success).toBe(true);
    const result = await rc.invoke({ toolName: 'test.echo_int', inputs: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.category).toBe('validation');
    expect(result.error.message).toMatch(/value/);
  });

  it('invokes an integer echo tool end to end', async () => {
    const reg = await rc.register({
      manifestPath: path.join(FIXTURES, 'echo_int', 'tool.yaml'),
      caller: 'human',
    });
    expect(reg.success).toBe(true);
    const result = await rc.invoke({ toolName: 'test.echo_int', inputs: { value: 42 } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outputs).toEqual({ echoed: 42 });
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!numpyAvailable)('invokes a numpy tool and returns opaque pickle envelope + float', async () => {
    const reg = await rc.register({
      manifestPath: path.join(FIXTURES, 'numpy_sum', 'tool.yaml'),
      caller: 'human',
    });
    expect(reg.success).toBe(true);
    const result = await rc.invoke({
      toolName: 'test.numpy_sum',
      inputs: { values: [1, 2, 3, 4] },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outputs.sum).toBeCloseTo(10, 5);
    const envelope = result.outputs.array as Record<string, unknown>;
    expect(envelope._schema).toBe('NumpyArray');
    expect(envelope._encoding).toBe('pickle_b64');
    expect(typeof envelope._data).toBe('string');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/executor.test.ts
```

Expected: FAIL — `invoke() not implemented`.

- [ ] **Step 3: Implement the executor and wire it through `invoke()`**

`packages/server/src/modules/registry/execution/executor.ts`:

```typescript
import type { InvocationRequest, InvocationResult, ToolRecord } from '../types.js';
import type { SchemaRegistry } from '../schemas/schema-registry.js';
import { runSubprocess } from './subprocess.js';
import { buildEnvelope, encodeInputs, decodeOutputs, EncodingError } from './encoding.js';

export interface ExecutorDeps {
  schemas: SchemaRegistry;
  runnerPath: string;
  pythonPath: string | null;
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

  let envelope: string;
  try {
    const encoded = encodeInputs(mergedInputs, inputSchemas, deps.schemas);
    envelope = buildEnvelope(encoded, inputSchemas, outputSchemas);
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

  const outputs = decodeOutputs(rawOutputs, outputSchemas, deps.schemas);
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

Replace the `invoke()` stub in `registry-client.ts`:

```typescript
  async invoke(request: InvocationRequest): Promise<InvocationResult> {
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
      },
      tool,
      request,
    );
  }
```

Add the import at the top of `registry-client.ts`:

```typescript
import { invokeTool } from './execution/executor.js';
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/executor.test.ts
```

Expected: PASS (4 tests; the numpy test is skipped automatically if numpy is not available).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/execution/executor.ts packages/server/src/modules/registry/execution/__tests__/executor.test.ts packages/server/src/modules/registry/__tests__/fixtures/ packages/server/src/modules/registry/registry-client.ts
git commit -m "registry: implement executor happy path with test fixtures"
```

---

### Task 20: Executor error paths — runtime, timeout, output_mismatch, subprocess_crash

**Files:**
- Modify: `packages/server/src/modules/registry/execution/__tests__/executor.test.ts`
- Create test fixtures: `always_fails/`, `slow/`, `bad_output/`, `crash/` under `__tests__/fixtures/`

No implementation changes are expected — Task 19 already implements the error dispatching. This task adds the fixtures and tests that exercise every row of the error matrix in the spec §11.

**Fixture files:**

`__tests__/fixtures/always_fails/tool.yaml`:

```yaml
name: test.always_fails
version: 1
description: Always raises.
inputs:
  message:
    schema: String
    required: true
outputs:
  never:
    schema: String
implementation:
  language: python
  entry_point: tool.py:run
```

`__tests__/fixtures/always_fails/tool.py`:

```python
def run(message):
    raise RuntimeError("boom: " + message)
```

`__tests__/fixtures/slow/tool.yaml`:

```yaml
name: test.slow
version: 1
description: Sleeps for N seconds.
inputs:
  seconds:
    schema: Integer
    required: true
outputs:
  done:
    schema: Boolean
implementation:
  language: python
  entry_point: tool.py:run
```

`__tests__/fixtures/slow/tool.py`:

```python
import time
def run(seconds):
    time.sleep(seconds)
    return {"done": True}
```

`__tests__/fixtures/bad_output/tool.yaml`:

```yaml
name: test.bad_output
version: 1
description: Returns a dict missing a declared output.
inputs: {}
outputs:
  left:
    schema: Integer
  right:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
```

`__tests__/fixtures/bad_output/tool.py`:

```python
def run():
    return {"left": 1}
```

`__tests__/fixtures/crash/tool.yaml`:

```yaml
name: test.crash
version: 1
description: Exits with a non-standard code.
inputs: {}
outputs:
  never:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
```

`__tests__/fixtures/crash/tool.py`:

```python
import os
def run():
    os._exit(99)
```

- [ ] **Step 1: Append failing tests**

Append a new describe block to `packages/server/src/modules/registry/execution/__tests__/executor.test.ts`:

```typescript
describe.skipIf(!pythonAvailable())('Executor — error paths (integration)', () => {
  let tmpRoot: string;
  let rc: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-exec-err-'));
    rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
  });

  afterEach(() => {
    rc.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function register(name: string): Promise<void> {
    const res = await rc.register({
      manifestPath: path.join(FIXTURES, name, 'tool.yaml'),
      caller: 'human',
    });
    if (!res.success) {
      throw new Error(`register ${name} failed: ${JSON.stringify(res.errors)}`);
    }
  }

  it('returns runtime error when the tool raises', async () => {
    await register('always_fails');
    const result = await rc.invoke({ toolName: 'test.always_fails', inputs: { message: 'x' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.category).toBe('runtime');
    expect(result.error.message).toMatch(/boom/);
  });

  it('returns timeout when the tool exceeds its deadline', async () => {
    await register('slow');
    const result = await rc.invoke({
      toolName: 'test.slow',
      inputs: { seconds: 5 },
      timeoutMs: 500,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.category).toBe('timeout');
  });

  it('returns output_mismatch when declared outputs are missing', async () => {
    await register('bad_output');
    const result = await rc.invoke({ toolName: 'test.bad_output', inputs: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.category).toBe('output_mismatch');
    expect(result.error.message).toMatch(/right/);
  });

  it('returns subprocess_crash when the runner exits unexpectedly', async () => {
    await register('crash');
    const result = await rc.invoke({ toolName: 'test.crash', inputs: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.category).toBe('subprocess_crash');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they pass**

```bash
cd packages/server && npx vitest run src/modules/registry/execution/__tests__/executor.test.ts
```

Expected: PASS — all four error paths verified.

If a test fails, do not add try/catches to the executor. Read the error, identify which branch is wrong, and fix it. The most likely miss is the `subprocess_crash` case: on some platforms `os._exit(99)` may cause the runner to write nothing to stdout, which is already handled by the exit-code dispatch.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/__tests__/fixtures/ packages/server/src/modules/registry/execution/__tests__/executor.test.ts
git commit -m "registry: verify executor error paths against fixtures"
```

---

## Phase 6 — Server integration

### Task 21: Expose RegistryClient from the module index

**Files:**
- Modify: `packages/server/src/modules/registry/index.ts`

Nothing to test — this is a re-export file.

- [ ] **Step 1: Replace the placeholder index with real re-exports**

`packages/server/src/modules/registry/index.ts`:

```typescript
// Public entry point for the Plurics Tool Registry module.

export { RegistryClient } from './registry-client.js';
export type {
  RegistryClientOptions,
  ToolCaller,
  PortDirection,
  Stability,
  CostClass,
  ToolStatus,
  SchemaDef,
  SchemaKind,
  SchemaEncoding,
  SchemaSource,
  ToolPortSpec,
  ToolManifest,
  ResolvedPort,
  ToolRecord,
  RegistrationRequest,
  RegistrationError,
  RegistrationResult,
  ListFilters,
  InvocationRequest,
  InvocationErrorCategory,
  InvocationResult,
} from './types.js';
```

- [ ] **Step 2: Verify the module compiles**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/index.ts
git commit -m "registry: re-export public API from module index"
```

---

### Task 22: Instantiate RegistryClient in the server bootstrap

**Files:**
- Modify: `packages/server/src/app.ts`

Creates a singleton `RegistryClient`, awaits `initialize()` before the HTTP server starts listening, and wires `close()` into process shutdown. No REST/WS endpoints are added in this slice — the registry is accessible only to other server modules via the exported singleton.

- [ ] **Step 1: Read the current bootstrap shape**

```bash
sed -n '1,40p' packages/server/src/app.ts
```

Identify where `server.listen(...)` is called so the `await` for `initialize()` can be inserted immediately before it.

- [ ] **Step 2: Add the import and construction**

Near the top of `packages/server/src/app.ts`, after the existing imports, add:

```typescript
import { RegistryClient } from './modules/registry/index.js';
```

Immediately after `const server = http.createServer(app);` (or in whatever place constructs other singletons like `AgentRegistry`), add:

```typescript
export const toolRegistry = new RegistryClient();
```

- [ ] **Step 3: Await `initialize()` before binding the HTTP server**

Find the line that calls `server.listen(PORT, ...)`. Wrap the server bootstrap in an `async` IIFE that awaits `toolRegistry.initialize()` first. The pattern:

```typescript
(async () => {
  try {
    await toolRegistry.initialize();
    console.log('[registry] initialized at', toolRegistry.rootDir ?? process.env.PLURICS_REGISTRY_ROOT ?? '~/.plurics/registry');
  } catch (err) {
    console.error('[registry] initialize failed:', err);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
```

Note: the existing bootstrap may already be a top-level `server.listen(...)`. Replace that line with the IIFE above.

**Clarification:** `toolRegistry.rootDir` is not a public getter in this slice. Replace that log statement with a simpler version:

```typescript
console.log('[registry] initialized');
```

- [ ] **Step 4: Register a clean shutdown hook**

At the bottom of `packages/server/src/app.ts`, before the final closing of any existing blocks, add:

```typescript
const shutdown = (signal: string): void => {
  console.log(`[server] received ${signal}, shutting down`);
  try {
    toolRegistry.close();
  } catch {
    // ignore
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

If a shutdown hook already exists, fold the `toolRegistry.close()` call into it instead of duplicating.

- [ ] **Step 5: Verify the server still boots**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: no errors.

Optional manual verification (do not automate — this is a smoke check):

```bash
PLURICS_REGISTRY_ROOT=/tmp/plurics-smoke npm run dev:server
```

Expected console line: `[registry] initialized`. Confirm `/tmp/plurics-smoke/registry.db` exists, then Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "server: wire RegistryClient into app bootstrap"
```

---

### Task 23: Full-module test sweep

**Files:** none (verification only)

- [ ] **Step 1: Run every registry test together**

```bash
cd packages/server && npx vitest run src/modules/registry
```

Expected: all suites green. Integration suites are skipped automatically if Python is absent; re-run with Python installed to exercise them end to end.

- [ ] **Step 2: Run the whole server test suite to catch regressions**

```bash
cd packages/server && npm test
```

Expected: no regressions in pre-existing suites.

- [ ] **Step 3: Final slice commit (empty if nothing changed)**

If everything is green and no further changes are needed, skip the commit. Otherwise amend any follow-up fixes into their original task commits rather than creating a cleanup commit.

---

## Appendix A — Test fixtures summary

Fixtures live at `packages/server/src/modules/registry/__tests__/fixtures/` and are used only by integration tests. They are not seed tools and never ship to users.

| Fixture | Covers |
|---|---|
| `echo_int/` | Primitive in, primitive out; happy path |
| `numpy_sum/` | `JsonArray` in, `NumpyArray` + `Float` out; pickle output envelope |
| `always_fails/` | `runtime` error category |
| `slow/` | `timeout` error category |
| `bad_output/` | `output_mismatch` (missing declared output) |
| `crash/` | `subprocess_crash` (`os._exit(99)`) |

## Appendix B — Error matrix coverage

| Category | Task covering it |
|---|---|
| `tool_not_found` | 19 |
| `validation` (missing required) | 19 |
| `validation` (unknown input port) | 19 (implicit via `validateInputs`) |
| `validation` (pickle input) | 17 |
| `timeout` | 20 |
| `runtime` | 20 |
| `output_mismatch` (missing port) | 20 |
| `output_mismatch` (non-JSON stdout) | 19 (verified via wiring) |
| `subprocess_crash` | 20 |
| `python_unavailable` | 18 (wiring) — no dedicated test; manual verification by pointing `pythonPath` at a bogus binary |
| `manifest_parse` | 12 |
| `manifest_validation` | 6, 12 |
| `schema_unknown` | 6, 12 |
| `version_conflict` | 12 |
| `entry_point_missing` | 12 |
| `filesystem` | 12 (staging cleanup) |
| `database` | 12 (transaction rollback via SQL unique constraint) |
| `internal` (agent stub) | 12 |

## Appendix C — What is NOT in this plan

Explicit non-goals, mirroring spec §3:

- Real seed tools (pandas, sklearn, scipy, etc.).
- Type checker for compositions, converters, and `findPath`.
- User-defined schema registration API.
- `search` full-text discovery.
- Workflow engine integration (`kind: tool` YAML field, DAG executor dispatch).
- Plugin hooks (`onToolProposal`, `onToolRegression`).
- Tool-authoring UI and REST/WS endpoints for the registry.
- Invocation cache.
- Regression testing at registration.
- Automatic Python dependency installation.
- Full TS↔Python pickle round-trip for inputs.
- Python-version drift detection.

Each of these is addressable as an additive follow-up without revisiting the foundation laid by this plan.

---

*Plan authored on 2026-04-11. Total tasks: 23. Estimated effort: ~2 weeks focused work, matching the spec's rollout estimate. Execution mode is chosen after the plan is approved — see the message that accompanies this file.*

