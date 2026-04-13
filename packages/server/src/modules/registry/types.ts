// Public types for the Plurics Tool Registry.
// See docs/superpowers/specs/2026-04-11-tool-registry-phase-1-2-design.md §7.

import type { TypeExpr } from '../workflow/type-parser.js';

export type ToolCaller = 'seed' | 'human' | 'agent';
export type PortDirection = 'input' | 'output';
export type Stability = 'experimental' | 'stable' | 'deprecated';
export type CostClass = 'fast' | 'medium' | 'slow';
export type ToolStatus = 'active' | 'deprecated' | 'archived';
export type SchemaKind = 'primitive' | 'structured';
export type SchemaEncoding = 'json_literal' | 'pickle_b64';
export type SchemaSource = 'builtin' | 'user';
export type ChangeType = 'net_new' | 'additive' | 'destructive';

// ---------- Schemas ----------

/** Function that turns a runner-computed payload into a typed summary. */
export type Summarizer = (payload: unknown) => ValueSummary | null;

export interface SchemaDef {
  name: string;
  kind: SchemaKind;
  pythonRepresentation: string | null;
  encoding: SchemaEncoding;
  description: string | null;
  source: SchemaSource;
  /** Optional: convert runner-emitted summary payload to a typed ValueSummary. */
  summarizer?: Summarizer;
  validatorModule?: string;    // relative path from registry module root, e.g. "schemas/validators/ohlc_frame.py"
  validatorFunction?: string;  // defaults to "validate" if module is set but function is omitted
}

// ---------- Tool manifests (post-parse, pre-validation) ----------

export interface ToolPortSpec {
  schema: string;
  parsedTypeExpr?: TypeExpr;   // Set when schema string contains '['; absent for named types.
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface ToolManifest {
  name: string;
  version: number;
  change_type: ChangeType;
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
    isConverter?: boolean;
    sourceSchema?: string;
    targetSchema?: string;
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
  changeType: ChangeType;
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

// ---------- Converter registry ----------

export interface ConverterRecord {
  sourceSchema: string;
  targetSchema: string;
  toolName: string;
  toolVersion: number;
}

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
  | 'python_unavailable'
  | 'schema_validation_failed';

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

// ---------- Category summary ----------

export interface CategorySummary {
  name: string;         // null category stored as 'Uncategorized'
  toolCount: number;
  versions: number;
}

// ---------- Test run result ----------

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

// ---------- Client options ----------

export interface RegistryClientOptions {
  rootDir?: string;          // defaults to ~/.plurics/registry; override via PLURICS_REGISTRY_ROOT
  pythonPath?: string;       // absolute path; resolved at initialize() if omitted
}

// ---------- Value Store (Node Runtimes Phase 2) ----------

/**
 * An opaque reference to a structured value held in the run-level ValueStore.
 * This is what flows through the TypeScript workflow runtime instead of raw
 * pickle envelopes. Callers outside the execution layer never see ValueEnvelope.
 */
export interface ValueRef {
  _type: 'value_ref';
  /** "vs-{yyyyMMddTHHmmss}-{nodeName}-{portName}-{shortHash}" */
  _handle: string;
  /** Schema name, e.g. "DataFrame" or "NumpyArray". */
  _schema: string;
  /** Human-readable summary produced by the runner, if available. */
  _summary?: ValueSummary;
}

/**
 * The raw pickle envelope as emitted by the Python runner.
 * Lives only inside the execution layer and the value store.
 */
export interface ValueEnvelope {
  _schema: string;
  _encoding: 'pickle_b64';
  /** base64-encoded pickle bytes. */
  _data: string;
}

/**
 * Compact summary computed by the runner and stored alongside the envelope.
 * Provides a human-readable / LLM-readable view without unpickling.
 */
export interface ValueSummary {
  schema: string;
  // DataFrame-specific
  shape?: [number, number];
  columns?: string[];
  head?: Record<string, unknown>[];
  stats?: Record<string, unknown>;
  // NumpyArray-specific
  ndim?: number;
  size?: number;
  dtype?: string;
  sample?: unknown[];
}

/**
 * A stored value: envelope + optional summary, with provenance metadata.
 * Kept in the ValueStore's in-memory map and serialized to disk on flush().
 */
export interface StoredValue {
  handle: string;
  envelope: ValueEnvelope;
  summary: ValueSummary | null;
  schema: string;
  /** ISO-8601 UTC timestamp of when store() was called. */
  createdAt: string;
  nodeName: string;
  portName: string;
}
