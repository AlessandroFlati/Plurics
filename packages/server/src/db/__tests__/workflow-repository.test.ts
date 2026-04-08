import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorkflowRepository } from '../workflow-repository.js';

let db: Database.Database;
let repo: WorkflowRepository;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE workflow_runs (
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
    CREATE TABLE workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      node_name TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      event TEXT NOT NULL,
      details TEXT
    );
  `);
  repo = new WorkflowRepository(db);
});

afterEach(() => {
  db.close();
});

describe('WorkflowRepository', () => {
  it('creates and retrieves a run', () => {
    const run = repo.createRun({
      id: 'run-test-1',
      workflow_name: 'test-wf',
      workspace_path: '/tmp/test',
      yaml_content: 'name: test',
      status: 'running',
      node_count: 5,
    });
    expect(run.id).toBe('run-test-1');
    expect(run.workflow_name).toBe('test-wf');
    expect(run.node_count).toBe(5);
    expect(run.nodes_completed).toBe(0);
    expect(run.status).toBe('running');
  });

  it('lists runs ordered by started_at DESC', () => {
    repo.createRun({ id: 'run-1', workflow_name: 'wf', workspace_path: '/tmp', yaml_content: '', status: 'running', node_count: 1 });
    repo.createRun({ id: 'run-2', workflow_name: 'wf', workspace_path: '/tmp', yaml_content: '', status: 'running', node_count: 2 });
    const runs = repo.listRuns();
    expect(runs).toHaveLength(2);
  });

  it('updates run status', () => {
    repo.createRun({ id: 'run-1', workflow_name: 'wf', workspace_path: '/tmp', yaml_content: '', status: 'running', node_count: 3 });
    repo.updateRunStatus('run-1', 'completed', 3, 0);
    const run = repo.getRun('run-1')!;
    expect(run.status).toBe('completed');
    expect(run.nodes_completed).toBe(3);
  });

  it('adds and retrieves events', () => {
    repo.createRun({ id: 'run-1', workflow_name: 'wf', workspace_path: '/tmp', yaml_content: '', status: 'running', node_count: 1 });
    repo.addEvent({ run_id: 'run-1', node_name: 'ingestor', from_state: 'pending', to_state: 'ready', event: 'deps_met', details: null });
    repo.addEvent({ run_id: 'run-1', node_name: 'ingestor', from_state: 'ready', to_state: 'spawning', event: 'spawn', details: null });
    const events = repo.getEvents('run-1');
    expect(events).toHaveLength(2);
    expect(events[0].node_name).toBe('ingestor');
    expect(events[0].to_state).toBe('ready');
    expect(events[1].to_state).toBe('spawning');
  });
});
