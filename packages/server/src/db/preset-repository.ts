import type Database from 'better-sqlite3';

export interface AgentPreset {
  id: number;
  name: string;
  purpose: string;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePresetInput {
  name: string;
  purpose: string;
}

export interface UpdatePresetInput {
  name?: string;
  purpose?: string;
}

export class PresetRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  list(): AgentPreset[] {
    return this.db.prepare(
      'SELECT * FROM agent_presets ORDER BY use_count DESC, updated_at DESC'
    ).all() as AgentPreset[];
  }

  getById(id: number): AgentPreset | undefined {
    return this.db.prepare('SELECT * FROM agent_presets WHERE id = ?').get(id) as AgentPreset | undefined;
  }

  create(input: CreatePresetInput): AgentPreset {
    const stmt = this.db.prepare(
      "INSERT INTO agent_presets (name, purpose, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))"
    );
    const result = stmt.run(input.name, input.purpose);
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, input: UpdatePresetInput): void {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];
    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.purpose !== undefined) { fields.push('purpose = ?'); values.push(input.purpose); }
    values.push(id);
    this.db.prepare(`UPDATE agent_presets SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM agent_presets WHERE id = ?').run(id);
  }

  incrementUseCount(id: number): void {
    this.db.prepare(
      "UPDATE agent_presets SET use_count = use_count + 1, updated_at = datetime('now') WHERE id = ?"
    ).run(id);
  }
}
