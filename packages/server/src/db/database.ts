import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DB_DIR = path.join(os.homedir(), '.plurics');
const DB_PATH = path.join(DB_DIR, 'plurics.db');

// Legacy paths — migrated on first start
const LEGACY_DB_DIR = path.join(os.homedir(), '.caam');
const LEGACY_DB_PATH = path.join(LEGACY_DB_DIR, 'caam.db');

let db: Database.Database | null = null;

/**
 * One-time migration: copy ~/.caam/caam.db to ~/.plurics/plurics.db if the
 * legacy exists and the new location does not. The legacy file is left in
 * place as a safety net — user can delete it manually once satisfied.
 */
function migrateLegacyDb(): void {
  if (fs.existsSync(DB_PATH)) return;
  if (!fs.existsSync(LEGACY_DB_PATH)) return;
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  // Copy WAL / SHM sidecars if present so SQLite sees a consistent state
  for (const ext of ['-wal', '-shm']) {
    const legacySidecar = LEGACY_DB_PATH + ext;
    if (fs.existsSync(legacySidecar)) {
      fs.copyFileSync(legacySidecar, DB_PATH + ext);
    }
  }
  console.log(`[plurics] Migrated legacy DB from ${LEGACY_DB_PATH} to ${DB_PATH}`);
}

export function getDb(): Database.Database {
  if (db) return db;

  migrateLegacyDb();
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      label TEXT,
      default_layout TEXT,
      default_terminal_count INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      use_count INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS workspace_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      purpose TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_presets (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      purpose TEXT NOT NULL,
      use_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      yaml_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      node_count INTEGER NOT NULL,
      nodes_completed INTEGER NOT NULL DEFAULT 0,
      nodes_failed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      node_name TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      event TEXT NOT NULL,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_events_run ON workflow_events(run_id);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
