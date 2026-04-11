import type { SchemaDef, SchemaEncoding } from '../types.js';
import { BUILTIN_SCHEMAS } from './builtin.js';

export class SchemaRegistry {
  private readonly byName: Map<string, SchemaDef>;

  constructor() {
    this.byName = new Map();
    for (const s of BUILTIN_SCHEMAS) {
      this.byName.set(s.name, s);
    }
  }

  get(name: string): SchemaDef | null {
    return this.byName.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  list(): SchemaDef[] {
    return [...this.byName.values()];
  }

  encodingOf(name: string): SchemaEncoding {
    const s = this.byName.get(name);
    if (!s) {
      throw new Error(`unknown schema: ${name}`);
    }
    return s.encoding;
  }
}
