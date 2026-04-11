import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '../schema-registry.js';

describe('SchemaRegistry — summarizers', () => {
  const schemas = new SchemaRegistry();

  it('getSummarizer("DataFrame") returns a function', () => {
    expect(typeof schemas.getSummarizer('DataFrame')).toBe('function');
  });

  it('getSummarizer("NumpyArray") returns a function', () => {
    expect(typeof schemas.getSummarizer('NumpyArray')).toBe('function');
  });

  it('getSummarizer("Float") returns null', () => {
    expect(schemas.getSummarizer('Float')).toBeNull();
  });

  it('getSummarizer("Unknown") returns null', () => {
    expect(schemas.getSummarizer('Unknown')).toBeNull();
  });

  it('DataFrame summarizer produces shape, columns, head from valid payload', () => {
    const summarizer = schemas.getSummarizer('DataFrame')!;
    const payload = {
      shape: [100, 3],
      columns: ['a', 'b', 'c'],
      head: [{ a: 1, b: 2, c: 3 }],
      stats: { a: { mean: 1.5 } },
    };
    const summary = summarizer(payload);
    expect(summary).not.toBeNull();
    expect(summary!.schema).toBe('DataFrame');
    expect(summary!.shape).toEqual([100, 3]);
    expect(summary!.columns).toEqual(['a', 'b', 'c']);
    expect(summary!.head).toEqual([{ a: 1, b: 2, c: 3 }]);
    expect(summary!.stats).toEqual({ a: { mean: 1.5 } });
  });

  it('DataFrame summarizer returns partial summary if stats is missing', () => {
    const summarizer = schemas.getSummarizer('DataFrame')!;
    const payload = { shape: [10, 2], columns: ['x', 'y'], head: [] };
    const summary = summarizer(payload);
    expect(summary).not.toBeNull();
    expect(summary!.shape).toEqual([10, 2]);
    expect(summary!.stats).toBeUndefined();
  });

  it('DataFrame summarizer does not throw on empty/null payload', () => {
    const summarizer = schemas.getSummarizer('DataFrame')!;
    expect(() => summarizer(null)).not.toThrow();
    expect(() => summarizer({})).not.toThrow();
    expect(() => summarizer(undefined)).not.toThrow();
  });

  it('NumpyArray summarizer produces ndim, size, dtype, sample from valid payload', () => {
    const summarizer = schemas.getSummarizer('NumpyArray')!;
    const payload = { shape: [4], ndim: 1, size: 4, dtype: 'float64', sample: [1, 2, 3, 4] };
    const summary = summarizer(payload);
    expect(summary).not.toBeNull();
    expect(summary!.schema).toBe('NumpyArray');
    expect(summary!.ndim).toBe(1);
    expect(summary!.size).toBe(4);
    expect(summary!.dtype).toBe('float64');
    expect(summary!.sample).toEqual([1, 2, 3, 4]);
  });

  it('NumpyArray summarizer does not throw on empty payload', () => {
    const summarizer = schemas.getSummarizer('NumpyArray')!;
    expect(() => summarizer(null)).not.toThrow();
    expect(() => summarizer({})).not.toThrow();
  });
});
