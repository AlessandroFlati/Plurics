import Database from 'better-sqlite3';
import type { Database as DbType } from 'better-sqlite3';
import type {
  ToolRecord,
  ResolvedPort,
  SchemaDef,
  ListFilters,
  ToolStatus,
  Stability,
  CostClass,
} from '../types.js';

const EXPECTED_SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS registry_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  version         INTEGER NOT NULL,
  description     TEXT,
  category        TEXT,
  tags_json       TEXT,
  entry_point     TEXT NOT NULL,
  language        TEXT NOT NULL,
  requires_json   TEXT,
  stability       TEXT,
  cost_class      TEXT,
  author          TEXT,
  created_at      TEXT NOT NULL,
  tool_hash       TEXT NOT NULL,
  tests_required  INTEGER NOT NULL,
  tests_passed    INTEGER,
  tests_run       INTEGER,
  status          TEXT NOT NULL DEFAULT 'active',
  UNIQUE(name, version)
);

CREATE INDEX IF NOT EXISTS idx_tools_name     ON tools(name);
CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category);
CREATE INDEX IF NOT EXISTS idx_tools_status   ON tools(status);

CREATE TABLE IF NOT EXISTS tool_ports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id      INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL,
  port_name    TEXT NOT NULL,
  schema_name  TEXT NOT NULL,
  required     INTEGER,
  default_json TEXT,
  description  TEXT,
  position     INTEGER NOT NULL,
  UNIQUE(tool_id, direction, port_name)
);

CREATE INDEX IF NOT EXISTS idx_ports_schema ON tool_ports(schema_name, direction);

