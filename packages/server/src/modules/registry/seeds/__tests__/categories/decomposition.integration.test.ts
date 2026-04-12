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

const LIBS = ['numpy', 'scikit-learn'];

describe('decomposition seeds — integration', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-decomp-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
    await loadSeedTools(client);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'sklearn.pca registers with correct category and output count',
    async () => {
      const tool = await client.get('sklearn.pca');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('decomposition');
      expect(tool!.outputs).toHaveLength(3);
      const outNames = tool!.outputs.map((o) => o.name);
      expect(outNames).toContain('components');
      expect(outNames).toContain('explained_variance');
      expect(outNames).toContain('transformed');
    }
  );

  it.skipIf(!pythonAvailable() || !libsAvailable(LIBS))(
    'sklearn.umap registers with requires including umap-learn',
    async () => {
      const tool = await client.get('sklearn.umap');
      expect(tool).toBeDefined();
      expect(tool!.requires).toContain('umap-learn');
    }
  );

  // Note: invocation tests for all decomposition tools are NR2-gated.
  // Add invocation tests in the NR Phase 2 slice.
});
