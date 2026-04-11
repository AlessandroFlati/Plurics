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

  it('first call registers all seed tools', async () => {
    const result = await loadSeedTools(client);
    // With empty manifest, zero registered is correct.
    // This count will be updated as tools are added in tasks 4-13.
    expect(result.registered).toBe(9);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    const fft = client.get('stats.fft');
    expect(fft).not.toBeNull();
    expect(fft!.outputs).toHaveLength(2);
    const outNames = fft!.outputs.map((o) => o.name);
    expect(outNames).toContain('frequencies');
    expect(outNames).toContain('magnitudes');
    const outSchemas = fft!.outputs.map((o) => o.schemaName);
    expect(outSchemas).toEqual(['NumpyArray', 'NumpyArray']);

    const producers = client.findProducers('DataFrame');
    const producerNames = producers.map((t) => t.name);
    expect(producerNames).toContain('pandas.load_csv');

    const consumers = client.findConsumers('DataFrame');
    const consumerNames = consumers.map((t) => t.name);
    expect(consumerNames).toContain('pandas.save_csv');

    const dfConsumers = client.findConsumers('DataFrame').map((t) => t.name);
    expect(dfConsumers).toContain('stats.describe');

    const dfConsumers2 = client.findConsumers('DataFrame').map((t) => t.name);
    expect(dfConsumers2).toContain('stats.correlation_matrix');
  });

  it('second call is a pure no-op (idempotent)', async () => {
    await loadSeedTools(client);
    const result2 = await loadSeedTools(client);
    expect(result2.registered).toBe(0);
    expect(result2.skipped).toBe(9);
    expect(result2.failed).toBe(0);
  });
});
