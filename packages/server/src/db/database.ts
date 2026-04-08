import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DB_DIR = path.join(os.homedir(), '.caam');
const DB_PATH = path.join(DB_DIR, 'caam.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

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
