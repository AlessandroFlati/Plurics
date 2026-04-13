import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryClient } from '../registry-client.js';
import { loadSeedTools } from '../seeds/loader.js';

// --- helpers ---
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-converter-test-'));
}

function writeConverterFixture(
  sourceDir: string,
  name: string,
  version: number,
  sourceSchema: string,
  targetSchema: string,
): string {
  const dir = path.join(sourceDir, `${name}-v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  const changeType = version === 1 ? 'net_new' : 'additive';
  fs.writeFileSync(
    path.join(dir, 'tool.yaml'),
    `name: ${name}
version: ${version}
change_type: ${changeType}
description: Test converter from ${sourceSchema} to ${targetSchema}.
category: converter
inputs:
  source:
    schema: ${sourceSchema}
    required: true
    description: Input value.
outputs:
  target:
    schema: ${targetSchema}
    description: Output value.
implementation:
  language: python
  entry_point: tool.py:run
metadata:
  stability: stable
  is_converter: true
  source_schema: ${sourceSchema}
  target_schema: ${targetSchema}
`,
  );
  fs.writeFileSync(
    path.join(dir, 'tool.py'),
    'def run(source):\n    return {"target": source}\n',
  );
  return path.join(dir, 'tool.yaml');
}

function writeNonConverterFixture(sourceDir: string, name: string): string {
  const dir = path.join(sourceDir, `${name}-v1`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tool.yaml'),
    `name: ${name}
version: 1
change_type: net_new
description: Normal (non-converter) tool.
category: testing
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

describe('converter registry', () => {
  let dir: string;
  let sourceDir: string;
  let client: RegistryClient;

  beforeEach(async () => {
    dir = tempDir();
    sourceDir = tempDir();
    client = new RegistryClient({ rootDir: dir });
    await client.initialize();
  });

  afterEach(() => {
    client.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('findConverter returns null when no converter is registered', () => {
    expect(client.findConverter('DataFrame', 'NumpyArray')).toBeNull();
  });

  it('findConverter returns record after a converter tool is registered', async () => {
    const manifestPath = writeConverterFixture(
      sourceDir,
      'convert.A_to_B',
      1,
      'NumpyArray',
      'DataFrame',
    );
    const result = await client.register({ manifestPath, caller: 'human' });
    expect(result.success).toBe(true);

    const rec = client.findConverter('NumpyArray', 'DataFrame');
    expect(rec).not.toBeNull();
    expect(rec!.sourceSchema).toBe('NumpyArray');
    expect(rec!.targetSchema).toBe('DataFrame');
    expect(rec!.toolName).toBe('convert.A_to_B');
    expect(rec!.toolVersion).toBe(1);
  });

  it('INSERT OR REPLACE semantics: second registration for same pair wins', async () => {
    // Register v1
    const manifestV1 = writeConverterFixture(
      sourceDir,
      'convert.A_to_B',
      1,
      'NumpyArray',
      'DataFrame',
    );
    const r1 = await client.register({ manifestPath: manifestV1, caller: 'human' });
    expect(r1.success).toBe(true);

    // Register v2 (same pair, different version)
    const dirV2 = path.join(sourceDir, 'convert.A_to_B-v2-new');
    fs.mkdirSync(dirV2, { recursive: true });
    fs.writeFileSync(
      path.join(dirV2, 'tool.yaml'),
      `name: convert.A_to_B
version: 2
change_type: additive
description: Updated converter.
category: converter
inputs:
  source:
    schema: NumpyArray
    required: true
outputs:
  target:
    schema: DataFrame
implementation:
  language: python
  entry_point: tool.py:run
metadata:
  stability: stable
  is_converter: true
  source_schema: NumpyArray
  target_schema: DataFrame
`,
    );
    fs.writeFileSync(
      path.join(dirV2, 'tool.py'),
      'def run(source):\n    return {"target": source}\n',
    );
    const r2 = await client.register({
      manifestPath: path.join(dirV2, 'tool.yaml'),
      caller: 'human',
    });
    expect(r2.success).toBe(true);

    const rec = client.findConverter('NumpyArray', 'DataFrame');
    expect(rec).not.toBeNull();
    expect(rec!.toolVersion).toBe(2);
  });

  it('converter table populated for is_converter: true manifest', async () => {
    const manifestPath = writeConverterFixture(
      sourceDir,
      'convert.NumpyArray_to_DataFrame',
      1,
      'NumpyArray',
      'DataFrame',
    );
    const result = await client.register({ manifestPath, caller: 'human' });
    expect(result.success).toBe(true);

    const rec = client.findConverter('NumpyArray', 'DataFrame');
    expect(rec).not.toBeNull();
    expect(rec!.toolName).toBe('convert.NumpyArray_to_DataFrame');
  });

  it('non-converter tool does not populate converter table', async () => {
    const manifestPath = writeNonConverterFixture(sourceDir, 'test.plain_tool');
    const result = await client.register({ manifestPath, caller: 'human' });
    expect(result.success).toBe(true);

    // A non-converter tool should not appear in converter lookups
    expect(client.findConverter('Integer', 'Integer')).toBeNull();
  });

  it('rejects is_converter manifest with mismatched port schemas', async () => {
    const dir2 = path.join(sourceDir, 'bad-converter');
    fs.mkdirSync(dir2, { recursive: true });
    // source_schema says NumpyArray, but input port schema is Integer
    fs.writeFileSync(
      path.join(dir2, 'tool.yaml'),
      `name: convert.bad
version: 1
change_type: net_new
description: Bad converter with mismatched schemas.
category: converter
inputs:
  source:
    schema: Integer
    required: true
outputs:
  target:
    schema: DataFrame
implementation:
  language: python
  entry_point: tool.py:run
metadata:
  stability: stable
  is_converter: true
  source_schema: NumpyArray
  target_schema: DataFrame
`,
    );
    fs.writeFileSync(
      path.join(dir2, 'tool.py'),
      'def run(source):\n    return {"target": source}\n',
    );
    const result = await client.register({
      manifestPath: path.join(dir2, 'tool.yaml'),
      caller: 'human',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const msgs = result.errors.map((e) => e.message).join(' ');
    expect(msgs).toMatch(/source_schema.*NumpyArray/);
  });
});

describe('converter registry — seed-loaded integration', () => {
  let dir: string;
  let client: RegistryClient;

  beforeEach(async () => {
    dir = tempDir();
    client = new RegistryClient({ rootDir: dir });
    await client.initialize();
    await loadSeedTools(client);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('findConverter returns convert.DataFrame_to_NumpyArray after seed loading', () => {
    const rec = client.findConverter('DataFrame', 'NumpyArray');
    expect(rec).not.toBeNull();
    expect(rec!.toolName).toBe('convert.DataFrame_to_NumpyArray');
    expect(rec!.sourceSchema).toBe('DataFrame');
    expect(rec!.targetSchema).toBe('NumpyArray');
  });

  it('findConverter returns convert.NumpyArray_to_DataFrame after seed loading', () => {
    const rec = client.findConverter('NumpyArray', 'DataFrame');
    expect(rec).not.toBeNull();
    expect(rec!.toolName).toBe('convert.NumpyArray_to_DataFrame');
    expect(rec!.sourceSchema).toBe('NumpyArray');
    expect(rec!.targetSchema).toBe('DataFrame');
  });

  it('findConverter returns convert.OhlcFrame_to_ReturnSeries after seed loading', () => {
    const rec = client.findConverter('OhlcFrame', 'ReturnSeries');
    expect(rec).not.toBeNull();
    expect(rec!.toolName).toBe('convert.OhlcFrame_to_ReturnSeries');
    expect(rec!.sourceSchema).toBe('OhlcFrame');
    expect(rec!.targetSchema).toBe('ReturnSeries');
  });
});
