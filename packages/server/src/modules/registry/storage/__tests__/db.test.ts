import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryDb } from '../db.js';
import type { ToolRecord, ResolvedPort, SchemaDef } from '../../types.js';

describe('RegistryDb — schema', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: RegistryDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-db-'));
    dbPath = path.join(tmpDir, 'r.db');
    db = new RegistryDb(dbPath);
    db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the database file', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('writes schema_version = 3 in registry_meta', () => {
    expect(db.schemaVersion()).toBe(3);
  });

  it('creates all expected tables', () => {
    const tables = db.listTables();
    expect(tables).toEqual(
      expect.arrayContaining([
        'tools',
        'tool_ports',
        'schemas',
        'registration_log',
        'registry_meta',
        'converters',
        'tool_invocations',
      ]),
    );
  });

  it('initialize is idempotent on an already-initialized db', () => {
    db.close();
    const db2 = new RegistryDb(dbPath);
    db2.initialize();
    expect(db2.schemaVersion()).toBe(3);
    db2.close();
  });
});

function sampleTool(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return {
    name: 'test.thing',
    version: 1,
    description: 'd',
    category: 'testing',
    tags: ['fixture'],
    inputs: [
      { name: 'a', direction: 'input', schemaName: 'Integer', required: true, default: undefined, description: null, position: 0 },
    ],
    outputs: [
      { name: 'r', direction: 'output', schemaName: 'Integer', required: false, default: undefined, description: null, position: 0 },
    ],
    entryPoint: 'tool.py:run',
    language: 'python',
    requires: [],
    stability: 'stable',
    costClass: 'fast',
    author: 'test',
    createdAt: '2026-04-11T00:00:00Z',
    changeType: 'net_new',
    toolHash: 'deadbeef',
    status: 'active',
    directory: '/tmp/test.thing/v1',
    ...overrides,
  };
}

describe('RegistryDb — tool CRUD', () => {
  let tmpDir: string;
  let db: RegistryDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-db-crud-'));
    db = new RegistryDb(path.join(tmpDir, 'r.db'));
    db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('insertTool persists a tool and its ports', () => {
    db.insertTool(sampleTool(), 0, 0, true);
    const got = db.getTool('test.thing');
    expect(got).not.toBeNull();
    expect(got!.name).toBe('test.thing');
    expect(got!.inputs).toHaveLength(1);
    expect(got!.inputs[0].schemaName).toBe('Integer');
    expect(got!.outputs).toHaveLength(1);
  });

  it('getTool returns null when missing', () => {
    expect(db.getTool('nope')).toBeNull();
  });

  it('getTool returns the latest active version when version omitted', () => {
    db.insertTool(sampleTool({ version: 1 }), 0, 0, false);
    db.insertTool(sampleTool({ version: 2, toolHash: 'feedbeef' }), 0, 0, false);
    expect(db.getTool('test.thing')!.version).toBe(2);
  });

  it('getTool respects explicit version', () => {
    db.insertTool(sampleTool({ version: 1 }), 0, 0, false);
    db.insertTool(sampleTool({ version: 2, toolHash: 'feedbeef' }), 0, 0, false);
    expect(db.getTool('test.thing', 1)!.version).toBe(1);
  });

  it('insertTool rejects duplicate (name, version)', () => {
    db.insertTool(sampleTool(), 0, 0, false);
    expect(() => db.insertTool(sampleTool(), 0, 0, false)).toThrow();
  });

  it('listTools returns active tools by default', () => {
    db.insertTool(sampleTool({ name: 'a' }), 0, 0, false);
    db.insertTool(sampleTool({ name: 'b' }), 0, 0, false);
    expect(db.listTools().map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('listTools filters by category', () => {
    db.insertTool(sampleTool({ name: 'a', category: 'x' }), 0, 0, false);
    db.insertTool(sampleTool({ name: 'b', category: 'y' }), 0, 0, false);
    expect(db.listTools({ category: 'x' }).map((t) => t.name)).toEqual(['a']);
  });

  it('findProducers returns tools with matching output schema', () => {
    const t = sampleTool({
      name: 'p',
      outputs: [{ name: 'arr', direction: 'output', schemaName: 'NumpyArray', required: false, default: undefined, description: null, position: 0 }],
    });
    db.insertTool(t, 0, 0, false);
    db.insertTool(sampleTool({ name: 'q' }), 0, 0, false);
    expect(db.findProducers('NumpyArray').map((r) => r.name)).toEqual(['p']);
  });

  it('findConsumers returns tools with matching input schema', () => {
    const t = sampleTool({
      name: 'c',
      inputs: [{ name: 'df', direction: 'input', schemaName: 'DataFrame', required: true, default: undefined, description: null, position: 0 }],
    });
    db.insertTool(t, 0, 0, false);
    expect(db.findConsumers('DataFrame').map((r) => r.name)).toEqual(['c']);
  });

  it('insertSchema + listSchemas round-trip', () => {
    const s: SchemaDef = { name: 'Integer', kind: 'primitive', pythonRepresentation: 'int', encoding: 'json_literal', description: null, source: 'builtin' };
    db.insertSchema(s);
    expect(db.listSchemas()).toEqual([s]);
  });

  it('appendRegistrationLog writes an auditable row', () => {
    db.appendRegistrationLog({
      timestamp: '2026-04-11T00:00:00Z',
      toolName: 'x',
      version: 1,
      caller: 'human',
      outcome: 'success',
      errorMessage: null,
      testsRun: 0,
      testsPassed: 0,
      durationMs: 10,
    });
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM registration_log').get()).toEqual({ n: 1 });
  });

  it('withTransaction rolls back on error', () => {
    expect(() => {
      db.withTransaction(() => {
        db.insertTool(sampleTool({ name: 'rollback' }), 0, 0, false);
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(db.getTool('rollback')).toBeNull();
  });
});
