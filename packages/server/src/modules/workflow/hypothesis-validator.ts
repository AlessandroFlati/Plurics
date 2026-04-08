import type {
  Hypothesis,
  HypothesisPayload,
  VariableRef,
  CausalPayload,
} from './hypothesis-types.js';
import type { DataManifest, ColumnProfile } from './manifest-types.js';

export interface ValidationError {
  field: string;
  rule: string;
  message: string;
}

export function validateHypothesis(
  hypothesis: Hypothesis,
  manifest: DataManifest,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check all variable references exist
  for (const ref of extractVariableRefs(hypothesis)) {
    if (!manifest.columns.some(c => c.name === ref.name)) {
      errors.push({
        field: `variable "${ref.name}"`,
        rule: 'variable_exists',
        message: `Variable "${ref.name}" not found in dataset. Available: ${manifest.columns.map(c => c.name).join(', ')}`,
      });
    }
  }

  // Check transform compatibility
  for (const ref of extractVariableRefs(hypothesis)) {
    const col = manifest.columns.find(c => c.name === ref.name);
    if (!col) continue;

    if (ref.transform === 'log' && col.semantic_type === 'categorical_nominal') {
      errors.push({
        field: `variable "${ref.name}"`,
        rule: 'transform_compatible',
        message: `Cannot apply log transform to categorical variable "${ref.name}"`,
      });
    }

    if (ref.transform === 'log' && col.stats?.min !== undefined && col.stats.min !== null && col.stats.min <= 0) {
      errors.push({
        field: `variable "${ref.name}"`,
        rule: 'transform_domain',
        message: `Log transform on "${ref.name}" requires all positive values, but min=${col.stats.min}`,
      });
    }
  }

  // Check confounders not in payload variables
  const payloadVars = extractPayloadVariableNames(hypothesis.payload);
  for (const conf of hypothesis.confounders) {
    if (payloadVars.includes(conf)) {
      errors.push({
        field: 'confounders',
        rule: 'confounder_independence',
        message: `"${conf}" appears as both a confounder and a primary variable`,
      });
    }
  }

  // Check causal prerequisites
  if (hypothesis.type === 'causal') {
    const payload = hypothesis.payload as CausalPayload;
    if (payload.strategy_hint === 'instrumental_variable' && payload.instruments.length === 0) {
      errors.push({
        field: 'payload.instruments',
        rule: 'iv_requires_instruments',
        message: 'Instrumental variable strategy requires at least one instrument',
      });
    }
    if (payload.strategy_hint === 'granger' && !manifest.metadata.is_time_series) {
      errors.push({
        field: 'payload.strategy_hint',
        rule: 'granger_requires_timeseries',
        message: 'Granger causality requires time series data, but dataset is not temporal',
      });
    }
  }

  // Check effect size metric matches hypothesis type
  const metric = hypothesis.acceptance.min_effect_size.metric;
  if (hypothesis.type === 'association' && metric === 'cohens_d') {
    errors.push({
      field: 'acceptance.min_effect_size',
      rule: 'metric_type_match',
      message: "Cohen's d is for group differences, not associations. Use pearson_r or r_squared.",
    });
  }

  // Check min_observations feasibility
  const availableN = hypothesis.subgroup
    ? manifest.metadata.estimated_subgroup_sizes?.[hypothesis.subgroup.variable] ?? manifest.metadata.row_count
    : manifest.metadata.row_count;
  if (hypothesis.acceptance.min_observations > availableN) {
    errors.push({
      field: 'acceptance.min_observations',
      rule: 'sample_feasibility',
      message: `Requires ${hypothesis.acceptance.min_observations} observations but only ~${availableN} available`,
    });
  }

  return errors;
}

export function extractVariableRefs(hypothesis: Hypothesis): VariableRef[] {
  const refs: VariableRef[] = [];
  const p = hypothesis.payload;

  switch (p.type) {
    case 'association':
      refs.push(p.x, p.y);
      break;
    case 'difference':
      refs.push(p.variable, p.grouping);
      break;
    case 'distribution':
      refs.push(p.variable);
      break;
    case 'causal':
      refs.push(p.treatment, p.outcome);
      break;
    case 'temporal':
      if (p.claim.kind === 'leads') {
        refs.push(p.claim.x, p.claim.y);
      } else if (p.claim.kind === 'cointegrated') {
        refs.push(...p.claim.variables);
      } else {
        refs.push(p.claim.variable);
      }
      break;
    case 'structural':
      if (p.claim.kind === 'clusters_exist') {
        refs.push(...p.claim.variables);
      } else if (p.claim.kind === 'latent_factor') {
        refs.push(...p.claim.observed_variables);
      } else if (p.claim.kind === 'subgroup_effect') {
        refs.push(...p.claim.subgroup_variables);
      }
      break;
  }

  return refs;
}

function extractPayloadVariableNames(payload: HypothesisPayload): string[] {
  switch (payload.type) {
    case 'association':
      return [payload.x.name, payload.y.name];
    case 'difference':
      return [payload.variable.name, payload.grouping.name];
    case 'distribution':
      return [payload.variable.name];
    case 'causal':
      return [payload.treatment.name, payload.outcome.name];
    case 'temporal':
      if (payload.claim.kind === 'leads') return [payload.claim.x.name, payload.claim.y.name];
      if (payload.claim.kind === 'cointegrated') return payload.claim.variables.map(v => v.name);
      return [payload.claim.variable.name];
    case 'structural':
      if (payload.claim.kind === 'clusters_exist') return payload.claim.variables.map(v => v.name);
      if (payload.claim.kind === 'latent_factor') return payload.claim.observed_variables.map(v => v.name);
      if (payload.claim.kind === 'subgroup_effect') return payload.claim.subgroup_variables.map(v => v.name);
      return [];
  }
}
