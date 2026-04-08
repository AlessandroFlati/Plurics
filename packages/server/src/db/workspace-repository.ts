import type Database from 'better-sqlite3';

export interface Workspace {
  id: number;
  path: string;
  label: string | null;
  default_layout: string | null;
  default_terminal_count: number;
  created_at: number;
  last_used_at: number;
  use_count: number;
}

export interface WorkspaceAgent {
  id: number;
  workspace_id: number;
  name: string;
  purpose: string | null;
  sort_order: number;
}

export interface CreateWorkspaceInput {
  path: string;
  label?: string;
  default_layout?: string;
  default_terminal_count?: number;
  agents?: Array<{ name: string; purpose?: string }>;
}

export interface UpdateWorkspaceInput {
  label?: string;
  default_layout?: string;
  default_terminal_count?: number;
}

export class WorkspaceRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateWorkspaceInput): Workspace {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO workspaces (path, label, default_layout, default_terminal_count, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.path,
      input.label ?? null,
      input.default_layout ?? null,
      input.default_terminal_count ?? 1,
      now,
      now,
    );
    const id = result.lastInsertRowid as number;

    if (input.agents) {
      for (let i = 0; i < input.agents.length; i++) {
        this.addAgent(id, { ...input.agents[i], sort_order: i });
      }
    }

    return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace;
  }

  list(): Workspace[] {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY last_used_at DESC, id DESC').all() as Workspace[];
  }

  select(id: number): void {
    this.db.prepare('UPDATE workspaces SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?')
      .run(Date.now(), id);
  }

  update(id: number, input: UpdateWorkspaceInput): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.label !== undefined) { fields.push('label = ?'); values.push(input.label); }
    if (input.default_layout !== undefined) { fields.push('default_layout = ?'); values.push(input.default_layout); }
    if (input.default_terminal_count !== undefined) { fields.push('default_terminal_count = ?'); values.push(input.default_terminal_count); }

    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }

  addAgent(workspaceId: number, agent: { name: string; purpose?: string; sort_order?: number }): WorkspaceAgent {
    const result = this.db.prepare(
      'INSERT INTO workspace_agents (workspace_id, name, purpose, sort_order) VALUES (?, ?, ?, ?)'
    ).run(workspaceId, agent.name, agent.purpose ?? null, agent.sort_order ?? 0);
    return this.db.prepare('SELECT * FROM workspace_agents WHERE id = ?').get(result.lastInsertRowid) as WorkspaceAgent;
  }

  getAgents(workspaceId: number): WorkspaceAgent[] {
    return this.db.prepare('SELECT * FROM workspace_agents WHERE workspace_id = ? ORDER BY sort_order')
      .all(workspaceId) as WorkspaceAgent[];
  }
}
