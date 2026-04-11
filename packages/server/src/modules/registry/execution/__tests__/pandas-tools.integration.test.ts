import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../../seeds/loader.js';
import { ValueStore } from '../value-store.js';
import type { ValueRef } from '../../types.js';

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

function libAvailable(lib: string): boolean {
  if (!pythonAvailable()) return false;
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-c', `import ${lib}`], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

const pandasAvailable = libAvailable('pandas');

describe.skipIf(!pythonAvailable() || !pandasAvailable)(
  'Seed tools — pandas handle chain (integration)',
  () => {
    let tmpRoot: string;
    let rc: RegistryClient;
    let store: ValueStore;
    let csvPath: string;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-pandas-'));
      // Write a small CSV fixture
      csvPath = path.join(tmpRoot, 'test.csv');
      fs.writeFileSync(csvPath, 'a,b,c\n1,2,3\n4,5,6\n7,8,9\n', 'utf-8');

      rc = new RegistryClient({ rootDir: path.join(tmpRoot, 'registry') });
      await rc.initialize();
      await loadSeedTools(rc);
      store = new ValueStore('test-run', tmpRoot);
    });

    afterEach(() => {
      rc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('pandas.load_csv returns a ValueRef with DataFrame summary', async () => {
      const result = await rc.invoke(
        {
          toolName: 'pandas.load_csv',
          inputs: { path: csvPath },
          callerContext: { workflowRunId: 'test-run', nodeName: 'load_csv', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error('pandas.load_csv failed:', result.error);
        return;
      }
      const dfRef = result.outputs['df'] as ValueRef;
      expect(dfRef._type).toBe('value_ref');
      expect(dfRef._schema).toBe('DataFrame');
      expect(dfRef._summary?.shape).toEqual([3, 3]);
      expect(dfRef._summary?.columns).toContain('a');
    });

    it('pandas.load_csv → stats.describe handle chain succeeds', async () => {
      // Step 1: load CSV
      const loadResult = await rc.invoke(
        {
          toolName: 'pandas.load_csv',
          inputs: { path: csvPath },
          callerContext: { workflowRunId: 'test-run', nodeName: 'load_csv', scope: null },
        },
        store,
      );
      expect(loadResult.success).toBe(true);
      if (!loadResult.success) return;

      const dfRef = loadResult.outputs['df'] as ValueRef;

      // Step 2: describe using the handle
      const descResult = await rc.invoke(
        {
          toolName: 'stats.describe',
          inputs: { df: dfRef },
          callerContext: { workflowRunId: 'test-run', nodeName: 'describe', scope: null },
        },
        store,
      );
      expect(descResult.success).toBe(true);
      if (!descResult.success) {
        console.error('stats.describe failed:', descResult.error);
        return;
      }
      // stats.describe() returns a JsonObject summary
      const summary = descResult.outputs['summary'];
      expect(typeof summary).toBe('object');
      expect(summary).not.toBeNull();
    });
  },
);
