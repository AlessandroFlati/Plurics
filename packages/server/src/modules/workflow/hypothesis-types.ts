// --- Hypothesis DSL ---

export interface Hypothesis {
  hypothesis_id: string;
  batch: number;
  claim: string;
  type: HypothesisType;
  payload: HypothesisPayload;
  subgroup: SubgroupFilter | null;
  confounders: string[];
  acceptance: AcceptanceCriteria;
  adversary_review: AdversaryReview | null;
  judge_verdict: JudgeVerdict | null;
  test_result: TestResult | null;
  falsification_result: FalsificationResult | null;
  generalization: GeneralizationResult | null;
}

export type HypothesisType =
  | 'association'
  | 'difference'
  | 'distribution'
  | 'causal'
  | 'temporal'
  | 'structural';

export type HypothesisPayload =
  | AssociationPayload
  | DifferencePayload
  | DistributionPayload
  | CausalPayload
  | TemporalPayload
  | StructuralPayload;

// --- Type-specific payloads ---

export interface AssociationPayload {
  type: 'association';
  x: VariableRef;
  y: VariableRef;
  direction: 'positive' | 'negative' | 'any';
  linearity: 'linear' | 'monotonic' | 'any';
  interaction_with: string | null;
}

export interface DifferencePayload {
  type: 'difference';
  variable: VariableRef;
  grouping: VariableRef;
  groups: string[] | null;
  direction: 'group_a_higher' | 'group_b_higher' | 'any';
}

export interface DistributionPayload {
  type: 'distribution';
  variable: VariableRef;
  claim:
    | { kind: 'follows'; distribution: 'normal' | 'lognormal' | 'poisson' | 'exponential' | 'uniform' }
    | { kind: 'has_outliers'; method: 'iqr' | 'zscore' | 'isolation_forest'; threshold?: number }
    | { kind: 'is_multimodal'; expected_modes?: number }
    | { kind: 'has_skew'; direction: 'left' | 'right' };
}

export interface CausalPayload {
  type: 'causal';
  treatment: VariableRef;
  outcome: VariableRef;
  mechanism: string | null;
  strategy_hint:
    | 'backdoor'
    | 'instrumental_variable'
    | 'regression_discontinuity'
    | 'difference_in_differences'
    | 'granger'
    | 'discovery'
    | null;
  instruments: string[];
  mediators: string[];
}

export interface TemporalPayload {
  type: 'temporal';
  claim:
    | { kind: 'leads'; x: VariableRef; y: VariableRef; max_lag: number; lag_unit: string }
    | { kind: 'cointegrated'; variables: VariableRef[] }
    | { kind: 'structural_break'; variable: VariableRef; suspected_time?: string }
    | { kind: 'seasonality'; variable: VariableRef; period_hint?: number }
    | { kind: 'regime_change'; variable: VariableRef; n_regimes?: number };
}

export interface StructuralPayload {
  type: 'structural';
  claim:
    | { kind: 'clusters_exist'; variables: VariableRef[]; expected_k?: number }
    | { kind: 'latent_factor'; observed_variables: VariableRef[]; n_factors?: number }
    | { kind: 'subgroup_effect'; effect_hypothesis_id: string; subgroup_variables: VariableRef[] };
}

// --- Supporting types ---

export interface VariableRef {
  name: string;
  transform?: 'log' | 'sqrt' | 'rank' | 'zscore' | 'diff' | 'pct_change' | null;
}

export interface SubgroupFilter {
  variable: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'not_in' | 'between';
  value: string | number | (string | number)[];
}

export interface AcceptanceCriteria {
  max_p_value: number;
  min_effect_size: EffectSizeSpec;
  min_observations: number;
}

export type EffectSizeSpec =
  | { metric: 'cohens_d'; threshold: number }
  | { metric: 'pearson_r'; threshold: number }
  | { metric: 'r_squared'; threshold: number }
  | { metric: 'cramers_v'; threshold: number }
  | { metric: 'odds_ratio'; threshold: number }
  | { metric: 'eta_squared'; threshold: number }
  | { metric: 'custom'; description: string; threshold: number; unit: string };

// --- Lifecycle annotations ---

export interface AdversaryReview {
  verdict: 'pass' | 'flag' | 'reject';
  concerns: Array<{
    category: 'tautology' | 'untestable' | 'confounder' | 'data_insufficiency'
      | 'multiple_testing' | 'circular_reasoning' | 'implausible_magnitude'
      | 'collinearity' | 'survivorship_bias' | 'selection_bias' | 'other';
    description: string;
    severity: 'minor' | 'major' | 'fatal';
    suggested_fix: string | null;
  }>;
}

export interface JudgeVerdict {
  decision: 'approve' | 'reject' | 'revise';
  reason: string;
  revised_hypothesis: Partial<Hypothesis> | null;
}

export interface TestResult {
  test_performed: string;
  p_value: number;
  adjusted_p_value: number | null;
  effect_size: number;
  effect_size_metric: string;
  confidence_interval: [number, number] | null;
  n_observations: number;
  passes_acceptance: boolean;
  diagnostics: Record<string, unknown>;
}

export interface FalsificationResult {
  falsified: boolean;
  method: string;
  counterexample: string | null;
  robustness_score: number;
  attempts: Array<{
    description: string;
    result: 'survived' | 'falsified';
    details: string;
  }>;
}

export interface GeneralizationResult {
  original_hypothesis_id: string;
  generalized_claim: string;
  conditions_removed: string[];
  conditions_weakened: Array<{
    field: string;
    original_value: unknown;
    generalized_value: unknown;
  }>;
  still_significant: boolean;
  new_effect_size: number;
  new_p_value: number;
}
