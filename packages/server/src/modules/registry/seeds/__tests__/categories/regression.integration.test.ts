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

const SKLEARN_LIBS = ['numpy', 'scikit-learn'];
const STATSMODELS_LIBS = ['numpy', 'statsmodels'];

describe.skipIf(!pythonAvailable() || !libsAvailable(SKLEARN_LIBS))(
  'regression seeds (sklearn) — integration (requires Python + numpy + scikit-learn)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-reg-sklearn-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('sklearn.logistic_regression registers with correct port schemas', () => {
      const tool = client.get('sklearn.logistic_regression');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('regression');
      const inputNames = tool!.inputs.map((p) => p.name);
      expect(inputNames).toContain('X');
      expect(inputNames).toContain('y');
      const inputSchemas = tool!.inputs.map((p) => p.schemaName);
      expect(inputSchemas).toContain('NumpyArray');
      const outputNames = tool!.outputs.map((p) => p.name);
      expect(outputNames).toContain('coefficients');
      expect(outputNames).toContain('intercept');
      expect(outputNames).toContain('accuracy');
      const coefPort = tool!.outputs.find((p) => p.name === 'coefficients');
      expect(coefPort!.schemaName).toBe('NumpyArray');
    });

    it('sklearn.ridge registers with alpha input and r_squared output', () => {
      const tool = client.get('sklearn.ridge');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('regression');
      const inputNames = tool!.inputs.map((p) => p.name);
      expect(inputNames).toContain('alpha');
      const alphaPort = tool!.inputs.find((p) => p.name === 'alpha');
      expect(alphaPort!.schemaName).toBe('Float');
      const outputNames = tool!.outputs.map((p) => p.name);
      expect(outputNames).toContain('r_squared');
    });

    it('sklearn.lasso registers with alpha input and r_squared output', () => {
      const tool = client.get('sklearn.lasso');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('regression');
      const inputNames = tool!.inputs.map((p) => p.name);
      expect(inputNames).toContain('alpha');
      const outputNames = tool!.outputs.map((p) => p.name);
      expect(outputNames).toContain('coefficients');
      expect(outputNames).toContain('r_squared');
    });
  }
);

describe.skipIf(!pythonAvailable() || !libsAvailable(STATSMODELS_LIBS))(
  'regression seeds (statsmodels) — integration (requires Python + numpy + statsmodels)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-reg-sm-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('statsmodels.glm registers with family input and aic output', () => {
      const tool = client.get('statsmodels.glm');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('regression');
      const inputNames = tool!.inputs.map((p) => p.name);
      expect(inputNames).toContain('X');
      expect(inputNames).toContain('y');
      expect(inputNames).toContain('family');
      const familyPort = tool!.inputs.find((p) => p.name === 'family');
      expect(familyPort!.schemaName).toBe('String');
      const outputNames = tool!.outputs.map((p) => p.name);
      expect(outputNames).toContain('coefficients');
      expect(outputNames).toContain('p_values');
      expect(outputNames).toContain('aic');
      const aicPort = tool!.outputs.find((p) => p.name === 'aic');
      expect(aicPort!.schemaName).toBe('Float');
    });
  }
);
