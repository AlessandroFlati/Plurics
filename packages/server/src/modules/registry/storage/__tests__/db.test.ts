import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryDb } from '../db.js';

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

  it('writes schema_version = 1 in registry_meta', () => {
    expect(db.schemaVersion()).toBe(1);
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
      ]),
    );
  });

  it('initialize is idempotent on an already-initialized db', () => {
    db.close();
    const db2 = new RegistryDb(dbPath);
    db2.initialize();
    expect(db2.schemaVersion()).toBe(1);
    db2.close();
  });
});
