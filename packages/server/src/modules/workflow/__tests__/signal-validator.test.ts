import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { validateSignalSchema, validateSignalOutputs } from '../signal-validator.js';
import type { SignalFile } from '../types.js';

function makeSignal(overrides: Partial<SignalFile> = {}): SignalFile {
  return {
    schema_version: 1,
    signal_id: 'sig-20260408-test-abcd',
    agent: 'test_agent',
    scope: null,
    status: 'success',
    decision: null,
    outputs: [],
    metrics: { duration_seconds: 10, retries_used: 0 },
    error: null,
    ...overrides,
  };
}

describe('validateSignalSchema', () => {
  it('accepts a valid signal', () => {
    expect(validateSignalSchema(makeSignal())).toBe(true);
  });

  it('accepts a signal with branch decision', () => {
    expect(validateSignalSchema(makeSignal({
      status: 'branch',
      decision: { goto: 'next_node', reason: 'done', payload: ['H-001'] },
    }))).toBe(true);
  });

  it('rejects null', () => {
    expect(validateSignalSchema(null)).toBe(false);
  });

  it('rejects wrong schema_version', () => {
    expect(validateSignalSchema({ ...makeSignal(), schema_version: 2 })).toBe(false);
  });

  it('rejects missing agent', () => {
    const s = makeSignal();
    (s as Record<string, unknown>).agent = 123;
    expect(validateSignalSchema(s)).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(validateSignalSchema({ ...makeSignal(), status: 'unknown' })).toBe(false);
  });

  it('rejects outputs with missing sha256', () => {
    expect(validateSignalSchema({
      ...makeSignal(),
      outputs: [{ path: 'foo.json', size_bytes: 10 }],
    })).toBe(false);
  });
});

describe('validateSignalOutputs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caam-test-'));
    fs.mkdirSync(path.join(tmpDir, '.caam', 'shared', 'results'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns valid for signal with no outputs', async () => {
    const result = await validateSignalOutputs(tmpDir, makeSignal());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing output file', async () => {
    const signal = makeSignal({
      outputs: [{ path: 'shared/results/missing.json', sha256: 'abc', size_bytes: 10 }],
    });
    const result = await validateSignalOutputs(tmpDir, signal);
    expect(result.valid).toBe(false);
    expect(result.errors[0].issue).toBe('missing');
  });

  it('detects size mismatch', async () => {
    const filePath = path.join(tmpDir, '.caam', 'shared', 'results', 'out.json');
    fs.writeFileSync(filePath, '{"ok":true}');
    const stat = fs.statSync(filePath);
    const signal = makeSignal({
      outputs: [{ path: 'shared/results/out.json', sha256: 'abc', size_bytes: stat.size + 100 }],
    });
    const result = await validateSignalOutputs(tmpDir, signal);
    expect(result.valid).toBe(false);
    expect(result.errors[0].issue).toBe('size_mismatch');
  });

  it('detects sha256 mismatch', async () => {
    const filePath = path.join(tmpDir, '.caam', 'shared', 'results', 'out.json');
    fs.writeFileSync(filePath, '{"ok":true}');
    const stat = fs.statSync(filePath);
    const signal = makeSignal({
      outputs: [{ path: 'shared/results/out.json', sha256: 'wrong_hash', size_bytes: stat.size }],
    });
    const result = await validateSignalOutputs(tmpDir, signal);
    expect(result.valid).toBe(false);
    expect(result.errors[0].issue).toBe('sha256_mismatch');
  });

  it('validates correct output', async () => {
    const filePath = path.join(tmpDir, '.caam', 'shared', 'results', 'out.json');
    const content = '{"ok":true}';
    fs.writeFileSync(filePath, content);
    const stat = fs.statSync(filePath);
    const hash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const signal = makeSignal({
      outputs: [{ path: 'shared/results/out.json', sha256: hash, size_bytes: stat.size }],
    });
    const result = await validateSignalOutputs(tmpDir, signal);
    expect(result.valid).toBe(true);
  });
});
