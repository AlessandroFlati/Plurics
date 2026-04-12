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
    const importName = lib === 'scikit-learn' ? 'sklearn' : lib === 'umap-learn' ? 'umap' : lib;
    const r = spawnSync(cmd, ['-c', `import ${importName}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

const LIBS = ['pandas', 'numpy'];

describe('data_transformation seeds — integration', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-datatrans-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
    await loadSeedTools(client);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'pandas.filter registers with correct category and DataFrame input/output',
    async () => {
      const tool = await client.get('pandas.filter');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('data_transformation');
      const inputNames = tool!.inputs.map((i) => i.name);
      expect(inputNames).toContain('df');
      expect(inputNames).toContain('query');
      const dfInput = tool!.inputs.find((i) => i.name === 'df');
      expect(dfInput!.schemaName).toBe('DataFrame');
      expect(tool!.outputs).toHaveLength(1);
      expect(tool!.outputs[0].name).toBe('result');
      expect(tool!.outputs[0].schemaName).toBe('DataFrame');
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'numpy.reshape registers with NumpyArray input and output',
    async () => {
      const tool = await client.get('numpy.reshape');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('data_transformation');
      const inputNames = tool!.inputs.map((i) => i.name);
      expect(inputNames).toContain('array');
      expect(inputNames).toContain('shape');
      const arrayInput = tool!.inputs.find((i) => i.name === 'array');
      expect(arrayInput!.schemaName).toBe('NumpyArray');
      const shapeInput = tool!.inputs.find((i) => i.name === 'shape');
      expect(shapeInput!.schemaName).toBe('JsonArray');
      expect(tool!.outputs).toHaveLength(1);
      expect(tool!.outputs[0].name).toBe('result');
      expect(tool!.outputs[0].schemaName).toBe('NumpyArray');
    }
  );

  // Note: invocation tests for all data_transformation tools are NR2-gated.
  // Add invocation tests in the NR Phase 2 slice.
});
