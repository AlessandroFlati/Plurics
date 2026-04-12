import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { RegistryClient } from '../../../registry-client.js';
import { loadSeedTools } from '../../loader.js';

function pythonAvailable(): boolean {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

function libsAvailable(libs: string[]): boolean {
  if (!pythonAvailable()) return false;
  const cmd = process.platform === 'win32' ? 'python' : 'python3';
  for (const lib of libs) {
    const importName = lib === 'scikit-learn' ? 'sklearn' : lib;
    const r = spawnSync(cmd, ['-c', `import ${importName}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

const LIBS = ['numpy'];

describe.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
  'descriptive_stats seeds — integration (requires Python + numpy)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-dstats-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('stats.median registers with correct output schema', async () => {
      const tool = client.get('stats.median');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('descriptive_stats');
      expect(tool!.outputs[0].schemaName).toBe('Float');
    });

    it('stats.median invocation: median([1,2,3,4,5]) === 3.0', async () => {
      const result = await client.invoke({ toolName: 'stats.median', inputs: { values: [1, 2, 3, 4, 5] } });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs['median']).toBeCloseTo(3.0);
    });

    it('stats.histogram returns counts + edges with correct lengths', async () => {
      const result = await client.invoke({
        toolName: 'stats.histogram',
        inputs: { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], bins: 5 },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs['counts']).toHaveLength(5);
      expect(result.outputs['edges']).toHaveLength(6);
    });
  }
);
