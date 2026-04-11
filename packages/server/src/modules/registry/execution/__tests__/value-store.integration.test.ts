import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RegistryClient } from '../../registry-client.js';
import { ValueStore } from '../value-store.js';
import type { ValueRef } from '../../types.js';

// Use __dirname to avoid CJS/import.meta.url compat issues
const FIXTURES = path.resolve(__dirname, '..', '..', '__tests__', 'fixtures');

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

const numpyAvailable = ((): boolean => {
  if (!pythonAvailable()) return false;
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-c', 'import numpy'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
})();

describe.skipIf(!pythonAvailable() || !numpyAvailable)(
  'ValueStore integration — NumpyArray handle round-trip',
  () => {
    let tmpRoot: string;
    let rc: RegistryClient;
    let store: ValueStore;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-vs-int-'));
      rc = new RegistryClient({ rootDir: tmpRoot });
      await rc.initialize();
      store = new ValueStore('test-run', tmpRoot);

      // Register test.numpy_sum
      const sumReg = await rc.register({
        manifestPath: path.join(FIXTURES, 'numpy_sum', 'tool.yaml'),
        caller: 'human',
      });
      expect(sumReg.success).toBe(true);

      // Register test.numpy_identity
      const idReg = await rc.register({
        manifestPath: path.join(FIXTURES, 'numpy_identity', 'tool.yaml'),
        caller: 'human',
      });
      expect(idReg.success).toBe(true);
    });

    afterEach(() => {
      rc.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('numpy_sum with valueStore returns a ValueRef, not a raw envelope', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [1, 2, 3, 4] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const arrayOutput = result.outputs['array'];
      expect((arrayOutput as ValueRef)._type).toBe('value_ref');
      expect((arrayOutput as ValueRef)._schema).toBe('NumpyArray');
      expect(typeof (arrayOutput as ValueRef)._handle).toBe('string');
      // Float output is unaffected
      expect(typeof result.outputs['sum']).toBe('number');
    });

    it('resolved handle contains the pickle envelope', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [10, 20, 30] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const ref = result.outputs['array'] as ValueRef;
      const stored = store.resolve(ref._handle);
      expect(stored).not.toBeNull();
      expect(stored!.envelope._encoding).toBe('pickle_b64');
      expect(typeof stored!.envelope._data).toBe('string');
    });

    it('runner emits _summary; ValueRef carries summary with ndim and size', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [1, 2, 3] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const ref = result.outputs['array'] as ValueRef;
      expect(ref._summary).toBeDefined();
      expect(ref._summary!.ndim).toBe(1);
      expect(ref._summary!.size).toBe(3);
    });

    it('numpy_identity accepts a ValueRef and returns a new ValueRef', async () => {
      // Step 1: produce a handle via numpy_sum
      const sumResult = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [5, 10, 15] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(sumResult.success).toBe(true);
      if (!sumResult.success) return;
      const handle1 = (sumResult.outputs['array'] as ValueRef)._handle;

      // Step 2: feed the handle into numpy_identity
      const ref: ValueRef = { _type: 'value_ref', _handle: handle1, _schema: 'NumpyArray' };
      const idResult = await rc.invoke(
        {
          toolName: 'test.numpy_identity',
          inputs: { arr: ref },
          callerContext: { workflowRunId: 'test-run', nodeName: 'id_node', scope: null },
        },
        store,
      );
      expect(idResult.success).toBe(true);
      if (!idResult.success) return;

      const outRef = idResult.outputs['arr'] as ValueRef;
      expect(outRef._type).toBe('value_ref');
      // The identity returns a new handle (new pickle of the same array)
      expect(typeof outRef._handle).toBe('string');
    });

    it('flush then loadRunLevel restores the handle', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_sum',
          inputs: { values: [100, 200] },
          callerContext: { workflowRunId: 'test-run', nodeName: 'sum_node', scope: null },
        },
        store,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const ref = result.outputs['array'] as ValueRef;
      await store.flush();

      // New store, same runId — should load from disk
      const store2 = new ValueStore('test-run', tmpRoot);
      await store2.loadRunLevel();
      expect(store2.has(ref._handle)).toBe(true);
      expect(store2.resolve(ref._handle)!.envelope._encoding).toBe('pickle_b64');
    });

    it('passing a raw array to a pickle-schema port fails with validation error', async () => {
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_identity',
          inputs: { arr: [1, 2, 3] },
        },
        store,
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.category).toBe('validation');
      expect(result.error.message).toMatch(/raw pickle/i);
    });

    it('passing an unknown handle fails with validation error', async () => {
      const ghostRef: ValueRef = { _type: 'value_ref', _handle: 'vs-ghost', _schema: 'NumpyArray' };
      const result = await rc.invoke(
        {
          toolName: 'test.numpy_identity',
          inputs: { arr: ghostRef },
        },
        store,
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.category).toBe('validation');
      expect(result.error.message).toMatch(/handle_not_found/i);
    });

    it('numpy_sum without valueStore still returns raw envelope (backward compat)', async () => {
      const result = await rc.invoke({
        toolName: 'test.numpy_sum',
        inputs: { values: [1, 2] },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      // Without valueStore, pickle outputs come back as raw envelopes
      const arrayOutput = result.outputs['array'] as Record<string, unknown>;
      expect(arrayOutput['_encoding']).toBe('pickle_b64');
    });
  },
);