CREATE TABLE IF NOT EXISTS schemas (
  name                  TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,
  python_representation TEXT,
  encoding              TEXT NOT NULL,
  description           TEXT,
  source                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  version        INTEGER,
  caller         TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  error_message  TEXT,
  tests_run      INTEGER,
  tests_passed   INTEGER,
  duration_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_registration_log_timestamp ON registration_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_registration_log_tool      ON registration_log(tool_name);
`;

export interface RegistrationLogRow {
  timestamp: string;
  toolName: string;
  version: number | null;
  caller: 'seed' | 'human' | 'agent';
  outcome: 'success' | 'failure';
  errorMessage: string | null;
  testsRun: number | null;
  testsPassed: number | null;
  durationMs: number | null;
}

interface ToolRow {
  id: number;
  name: string;
  version: number;
  description: string | null;
  category: string | null;
  tags_json: string | null;
  entry_point: string;
  language: string;
  requires_json: string | null;
  stability: string | null;
  cost_class: string | null;
  author: string | null;
  created_at: string;
  tool_hash: string;
  tests_required: number;
  tests_passed: number | null;
  tests_run: number | null;
  status: string;
}

interface PortRow {
  port_name: string;
  direction: string;
  schema_name: string;
  required: number | null;
  default_json: string | null;
  description: string | null;
  position: number;
}

export class RegistryDb {
  private db: DbType | null = null;

  constructor(private readonly dbPath: string) {}

  initialize(): void {
    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_V1);
    const row = this.db
      .prepare('SELECT value FROM registry_meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    if (row === undefined) {
      this.db
        .prepare('INSERT INTO registry_meta (key, value) VALUES (?, ?)')
        .run('schema_version', String(EXPECTED_SCHEMA_VERSION));
    } else if (Number(row.value) !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(
        `registry.db schema_version ${row.value} is not supported (expected ${EXPECTED_SCHEMA_VERSION})`,
      );
    }
  }

  schemaVersion(): number {
    const row = this.raw()
      .prepare('SELECT value FROM registry_meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    if (!row) throw new Error('schema_version row missing');
    return Number(row.value);
  }

  listTables(): string[] {
    return (this.raw()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>).map((r) => r.name);
  }

  raw(): DbType {
    if (!this.db) throw new Error('RegistryDb not initialized');
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  withTransaction<T>(fn: () => T): T {
    const db = this.raw();
    const wrapped = db.transaction(fn);
    return wrapped();
  }

  // ---------- Tools ----------

  insertTool(record: ToolRecord, testsRun: number, testsPassed: number, testsRequired: boolean): void {
    const db = this.raw();
    const insertToolStmt = db.prepare(`
      INSERT INTO tools (
        name, version, description, category, tags_json,
        entry_point, language, requires_json, stability, cost_class,
        author, created_at, tool_hash, tests_required, tests_passed, tests_run, status
      ) VALUES (
        @name, @version, @description, @category, @tags_json,
        @entry_point, @language, @requires_json, @stability, @cost_class,
        @author, @created_at, @tool_hash, @tests_required, @tests_passed, @tests_run, @status
      )
    `);
    const insertPortStmt = db.prepare(`
      INSERT INTO tool_ports (
        tool_id, direction, port_name, schema_name, required, default_json, description, position
      ) VALUES (
        @tool_id, @direction, @port_name, @schema_name, @required, @default_json, @description, @position
      )
    `);

    const toolInfo = insertToolStmt.run({
      name: record.name,
      version: record.version,
      description: record.description,
      category: record.category,
      tags_json: JSON.stringify(record.tags),
      entry_point: record.entryPoint,
      language: record.language,
      requires_json: JSON.stringify(record.requires),
      stability: record.stability,
      cost_class: record.costClass,
      author: record.author,
      created_at: record.createdAt,
      tool_hash: record.toolHash,
      tests_required: testsRequired ? 1 : 0,
      tests_passed: testsPassed,
      tests_run: testsRun,
      status: record.status,
    });
    const toolId = Number(toolInfo.lastInsertRowid);

    for (const p of record.inputs) {
      insertPortStmt.run({
        tool_id: toolId,
        direction: 'input',
        port_name: p.name,
        schema_name: p.schemaName,
        required: p.required ? 1 : 0,
        default_json: p.default === undefined ? null : JSON.stringify(p.default),
        description: p.description,
        position: p.position,
      });
    }
    for (const p of record.outputs) {
      insertPortStmt.run({
        tool_id: toolId,
        direction: 'output',
        port_name: p.name,
        schema_name: p.schemaName,
        required: null,
        default_json: null,
        description: p.description,
        position: p.position,
      });
    }
  }

  getTool(name: string, version?: number): ToolRecord | null {
    const db = this.raw();
    let row: ToolRow | undefined;
    if (version === undefined) {
      row = db
        .prepare("SELECT * FROM tools WHERE name = ? AND status = 'active' ORDER BY version DESC LIMIT 1")
        .get(name) as ToolRow | undefined;
    } else {
      row = db.prepare('SELECT * FROM tools WHERE name = ? AND version = ?').get(name, version) as ToolRow | undefined;
    }
    if (!row) return null;
    return this.hydrateTool(row);
  }

  getAllVersions(name: string): ToolRecord[] {
    const db = this.raw();
    const rows = db
      .prepare('SELECT * FROM tools WHERE name = ? ORDER BY version DESC')
      .all(name) as ToolRow[];
    return rows.map((r) => this.hydrateTool(r));
  }

  listTools(filters: ListFilters = {}): ToolRecord[] {
    const db = this.raw();
    const statusIn = filters.statusIn ?? ['active'];
    const placeholders = statusIn.map(() => '?').join(',');
    const params: unknown[] = [...statusIn];
    let sql = `SELECT * FROM tools WHERE status IN (${placeholders})`;
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.stability) {
      sql += ' AND stability = ?';
      params.push(filters.stability);
    }
    sql += ' ORDER BY name, version DESC';
    const rows = db.prepare(sql).all(...params) as ToolRow[];
    const hydrated = rows.map((r) => this.hydrateTool(r));
    if (filters.tags && filters.tags.length > 0) {
      const required = new Set(filters.tags);
      return hydrated.filter((t) => {
        const have = new Set(t.tags);
        for (const tag of required) if (!have.has(tag)) return false;
        return true;
      });
    }
    return hydrated;
  }

  findProducers(schemaName: string): ToolRecord[] {
    return this.findByPortSchema(schemaName, 'output');
  }

  findConsumers(schemaName: string): ToolRecord[] {
    return this.findByPortSchema(schemaName, 'input');
  }

  private findByPortSchema(schemaName: string, direction: 'input' | 'output'): ToolRecord[] {
    const db = this.raw();
    const rows = db
      .prepare(
        `SELECT DISTINCT tools.* FROM tools
           JOIN tool_ports ON tool_ports.tool_id = tools.id
          WHERE tool_ports.schema_name = ? AND tool_ports.direction = ? AND tools.status = 'active'
          ORDER BY tools.name, tools.version DESC`,
      )
      .all(schemaName, direction) as ToolRow[];
    return rows.map((r) => this.hydrateTool(r));
  }

  private hydrateTool(row: ToolRow): ToolRecord {
    const db = this.raw();
    const ports = db
      .prepare(
        'SELECT port_name, direction, schema_name, required, default_json, description, position FROM tool_ports WHERE tool_id = ? ORDER BY direction, position',
      )
      .all(row.id) as PortRow[];
    const inputs: ResolvedPort[] = [];
    const outputs: ResolvedPort[] = [];
    for (const p of ports) {
      const resolved: ResolvedPort = {
        name: p.port_name,
        direction: p.direction as 'input' | 'output',
        schemaName: p.schema_name,
        required: p.required === 1,
        default: p.default_json === null ? undefined : JSON.parse(p.default_json),
        description: p.description,
        position: p.position,
      };
      if (p.direction === 'input') inputs.push(resolved);
      else outputs.push(resolved);
    }
    return {
      name: row.name,
      version: row.version,
      description: row.description ?? '',
      category: row.category,
      tags: row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [],
      inputs,
      outputs,
      entryPoint: row.entry_point,
      language: 'python',
      requires: row.requires_json ? (JSON.parse(row.requires_json) as string[]) : [],
      stability: row.stability as Stability | null,
      costClass: row.cost_class as CostClass | null,
      author: row.author,
      createdAt: row.created_at,
      toolHash: row.tool_hash,
      status: row.status as ToolStatus,
      directory: '', // filled in by the client layer which knows the layout
    };
  }

  // ---------- Schemas ----------

  insertSchema(schema: SchemaDef): void {
    this.raw()
      .prepare(
        `INSERT OR REPLACE INTO schemas (name, kind, python_representation, encoding, description, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        schema.name,
        schema.kind,
        schema.pythonRepresentation,
        schema.encoding,
        schema.description,
        schema.source,
      );
  }

  listSchemas(): SchemaDef[] {
    const rows = this.raw()
      .prepare('SELECT * FROM schemas ORDER BY name')
      .all() as Array<{
        name: string;
        kind: string;
        python_representation: string | null;
        encoding: string;
        description: string | null;
        source: string;
      }>;
    return rows.map((r) => ({
      name: r.name,
      kind: r.kind as 'primitive' | 'structured',
      pythonRepresentation: r.python_representation,
      encoding: r.encoding as 'json_literal' | 'pickle_b64',
      description: r.description,
      source: r.source as 'builtin' | 'user',
    }));
  }

  // ---------- Registration log ----------

  appendRegistrationLog(row: RegistrationLogRow): void {
    this.raw()
      .prepare(
        `INSERT INTO registration_log
         (timestamp, tool_name, version, caller, outcome, error_message, tests_run, tests_passed, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.timestamp,
        row.toolName,
        row.version,
        row.caller,
        row.outcome,
        row.errorMessage,
        row.testsRun,
        row.testsPassed,
        row.durationMs,
      );
  }
}
