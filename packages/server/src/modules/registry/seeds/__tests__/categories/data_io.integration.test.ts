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
    const importName = lib === 'scikit-learn' ? 'sklearn' : lib === 'pyyaml' ? 'yaml' : lib;
    const r = spawnSync(cmd, ['-c', `import ${importName}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

const YAML_LIBS = ['pyyaml'];
const PARQUET_LIBS = ['pandas', 'pyarrow'];

describe.skipIf(!pythonAvailable() || !libsAvailable(YAML_LIBS))(
  'data_io seeds (yaml) — integration (requires Python + pyyaml)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-data-io-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('yaml.load registers with correct port schemas', () => {
      const tool = client.get('yaml.load');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('data_io');
      expect(tool!.inputs[0].schemaName).toBe('String');
      expect(tool!.outputs[0].schemaName).toBe('JsonObject');
    });

    it('yaml.dump registers with correct port schemas', () => {
      const tool = client.get('yaml.dump');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('data_io');
      expect(tool!.outputs[0].schemaName).toBe('Boolean');
    });

    it('yaml.load invocation: loads a YAML file and returns its contents', async () => {
      const yamlPath = path.join(tmpRoot, 'test.yaml');
      fs.writeFileSync(yamlPath, 'key: value\nnumber: 42\n', 'utf-8');
      const result = await client.invoke({ toolName: 'yaml.load', inputs: { path: yamlPath } });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs['data']).toMatchObject({ key: 'value', number: 42 });
    });

    it('yaml.dump invocation: writes a YAML file and returns true', async () => {
      const yamlPath = path.join(tmpRoot, 'out.yaml');
      const result = await client.invoke({
        toolName: 'yaml.dump',
        inputs: { data: { key: 'value', number: 42 }, path: yamlPath },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs['written']).toBe(true);
      expect(fs.existsSync(yamlPath)).toBe(true);
    });
  }
);

describe.skipIf(!pythonAvailable() || !libsAvailable(PARQUET_LIBS))(
  'data_io seeds (parquet) — integration (requires Python + pandas + pyarrow)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-data-io-pq-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('pandas.load_parquet registers with correct port schemas', () => {
      const tool = client.get('pandas.load_parquet');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('data_io');
      expect(tool!.inputs[0].schemaName).toBe('String');
      expect(tool!.outputs[0].schemaName).toBe('DataFrame');
    });

    it('pandas.save_parquet registers with correct port schemas', () => {
      const tool = client.get('pandas.save_parquet');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('data_io');
      expect(tool!.outputs[0].schemaName).toBe('Boolean');
    });

    // Note: pandas.load_parquet invocation test is primitive-invocable (output only).
    // Full round-trip test (save_parquet → load_parquet) deferred to NR Phase 2
    // because pandas.save_parquet takes a DataFrame input (NR2-gated).
  }
);
