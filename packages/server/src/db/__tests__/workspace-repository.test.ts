import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorkspaceRepository } from '../workspace-repository.js';

let db: Database.Database;
let repo: WorkspaceRepository;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      label TEXT,
      default_layout TEXT,
      default_terminal_count INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      use_count INTEGER DEFAULT 1
    );
    CREATE TABLE workspace_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      purpose TEXT,
      sort_order INTEGER DEFAULT 0
    );
  `);
  repo = new WorkspaceRepository(db);
});

afterEach(() => {
  db.close();
});

describe('WorkspaceRepository', () => {
  it('creates and lists workspaces', () => {
    repo.create({ path: '/tmp/test1', label: 'Test 1' });
    repo.create({ path: '/tmp/test2', label: 'Test 2' });
    const all = repo.list();
    expect(all).toHaveLength(2);
    expect(all[0].path).toBe('/tmp/test2');
  });

  it('rejects duplicate paths', () => {
    repo.create({ path: '/tmp/dup' });
    expect(() => repo.create({ path: '/tmp/dup' })).toThrow();
  });

  it('selects workspace and bumps usage', () => {
    const ws = repo.create({ path: '/tmp/sel' });
    const before = repo.list()[0];
    expect(before.use_count).toBe(1);
    repo.select(ws.id);
    const after = repo.list()[0];
    expect(after.use_count).toBe(2);
    expect(after.last_used_at).toBeGreaterThanOrEqual(before.last_used_at);
  });

  it('updates workspace label', () => {
    const ws = repo.create({ path: '/tmp/upd' });
    repo.update(ws.id, { label: 'Updated' });
    const updated = repo.list().find(w => w.id === ws.id)!;
    expect(updated.label).toBe('Updated');
  });

  it('deletes workspace and cascades agents', () => {
    const ws = repo.create({ path: '/tmp/del' });
    repo.addAgent(ws.id, { name: 'agent1', purpose: 'test' });
    repo.remove(ws.id);
    expect(repo.list()).toHaveLength(0);
  });

  it('creates workspace with agents', () => {
    const ws = repo.create({
      path: '/tmp/agents',
      agents: [
        { name: 'coder', purpose: 'Write code' },
        { name: 'reviewer', purpose: 'Review code' },
      ],
    });
    const agents = repo.getAgents(ws.id);
    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe('coder');
    expect(agents[1].name).toBe('reviewer');
  });
});
