import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { validateInputManifest } from '../input-validator.js';
import type { InputManifest } from '../input-types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caam-input-'));
  fs.writeFileSync(path.join(tmpDir, 'data.csv'), 'a,b\n1,2\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeManifest(overrides: Partial<InputManifest> = {}): InputManifest {
  return {
    sources: [{ type: 'local_file', path: 'data.csv', format: 'auto', sheet: null, encoding: null, delimiter: null }],
    config_overrides: {},
    scope: null,
    description: null,
    ...overrides,
  };
}

describe('validateInputManifest', () => {
  it('passes for valid local file manifest', () => {
    const errors = validateInputManifest(makeManifest(), tmpDir);
    expect(errors).toHaveLength(0);
  });

  it('fails when no sources provided', () => {
    const errors = validateInputManifest(makeManifest({ sources: [] }), tmpDir);
    expect(errors.some(e => e.field === 'sources')).toBe(true);
  });

  it('fails when local file does not exist', () => {
    const errors = validateInputManifest(makeManifest({
      sources: [{ type: 'local_file', path: 'nonexistent.csv', format: 'auto', sheet: null, encoding: null, delimiter: null }],
    }), tmpDir);
    expect(errors.some(e => e.field === 'sources[0].path')).toBe(true);
  });

  it('fails for invalid URL', () => {
    const errors = validateInputManifest(makeManifest({
      sources: [{ type: 'url', url: 'not-a-url', format: 'auto', headers: {} }],
    }), tmpDir);
    expect(errors.some(e => e.field === 'sources[0].url')).toBe(true);
  });

  it('fails for HTTP URL (requires HTTPS)', () => {
    const errors = validateInputManifest(makeManifest({
      sources: [{ type: 'url', url: 'http://example.com/data.csv', format: 'auto', headers: {} }],
    }), tmpDir);
    expect(errors.some(e => e.message.includes('HTTPS'))).toBe(true);
  });

  it('fails for non-SELECT SQL query', () => {
    fs.writeFileSync(path.join(tmpDir, 'test.db'), '');
    const errors = validateInputManifest(makeManifest({
      sources: [{ type: 'sqlite', path: 'test.db', query: 'DROP TABLE users' }],
    }), tmpDir);
    expect(errors.some(e => e.message.includes('SELECT'))).toBe(true);
  });

  it('passes for any config override keys (domain-specific)', () => {
    const errors = validateInputManifest(makeManifest({
      config_overrides: { custom_key: 42, another: 'value' },
    }), tmpDir);
    expect(errors).toHaveLength(0);
  });

  it('fails for both include and exclude columns', () => {
    const errors = validateInputManifest(makeManifest({
      scope: { include_columns: ['a'], exclude_columns: ['b'], date_range: null, row_filter: null, max_rows: null, sampling_method: null, stratify_column: null },
    }), tmpDir);
    expect(errors.some(e => e.field === 'scope')).toBe(true);
  });

  it('fails for max_rows < 100', () => {
    const errors = validateInputManifest(makeManifest({
      scope: { include_columns: null, exclude_columns: null, date_range: null, row_filter: null, max_rows: 10, sampling_method: null, stratify_column: null },
    }), tmpDir);
    expect(errors.some(e => e.field === 'scope.max_rows')).toBe(true);
  });

  it('fails for stratified sampling without column', () => {
    const errors = validateInputManifest(makeManifest({
      scope: { include_columns: null, exclude_columns: null, date_range: null, row_filter: null, max_rows: null, sampling_method: 'stratified', stratify_column: null },
    }), tmpDir);
    expect(errors.some(e => e.field === 'scope.stratify_column')).toBe(true);
  });

  it('passes for empty inline data fails', () => {
    const errors = validateInputManifest(makeManifest({
      sources: [{ type: 'inline', data: [] }],
    }), tmpDir);
    expect(errors.some(e => e.field === 'sources[0].data')).toBe(true);
  });

  it('passes for valid inline data', () => {
    const errors = validateInputManifest(makeManifest({
      sources: [{ type: 'inline', data: [{ a: 1, b: 2 }] }],
    }), tmpDir);
    expect(errors).toHaveLength(0);
  });
});
