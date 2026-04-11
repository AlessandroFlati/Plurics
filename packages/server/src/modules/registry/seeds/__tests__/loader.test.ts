import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../loader.js';

describe('loadSeedTools — unit (no Python required)', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-seeds-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('first call registers all 10 seed tools', async () => {
    const result = await loadSeedTools(client);
    expect(result.registered).toBe(10);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    // All tools appear in list()
    expect(client.list().length).toBeGreaterThanOrEqual(10);

    // pandas.load_csv — single String input, DataFrame output
    const loadCsv = client.get('pandas.load_csv');
    expect(loadCsv).not.toBeNull();
    expect(loadCsv!.inputs).toHaveLength(1);
    expect(loadCsv!.inputs[0].schemaName).toBe('String');
    expect(loadCsv!.outputs[0].schemaName).toBe('DataFrame');

    // stats.fft — two NumpyArray outputs
    const fft = client.get('stats.fft');
    expect(fft).not.toBeNull();
    expect(fft!.outputs).toHaveLength(2);
    const fftOutNames = fft!.outputs.map((o) => o.name);
    expect(fftOutNames).toContain('frequencies');
    expect(fftOutNames).toContain('magnitudes');
    const fftOutSchemas = fft!.outputs.map((o) => o.schemaName);
    expect(fftOutSchemas).toEqual(['NumpyArray', 'NumpyArray']);

    // findProducers('DataFrame') includes pandas.load_csv
    const producers = client.findProducers('DataFrame').map((t) => t.name);
    expect(producers).toContain('pandas.load_csv');

    // findConsumers('DataFrame') includes the three DataFrame-input tools
    const consumers = client.findConsumers('DataFrame').map((t) => t.name);
    expect(consumers).toContain('pandas.save_csv');
    expect(consumers).toContain('stats.describe');
    expect(consumers).toContain('stats.correlation_matrix');
  });

  it('second call is a pure no-op (idempotent)', async () => {
    await loadSeedTools(client);
    const result2 = await loadSeedTools(client);
    expect(result2.registered).toBe(0);
    expect(result2.skipped).toBe(10);
    expect(result2.failed).toBe(0);
    expect(result2.errors).toHaveLength(0);
  });
});
