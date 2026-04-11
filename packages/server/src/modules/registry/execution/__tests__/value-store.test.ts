import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { ValueStore } from '../value-store.js';
import type { ValueEnvelope, ValueSummary } from '../../types.js';

const MOCK_ENVELOPE: ValueEnvelope = {
  _schema: 'NumpyArray',
  _encoding: 'pickle_b64',
  _data: 'AAAA',
};

const MOCK_SUMMARY: ValueSummary = {
  schema: 'NumpyArray',
  ndim: 1,
  size: 4,
  dtype: 'float64',
  sample: [1.0, 2.0, 3.0, 4.0],
};

describe('ValueStore — handle generation', () => {
  it('store() returns a handle matching the vs-{ts}-{node}-{port}-{hash} pattern', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const handle = store.store(MOCK_ENVELOPE, null, 'load_data', 'array');
    expect(handle).toMatch(/^vs-\d{8}T\d{6}-load_data-array-[0-9a-f]{8}$/);
  });

  it('handle embeds sanitized node and port names (dots become underscores)', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const handle = store.store(MOCK_ENVELOPE, null, 'my.node', 'out.port');
    expect(handle).toContain('-my_node-');
    expect(handle).toContain('-out_port-');
  });

  it('handle truncates long node/port names to 20 chars', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const handle = store.store(MOCK_ENVELOPE, null, 'a'.repeat(30), 'b'.repeat(30));
    const parts = handle.split('-');
    // parts: ['vs', timestamp, nodeName, portName, hash]
    expect(parts[2].length).toBeLessThanOrEqual(20);
    expect(parts[3].length).toBeLessThanOrEqual(20);
  });

  it('two store() calls on the same ms with different data produce distinct handles', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const env2: ValueEnvelope = { ...MOCK_ENVELOPE, _data: 'BBBB' };
    const h1 = store.store(MOCK_ENVELOPE, null, 'node', 'port');
    const h2 = store.store(env2, null, 'node', 'port');
    expect(h1).not.toEqual(h2);
  });
});

describe('ValueStore — storage and retrieval', () => {
  it('resolve() returns the stored value', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const handle = store.store(MOCK_ENVELOPE, MOCK_SUMMARY, 'load_data', 'array');
    const stored = store.resolve(handle);
    expect(stored).not.toBeNull();
    expect(stored!.envelope).toEqual(MOCK_ENVELOPE);
    expect(stored!.summary).toEqual(MOCK_SUMMARY);
    expect(stored!.schema).toBe('NumpyArray');
    expect(stored!.nodeName).toBe('load_data');
    expect(stored!.portName).toBe('array');
    expect(stored!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('resolve() returns null for unknown handle', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    expect(store.resolve('vs-doesnotexist')).toBeNull();
  });

  it('has() returns true for stored handles, false otherwise', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const h = store.store(MOCK_ENVELOPE, null, 'n', 'p');
    expect(store.has(h)).toBe(true);
    expect(store.has('vs-ghost')).toBe(false);
  });

  it('handles() lists all stored handles', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const h1 = store.store(MOCK_ENVELOPE, null, 'n', 'p1');
    const h2 = store.store({ ...MOCK_ENVELOPE, _data: 'ZZ' }, null, 'n', 'p2');
    expect(store.handles()).toContain(h1);
    expect(store.handles()).toContain(h2);
    expect(store.handles().length).toBe(2);
  });

  it('store() with null summary stores summary as null', () => {
    const store = new ValueStore('run-1', os.tmpdir());
    const h = store.store(MOCK_ENVELOPE, null, 'n', 'p');
    expect(store.resolve(h)!.summary).toBeNull();
  });
});

describe('ValueStore — disk flush and load', () => {
  it('flush() writes .pkl.b64 file and .summary.json sidecar', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));
    const store = new ValueStore('run-x', tmpDir);
    const handle = store.store(MOCK_ENVELOPE, MOCK_SUMMARY, 'node', 'port');

    await store.flush();

    const valuesDir = path.join(tmpDir, 'runs', 'run-x', 'values');
    expect(fs.existsSync(path.join(valuesDir, `${handle}.pkl.b64`))).toBe(true);
    expect(fs.existsSync(path.join(valuesDir, `${handle}.summary.json`))).toBe(true);

    const envelopeFile = JSON.parse(fs.readFileSync(path.join(valuesDir, `${handle}.pkl.b64`), 'utf-8'));
    expect(envelopeFile.envelope._data).toBe('AAAA');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('flush() does not write .summary.json when summary is null', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));
    const store = new ValueStore('run-x', tmpDir);
    const handle = store.store(MOCK_ENVELOPE, null, 'node', 'port');
    await store.flush();

    const valuesDir = path.join(tmpDir, 'runs', 'run-x', 'values');
    expect(fs.existsSync(path.join(valuesDir, `${handle}.pkl.b64`))).toBe(true);
    expect(fs.existsSync(path.join(valuesDir, `${handle}.summary.json`))).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadRunLevel() restores flushed envelopes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));

    const store1 = new ValueStore('run-x', tmpDir);
    const handle = store1.store(MOCK_ENVELOPE, MOCK_SUMMARY, 'node', 'port');
    await store1.flush();

    const store2 = new ValueStore('run-x', tmpDir);
    await store2.loadRunLevel();

    const stored = store2.resolve(handle);
    expect(stored).not.toBeNull();
    expect(stored!.envelope._data).toBe('AAAA');
    expect(stored!.summary?.ndim).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadRunLevel() skips malformed .pkl.b64 files without throwing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));
    const valuesDir = path.join(tmpDir, 'runs', 'run-x', 'values');
    fs.mkdirSync(valuesDir, { recursive: true });
    fs.writeFileSync(path.join(valuesDir, 'vs-bad.pkl.b64'), 'not json', 'utf-8');

    const store = new ValueStore('run-x', tmpDir);
    await expect(store.loadRunLevel()).resolves.not.toThrow();
    expect(store.handles().length).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
