import { describe, it, expect } from 'vitest';
import { validateHypothesis } from '../hypothesis-validator.js';
import type { Hypothesis } from '../hypothesis-types.js';
import type { DataManifest } from '../manifest-types.js';

function makeManifest(overrides: Partial<DataManifest> = {}): DataManifest {
  return {
    manifest_version: 1,
    generated_at: '2026-01-01',
    metadata: {
      source_file: 'test.csv',
      format: 'csv',
      row_count: 10000,
      column_count: 5,
      memory_bytes: 1000000,
      is_time_series: false,
      time_column: null,
      time_range: null,
      time_frequency: null,
      has_natural_experiment: false,
      natural_experiment_hint: null,
      estimated_subgroup_sizes: null,
    },
    columns: [
      { name: 'x1', position: 0, dtype: 'float64', inferred_type: 'numeric', semantic_type: 'continuous', total_count: 10000, missing_count: 0, missing_pct: 0, n_unique: 9500, is_unique: false, stats: { mean: 5, median: 5, std: 2, min: 0.1, max: 20, p25: 3, p75: 7, skewness: 0.5, kurtosis: 0, top_values: null, date_min: null, date_max: null, date_frequency: null, date_gaps: null }, distribution: null, sample_values: [1, 2, 3], anomalies: [] },
      { name: 'y1', position: 1, dtype: 'float64', inferred_type: 'numeric', semantic_type: 'continuous', total_count: 10000, missing_count: 0, missing_pct: 0, n_unique: 9000, is_unique: false, stats: { mean: 10, median: 10, std: 3, min: -5, max: 30, p25: 8, p75: 12, skewness: 0, kurtosis: 0, top_values: null, date_min: null, date_max: null, date_frequency: null, date_gaps: null }, distribution: null, sample_values: [8, 10, 12], anomalies: [] },
      { name: 'cat1', position: 2, dtype: 'object', inferred_type: 'categorical', semantic_type: 'categorical_nominal', total_count: 10000, missing_count: 0, missing_pct: 0, n_unique: 3, is_unique: false, stats: { mean: null, median: null, std: null, min: null, max: null, p25: null, p75: null, skewness: null, kurtosis: null, top_values: [{ value: 'A', count: 5000, pct: 50 }], date_min: null, date_max: null, date_frequency: null, date_gaps: null }, distribution: null, sample_values: ['A', 'B', 'C'], anomalies: [] },
      { name: 'z1', position: 3, dtype: 'float64', inferred_type: 'numeric', semantic_type: 'continuous', total_count: 10000, missing_count: 0, missing_pct: 0, n_unique: 8000, is_unique: false, stats: { mean: 0, median: 0, std: 1, min: -3, max: 3, p25: -0.7, p75: 0.7, skewness: 0, kurtosis: 0, top_values: null, date_min: null, date_max: null, date_frequency: null, date_gaps: null }, distribution: null, sample_values: [-1, 0, 1], anomalies: [] },
      { name: 'treatment', position: 4, dtype: 'int64', inferred_type: 'numeric', semantic_type: 'binary', total_count: 10000, missing_count: 0, missing_pct: 0, n_unique: 2, is_unique: false, stats: { mean: 0.5, median: 0, std: 0.5, min: 0, max: 1, p25: 0, p75: 1, skewness: 0, kurtosis: 0, top_values: null, date_min: null, date_max: null, date_frequency: null, date_gaps: null }, distribution: null, sample_values: [0, 1], anomalies: [] },
    ],
    correlations: [],
    collinearity_groups: [],
    quality: { overall_score: 90, issues: [], duplicate_rows: 0, near_duplicate_rows: 0, missing_pattern: 'none', missing_correlation: [] },
    leads: [],
    ...overrides,
  };
}

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    hypothesis_id: 'H-001',
    batch: 1,
    claim: 'Test claim',
    type: 'association',
    payload: {
      type: 'association',
      x: { name: 'x1' },
      y: { name: 'y1' },
      direction: 'positive',
      linearity: 'linear',
      interaction_with: null,
    },
    subgroup: null,
    confounders: ['z1'],
    acceptance: {
      max_p_value: 0.05,
      min_effect_size: { metric: 'pearson_r', threshold: 0.15 },
      min_observations: 100,
    },
    adversary_review: null,
    judge_verdict: null,
    test_result: null,
    falsification_result: null,
    generalization: null,
    ...overrides,
  };
}

