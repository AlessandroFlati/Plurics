import type Database from 'better-sqlite3';

export interface WorkflowRun {
  id: string;
  workflow_name: string;
  workspace_path: string;
  yaml_content: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  started_at: string;
  completed_at: string | null;
  node_count: number;
  nodes_completed: number;
  nodes_failed: number;
}

export interface WorkflowEvent {
  id: number;
  run_id: string;
  timestamp: string;
  node_name: string;
  from_state: string;
  to_state: string;
  event: string;
  details: string | null;
}

export class WorkflowRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createRun(run: Omit<WorkflowRun, 'started_at' | 'completed_at' | 'nodes_completed' | 'nodes_failed'>): WorkflowRun {
    this.db.prepare(
      `INSERT INTO workflow_runs (id, workflow_name, workspace_path, yaml_content, status, node_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(run.id, run.workflow_name, run.workspace_path, run.yaml_content, run.status, run.node_count);
    return this.getRun(run.id)!;
  }

  getRun(id: string): WorkflowRun | undefined {
    return this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as WorkflowRun | undefined;
  }

  listRuns(): WorkflowRun[] {
    return this.db.prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC').all() as WorkflowRun[];
  }

  updateRunStatus(id: string, status: WorkflowRun['status'], nodesCompleted: number, nodesFailed: number): void {
    const isTerminal = ['completed', 'failed', 'aborted'].includes(status);
    if (isTerminal) {
      this.db.prepare(
        `UPDATE workflow_runs SET status = ?, nodes_completed = ?, nodes_failed = ?, completed_at = datetime('now') WHERE id = ?`
      ).run(status, nodesCompleted, nodesFailed, id);
    } else {
      this.db.prepare(
        `UPDATE workflow_runs SET status = ?, nodes_completed = ?, nodes_failed = ? WHERE id = ?`
      ).run(status, nodesCompleted, nodesFailed, id);
    }
  }

  addEvent(event: Omit<WorkflowEvent, 'id' | 'timestamp'>): void {
    this.db.prepare(
      `INSERT INTO workflow_events (run_id, node_name, from_state, to_state, event, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(event.run_id, event.node_name, event.from_state, event.to_state, event.event, event.details);
  }

  listResumableRuns(): WorkflowRun[] {
    return this.db.prepare(
      `SELECT * FROM workflow_runs WHERE status IN ('running', 'aborted') ORDER BY started_at DESC`
    ).all() as WorkflowRun[];
  }

  getEvents(runId: string): WorkflowEvent[] {
    return this.db.prepare(
      'SELECT * FROM workflow_events WHERE run_id = ? ORDER BY id ASC'
    ).all(runId) as WorkflowEvent[];
  }
}
