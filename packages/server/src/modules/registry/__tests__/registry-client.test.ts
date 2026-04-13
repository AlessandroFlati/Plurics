import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { RegistryClient } from '../registry-client.js';
import { BUILTIN_SCHEMAS } from '../schemas/builtin.js';
import { loadSeedTools } from '../seeds/index.js';
import type { SeedLoadResult } from '../seeds/index.js';


describe('seeds re-exports — smoke', () => {
  it('loadSeedTools is a function', () => {
    expect(typeof loadSeedTools).toBe('function');
  });
});

describe('RegistryClient — lifecycle', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('initialize creates the directory layout and DB', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    expect(fs.existsSync(path.join(tmpRoot, 'tools'))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'registry.db'))).toBe(true);
    rc.close();
  });

  it('initialize populates the schemas table with built-ins', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    const names = rc.listSchemas().map((s) => s.name).sort();
    expect(names).toEqual([...BUILTIN_SCHEMAS.map((s) => s.name)].sort());
    rc.close();
  });

  it('getSchema returns a built-in schema by name', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    expect(rc.getSchema('Integer')?.encoding).toBe('json_literal');
    expect(rc.getSchema('NumpyArray')?.encoding).toBe('pickle_b64');
    expect(rc.getSchema('NotAThing')).toBeNull();
    rc.close();
  });

  it('initialize is idempotent', async () => {
    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    rc1.close();
    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    expect(rc2.listSchemas().length).toBe(BUILTIN_SCHEMAS.length);
    rc2.close();
  });

  it('close is idempotent', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    rc.close();
    rc.close();
  });
});

describe('RegistryClient — register', () => {
  let tmpRoot: string;
  let rc: RegistryClient;
  let sourceDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-reg-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-src-'));
    rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
  });

  afterEach(() => {
    rc.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, version: number): string {
    const dir = path.join(sourceDir, `${name}-v${version}`);
    fs.mkdirSync(dir, { recursive: true });
    const changeType = version === 1 ? 'net_new' : 'additive';
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: ${name}
version: ${version}
change_type: ${changeType}
description: fixture for tests
inputs:
  value:
    schema: Integer
    required: true
outputs:
  echoed:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(
      path.join(dir, 'tool.py'),
      'def run(value):\n    return {"echoed": value}\n',
    );
    return path.join(dir, 'tool.yaml');
  }

  it('registers a valid manifest and writes the version dir', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const result = await rc.register({ manifestPath, caller: 'human' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.toolName).toBe('test.echo_int');
    expect(result.version).toBe(1);
    expect(fs.existsSync(path.join(tmpRoot, 'tools', 'test.echo_int', 'v1', 'tool.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'tools', 'test.echo_int', 'v1', 'tool.py'))).toBe(true);
    expect(result.toolHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a manifest with parse errors', async () => {
    const bad = path.join(sourceDir, 'bad.yaml');
    fs.writeFileSync(bad, 'name: [unclosed');
    const result = await rc.register({ manifestPath: bad, caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('manifest_parse');
  });

  it('rejects a manifest referencing an unknown schema', async () => {
    const dir = path.join(sourceDir, 'badschema');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: x
version: 1
change_type: net_new
description: d
inputs:
  a:
    schema: Bogus
outputs:
  r:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(path.join(dir, 'tool.py'), 'def run(a):\n    return {"r": a}\n');
    const result = await rc.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => e.category === 'schema_unknown')).toBe(true);
  });

  it('rejects a duplicate (name, version)', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const first = await rc.register({ manifestPath, caller: 'human' });
    expect(first.success).toBe(true);
    const second = await rc.register({ manifestPath, caller: 'human' });
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.errors[0].category).toBe('version_conflict');
  });

  it('rejects a manifest whose entry-point file is missing', async () => {
    const dir = path.join(sourceDir, 'noimpl');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: x
version: 1
change_type: net_new
description: d
inputs: {}
outputs:
  r:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    // No tool.py written.
    const result = await rc.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('entry_point_missing');
  });

  it('agent caller with testsRequired returns an internal stub error', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    const result = await rc.register({ manifestPath, caller: 'agent', testsRequired: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].category).toBe('internal');
    expect(result.errors[0].message).toMatch(/not implemented/);
  });

  it('appends a success row to registration_log on success', async () => {
    const manifestPath = writeFixture('test.echo_int', 1);
    await rc.register({ manifestPath, caller: 'human' });
    // Peek at the file-level log mirror.
    const logPath = path.join(tmpRoot, 'logs', 'registration.log');
    const logText = fs.readFileSync(logPath, 'utf8');
    expect(logText).toMatch(/test\.echo_int/);
    expect(logText).toMatch(/success/);
  });

  it('cleans up staging on failure', async () => {
    const bad = path.join(sourceDir, 'bad.yaml');
    fs.writeFileSync(bad, 'name: [unclosed');
    await rc.register({ manifestPath: bad, caller: 'human' });
    const stagingEntries = fs.readdirSync(path.join(tmpRoot, 'staging'));
    expect(stagingEntries).toEqual([]);
  });
});

