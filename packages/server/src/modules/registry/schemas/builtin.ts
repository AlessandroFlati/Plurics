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
    summarizer(payload: unknown) {
      try {
        if (!payload || typeof payload !== 'object') return null;
        const p = payload as Record<string, unknown>;
        return {
          schema: 'NumpyArray',
          ndim: typeof p['ndim'] === 'number' ? p['ndim'] : undefined,
          size: typeof p['size'] === 'number' ? p['size'] : undefined,
          dtype: typeof p['dtype'] === 'string' ? p['dtype'] : undefined,
          shape: Array.isArray(p['shape']) ? (p['shape'] as [number, number]) : undefined,
          sample: Array.isArray(p['sample']) ? (p['sample'] as unknown[]) : undefined,
        };
      } catch {
        return null;
      }
    },
  },
  {
    name: 'DataFrame',
    kind: 'structured',
    pythonRepresentation: 'pandas.DataFrame',
    encoding: 'pickle_b64',
    description: 'Generic pandas DataFrame.',
    source: 'builtin',
    summarizer(payload: unknown) {
      try {
        if (!payload || typeof payload !== 'object') return null;
        const p = payload as Record<string, unknown>;
        return {
          schema: 'DataFrame',
          shape: Array.isArray(p['shape']) ? (p['shape'] as [number, number]) : undefined,
          columns: Array.isArray(p['columns']) ? (p['columns'] as string[]) : undefined,
          head: Array.isArray(p['head']) ? (p['head'] as Record<string, unknown>[]) : undefined,
          stats: p['stats'] && typeof p['stats'] === 'object'
            ? (p['stats'] as Record<string, unknown>)
            : undefined,
        };
      } catch {
        return null;
      }
    },
  },
];

/** Schemas whose values move across the stdio boundary as pickle+base64. */
export const PICKLE_SCHEMA_NAMES: readonly string[] = BUILTIN_SCHEMAS
  .filter((s) => s.encoding === 'pickle_b64')
  .map((s) => s.name);
