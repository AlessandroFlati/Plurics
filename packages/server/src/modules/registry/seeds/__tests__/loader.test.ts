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

  it('returns zero counts when manifest is empty', async () => {
    const result = await loadSeedTools(client);
    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
