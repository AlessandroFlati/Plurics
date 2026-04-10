import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { writeJsonAtomic } from './utils.js';

export interface TestRegistryEntry {
  hypothesis_id: string | null;
  test_type: string;
  raw_p_value: number;
  adjusted_p_value: number | null;
  effect_size: number | null;
  significant_after_correction: boolean;
  timestamp: string;
}

export interface TestRegistry {
  budget: number;
  tests_executed: number;
  tests_remaining: number;
  significance_threshold_current: number;
  entries: TestRegistryEntry[];
}

export class Registrar {
  private registryPath: string;

  constructor(workspacePath: string) {
    this.registryPath = path.join(workspacePath, '.plurics', 'shared', 'test-registry.json');
  }

  async initialize(budget: number, baseSignificance: number): Promise<void> {
    const registry: TestRegistry = {
      budget,
      tests_executed: 0,
      tests_remaining: budget,
      significance_threshold_current: baseSignificance,
      entries: [],
    };
    await writeJsonAtomic(this.registryPath, registry);
  }

  async readRegistry(): Promise<TestRegistry> {
    const content = await fs.readFile(this.registryPath, 'utf-8');
    return JSON.parse(content) as TestRegistry;
  }

  async recordTestResult(result: {
    hypothesis_id: string | null;
    test_type: string;
    p_value: number;
    effect_size: number | null;
  }): Promise<void> {
    const registry = await this.readRegistry();

    registry.entries.push({
      hypothesis_id: result.hypothesis_id,
      test_type: result.test_type,
      raw_p_value: result.p_value,
      adjusted_p_value: null,
      effect_size: result.effect_size,
      significant_after_correction: false,
      timestamp: new Date().toISOString(),
    });

    registry.tests_executed = registry.entries.length;
    registry.tests_remaining = registry.budget - registry.tests_executed;

    applyBenjaminiHochberg(registry);

    await writeJsonAtomic(this.registryPath, registry);
  }
}

export function applyBenjaminiHochberg(registry: TestRegistry, alpha = 0.05): void {
  const n = registry.entries.length;
  if (n === 0) return;

  const sorted = registry.entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.raw_p_value - b.entry.raw_p_value);

  // Compute adjusted p-values (step-up)
  for (let rank = 0; rank < sorted.length; rank++) {
    sorted[rank].entry.adjusted_p_value = Math.min(
      1.0,
      sorted[rank].entry.raw_p_value * n / (rank + 1),
    );
  }

  // Enforce monotonicity (adjusted p-values must be non-decreasing from bottom)
  for (let i = sorted.length - 2; i >= 0; i--) {
    sorted[i].entry.adjusted_p_value = Math.min(
      sorted[i].entry.adjusted_p_value!,
      sorted[i + 1].entry.adjusted_p_value!,
    );
  }

  // Update significance flags
  for (const { entry } of sorted) {
    entry.significant_after_correction = entry.adjusted_p_value! <= alpha;
  }

  // Update current threshold
  const lastSignificant = sorted.filter(s => s.entry.significant_after_correction).pop();
  registry.significance_threshold_current = lastSignificant
    ? lastSignificant.entry.raw_p_value
    : alpha / n;
}