describe('RegistryClient — discovery', () => {
  let tmpRoot: string;
  let rc: RegistryClient;
  let sourceDir: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-disc-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-src-disc-'));
    rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
  });

  afterEach(() => {
    rc.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  async function registerSimple(name: string, version: number, opts: { inputSchema?: string; outputSchema?: string; category?: string } = {}): Promise<void> {
    const dir = path.join(sourceDir, `${name}-v${version}`);
    fs.mkdirSync(dir, { recursive: true });
    const cat = opts.category ? `\ncategory: ${opts.category}` : '';
    const changeType = version === 1 ? 'net_new' : 'additive';
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: ${name}
version: ${version}
change_type: ${changeType}
description: d${cat}
inputs:
  a:
    schema: ${opts.inputSchema ?? 'Integer'}
    required: true
outputs:
  r:
    schema: ${opts.outputSchema ?? 'Integer'}
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(path.join(dir, 'tool.py'), 'def run(a):\n    return {"r": a}\n');
    const result = await rc.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    if (!result.success) {
      throw new Error(`fixture registration failed: ${JSON.stringify(result.errors)}`);
    }
  }

  it('get() returns null for unknown tools', async () => {
    expect(rc.get('nope')).toBeNull();
  });

  it('get() returns the latest active version', async () => {
    await registerSimple('alpha', 1);
    await registerSimple('alpha', 2);
    const got = rc.get('alpha');
    expect(got?.version).toBe(2);
    expect(got?.directory.endsWith(path.join('tools', 'alpha', 'v2'))).toBe(true);
  });

  it('get() honours explicit version', async () => {
    await registerSimple('alpha', 1);
    await registerSimple('alpha', 2);
    expect(rc.get('alpha', 1)?.version).toBe(1);
  });

  it('getAllVersions returns all versions newest-first', async () => {
    await registerSimple('alpha', 1);
    await registerSimple('alpha', 2);
    const versions = rc.getAllVersions('alpha').map((t) => t.version);
    expect(versions).toEqual([2, 1]);
  });

  it('list() returns all active tools', async () => {
    await registerSimple('a', 1);
    await registerSimple('b', 1);
    expect(rc.list().map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('list() filters by category', async () => {
    await registerSimple('a', 1, { category: 'x' });
    await registerSimple('b', 1, { category: 'y' });
    expect(rc.list({ category: 'x' }).map((t) => t.name)).toEqual(['a']);
  });

  it('findProducers returns tools producing the given schema', async () => {
    await registerSimple('p', 1, { outputSchema: 'NumpyArray' });
    await registerSimple('q', 1, { outputSchema: 'Integer' });
    expect(rc.findProducers('NumpyArray').map((t) => t.name)).toEqual(['p']);
  });

  it('findConsumers returns tools consuming the given schema', async () => {
    await registerSimple('c', 1, { inputSchema: 'DataFrame', outputSchema: 'Integer' });
    await registerSimple('d', 1);
    expect(rc.findConsumers('DataFrame').map((t) => t.name)).toEqual(['c']);
  });
});

describe('RegistryClient — rebuildFromFilesystem', () => {
  let tmpRoot: string;
  let sourceDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-rebuild-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-src-rebuild-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('repopulates the DB after registry.db is deleted', async () => {
    const dir = path.join(sourceDir, 'alpha');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tool.yaml'),
      `name: alpha
version: 1
change_type: net_new
description: d
inputs:
  a:
    schema: Integer
    required: true
outputs:
  r:
    schema: Integer
implementation:
  language: python
  entry_point: tool.py:run
`,
    );
    fs.writeFileSync(path.join(dir, 'tool.py'), 'def run(a):\n    return {"r": a}\n');

    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    const regResult = await rc1.register({ manifestPath: path.join(dir, 'tool.yaml'), caller: 'human' });
    expect(regResult.success).toBe(true);
    rc1.close();

    // Delete the DB but leave the tools directory intact.
    fs.rmSync(path.join(tmpRoot, 'registry.db'), { force: true });

    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    const got = rc2.get('alpha');
    expect(got).not.toBeNull();
    expect(got?.version).toBe(1);
    rc2.close();
  });

  it('rebuildFromFilesystem is idempotent when called explicitly', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    await rc.rebuildFromFilesystem();
    await rc.rebuildFromFilesystem();
    expect(rc.list()).toEqual([]);
    rc.close();
  });
});

describe('RegistryClient — runner deployment', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-rc-runner-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('copies runner.py to the registry root on initialize', async () => {
    const rc = new RegistryClient({ rootDir: tmpRoot });
    await rc.initialize();
    const dest = path.join(tmpRoot, 'runner.py');
    expect(fs.existsSync(dest)).toBe(true);
    const body = fs.readFileSync(dest, 'utf8');
    expect(body).toMatch(/Plurics tool runner/);
    rc.close();
  });

  it('does not rewrite runner.py when the source is unchanged', async () => {
    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    const dest = path.join(tmpRoot, 'runner.py');
    const mtimeBefore = fs.statSync(dest).mtimeMs;
    rc1.close();
    // Small sleep so mtime has a chance to differ if we do rewrite.
    await new Promise((r) => setTimeout(r, 30));
    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    const mtimeAfter = fs.statSync(dest).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
    rc2.close();
  });

  it('rewrites runner.py when its content changed', async () => {
    const rc1 = new RegistryClient({ rootDir: tmpRoot });
    await rc1.initialize();
    rc1.close();
    // Simulate a stale local copy.
    fs.writeFileSync(path.join(tmpRoot, 'runner.py'), '# stale\n');
    const rc2 = new RegistryClient({ rootDir: tmpRoot });
    await rc2.initialize();
    const body = fs.readFileSync(path.join(tmpRoot, 'runner.py'), 'utf8');
    expect(body).toMatch(/Plurics tool runner/);
    rc2.close();
  });
});