describe('validateHypothesis', () => {
  it('passes for a valid hypothesis', () => {
    const errors = validateHypothesis(makeHypothesis(), makeManifest());
    expect(errors).toHaveLength(0);
  });

  it('detects unknown variable', () => {
    const h = makeHypothesis({
      payload: { type: 'association', x: { name: 'nonexistent' }, y: { name: 'y1' }, direction: 'any', linearity: 'any', interaction_with: null },
    });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors.some(e => e.rule === 'variable_exists' && e.field.includes('nonexistent'))).toBe(true);
  });

  it('detects log transform on categorical', () => {
    const h = makeHypothesis({
      payload: { type: 'association', x: { name: 'cat1', transform: 'log' }, y: { name: 'y1' }, direction: 'any', linearity: 'any', interaction_with: null },
    });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors.some(e => e.rule === 'transform_compatible')).toBe(true);
  });

  it('detects log transform on variable with negative values', () => {
    const h = makeHypothesis({
      payload: { type: 'association', x: { name: 'y1', transform: 'log' }, y: { name: 'x1' }, direction: 'any', linearity: 'any', interaction_with: null },
    });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors.some(e => e.rule === 'transform_domain')).toBe(true);
  });

  it('detects confounder that is also a primary variable', () => {
    const h = makeHypothesis({ confounders: ['x1'] });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors.some(e => e.rule === 'confounder_independence')).toBe(true);
  });

  it('detects cohens_d on association hypothesis', () => {
    const h = makeHypothesis({
      acceptance: { max_p_value: 0.05, min_effect_size: { metric: 'cohens_d', threshold: 0.2 }, min_observations: 100 },
    });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors.some(e => e.rule === 'metric_type_match')).toBe(true);
  });

  it('detects IV strategy without instruments', () => {
    const h = makeHypothesis({
      type: 'causal',
      payload: {
        type: 'causal',
        treatment: { name: 'treatment' },
        outcome: { name: 'y1' },
        mechanism: null,
        strategy_hint: 'instrumental_variable',
        instruments: [],
        mediators: [],
      },
      acceptance: { max_p_value: 0.05, min_effect_size: { metric: 'cohens_d', threshold: 0.2 }, min_observations: 100 },
    });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors.some(e => e.rule === 'iv_requires_instruments')).toBe(true);
  });

  it('detects granger on non-timeseries data', () => {
    const h = makeHypothesis({
      type: 'causal',
      payload: {
        type: 'causal',
        treatment: { name: 'treatment' },
        outcome: { name: 'y1' },
        mechanism: null,
        strategy_hint: 'granger',
        instruments: [],
        mediators: [],
      },
      acceptance: { max_p_value: 0.05, min_effect_size: { metric: 'cohens_d', threshold: 0.2 }, min_observations: 100 },
    });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors.some(e => e.rule === 'granger_requires_timeseries')).toBe(true);
  });

  it('detects infeasible min_observations', () => {
    const h = makeHypothesis({
      acceptance: { max_p_value: 0.05, min_effect_size: { metric: 'pearson_r', threshold: 0.15 }, min_observations: 999999 },
    });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors.some(e => e.rule === 'sample_feasibility')).toBe(true);
  });

  it('validates causal hypothesis with valid backdoor', () => {
    const h = makeHypothesis({
      type: 'causal',
      payload: {
        type: 'causal',
        treatment: { name: 'treatment' },
        outcome: { name: 'y1' },
        mechanism: null,
        strategy_hint: 'backdoor',
        instruments: [],
        mediators: [],
      },
      confounders: ['z1'],
      acceptance: { max_p_value: 0.05, min_effect_size: { metric: 'cohens_d', threshold: 0.2 }, min_observations: 100 },
    });
    const errors = validateHypothesis(h, makeManifest());
    expect(errors).toHaveLength(0);
  });
});
