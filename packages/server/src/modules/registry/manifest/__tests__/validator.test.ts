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
