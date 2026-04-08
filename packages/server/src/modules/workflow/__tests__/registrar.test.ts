import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Registrar, applyBenjaminiHochberg } from '../registrar.js';
import type { TestRegistry } from '../registrar.js';

describe('applyBenjaminiHochberg', () => {
  it('handles empty entries', () => {
    const registry: TestRegistry = {
      budget: 10, tests_executed: 0, tests_remaining: 10,
      significance_threshold_current: 0.05, entries: [],
    };
    applyBenjaminiHochberg(registry);
    expect(registry.entries).toHaveLength(0);
  });

  it('corrects a single p-value', () => {
    const registry: TestRegistry = {
      budget: 10, tests_executed: 1, tests_remaining: 9,
      significance_threshold_current: 0.05,
      entries: [{
        hypothesis_id: 'H-001', test_type: 't-test', raw_p_value: 0.03,
        adjusted_p_value: null, effect_size: 0.5, significant_after_correction: false,
        timestamp: '2026-01-01',
      }],
    };
    applyBenjaminiHochberg(registry);
    expect(registry.entries[0].adjusted_p_value).toBe(0.03);
    expect(registry.entries[0].significant_after_correction).toBe(true);
  });

  it('corrects multiple p-values with BH procedure', () => {
    const registry: TestRegistry = {
      budget: 10, tests_executed: 4, tests_remaining: 6,
      significance_threshold_current: 0.05,
      entries: [
        { hypothesis_id: 'H-1', test_type: 't', raw_p_value: 0.01, adjusted_p_value: null, effect_size: null, significant_after_correction: false, timestamp: '' },
        { hypothesis_id: 'H-2', test_type: 't', raw_p_value: 0.04, adjusted_p_value: null, effect_size: null, significant_after_correction: false, timestamp: '' },
        { hypothesis_id: 'H-3', test_type: 't', raw_p_value: 0.03, adjusted_p_value: null, effect_size: null, significant_after_correction: false, timestamp: '' },
        { hypothesis_id: 'H-4', test_type: 't', raw_p_value: 0.50, adjusted_p_value: null, effect_size: null, significant_after_correction: false, timestamp: '' },
      ],
    };
    applyBenjaminiHochberg(registry);

    // Sorted by raw: 0.01, 0.03, 0.04, 0.50
    // Adjusted: 0.01*4/1=0.04, 0.03*4/2=0.06, 0.04*4/3=0.053, 0.50*4/4=0.50
    // Monotonicity: 0.04, 0.053, 0.053, 0.50
    // At alpha=0.05: only rank 1 (p=0.01, adj=0.04) is significant

    const byPValue = [...registry.entries].sort((a, b) => a.raw_p_value - b.raw_p_value);
    expect(byPValue[0].adjusted_p_value).toBeCloseTo(0.04, 5);
    expect(byPValue[0].significant_after_correction).toBe(true);
    expect(byPValue[1].significant_after_correction).toBe(false);
    expect(byPValue[3].significant_after_correction).toBe(false);
  });

  it('caps adjusted p-values at 1.0', () => {
    const registry: TestRegistry = {
      budget: 10, tests_executed: 2, tests_remaining: 8,
      significance_threshold_current: 0.05,
      entries: [
        { hypothesis_id: 'H-1', test_type: 't', raw_p_value: 0.80, adjusted_p_value: null, effect_size: null, significant_after_correction: false, timestamp: '' },
        { hypothesis_id: 'H-2', test_type: 't', raw_p_value: 0.90, adjusted_p_value: null, effect_size: null, significant_after_correction: false, timestamp: '' },
      ],
    };
    applyBenjaminiHochberg(registry);
    for (const entry of registry.entries) {
      expect(entry.adjusted_p_value).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('Registrar', () => {
  let tmpDir: string;
  let registrar: Registrar;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caam-reg-'));
    fs.mkdirSync(path.join(tmpDir, '.caam', 'shared'), { recursive: true });
    registrar = new Registrar(tmpDir);
    await registrar.initialize(50, 0.05);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes test registry', async () => {
    const reg = await registrar.readRegistry();
    expect(reg.budget).toBe(50);
    expect(reg.tests_executed).toBe(0);
    expect(reg.tests_remaining).toBe(50);
    expect(reg.entries).toHaveLength(0);
  });

  it('records a test result and updates budget', async () => {
    await registrar.recordTestResult({
      hypothesis_id: 'H-001',
      test_type: 't-test',
      p_value: 0.03,
      effect_size: 0.5,
    });
    const reg = await registrar.readRegistry();
    expect(reg.tests_executed).toBe(1);
    expect(reg.tests_remaining).toBe(49);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0].raw_p_value).toBe(0.03);
    expect(reg.entries[0].adjusted_p_value).not.toBeNull();
  });

  it('applies BH correction across multiple results', async () => {
    await registrar.recordTestResult({ hypothesis_id: 'H-1', test_type: 't', p_value: 0.01, effect_size: null });
    await registrar.recordTestResult({ hypothesis_id: 'H-2', test_type: 't', p_value: 0.80, effect_size: null });
    const reg = await registrar.readRegistry();
    expect(reg.tests_executed).toBe(2);
    const significant = reg.entries.filter(e => e.significant_after_correction);
    expect(significant.length).toBeGreaterThanOrEqual(1);
  });
});
