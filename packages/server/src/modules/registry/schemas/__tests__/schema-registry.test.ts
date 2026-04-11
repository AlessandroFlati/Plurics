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
