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
