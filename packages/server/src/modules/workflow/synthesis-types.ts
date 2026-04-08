// --- Meta-Analyst Types ---

import type { Hypothesis, HypothesisType } from './hypothesis-types.js';

export interface FindingCluster {
  cluster_id: string;
  hypotheses: string[];
  shared_variables: string[];
  mechanism_narrative: string;
  confidence: 'strong' | 'moderate' | 'tentative';
  supporting_evidence_count: number;
  contradicting_evidence_count: number;
}

export interface SynthesizedCausalGraph {
  nodes: Array<{
    variable: string;
    role: 'root_cause' | 'mediator' | 'outcome' | 'confounder' | 'instrument';
  }>;
  edges: Array<{
    from: string;
    to: string;
    hypothesis_id: string;
    effect_size: number;
    mechanism: string | null;
    confidence: 'validated' | 'suggested';
  }>;
  chains: Array<{
    path: string[];
    total_effect: number | null;
    description: string;
  }>;
  contradictions: Array<{
    edge_a: { from: string; to: string; hypothesis_id: string };
    edge_b: { from: string; to: string; hypothesis_id: string };
    description: string;
  }>;
}

export interface ConsistencyCheck {
  hypothesis_id: string;
  check_type: 'simpsons_paradox' | 'ecological_fallacy' | 'confounding_by_proxy'
    | 'collider_bias' | 'time_period_sensitivity';
  result: 'consistent' | 'inconsistent' | 'unable_to_check';
  description: string;
  recommendation: string | null;
}

export interface GapAnalysis {
  unexplored_variables: Array<{
    variable: string;
    reason_likely_skipped: string;
    worth_exploring: boolean;
  }>;
  unexplored_leads: Array<{
    lead_id: string;
    description: string;
    suggested_follow_up: string;
  }>;
  unexplored_types: HypothesisType[];
  recoverable_hypotheses: Array<{
    hypothesis_id: string;
    original_claim: string;
    falsification_reason: string;
    suggested_modification: string;
  }>;
  prematurely_killed: Array<{
    hypothesis_id: string;
    killed_by: 'adversary' | 'judge';
    reason: string;
    reconsideration_argument: string;
  }>;
}

export interface ImportanceScore {
  hypothesis_id: string;
  statistical_strength: number;
  practical_significance: number;
  robustness: number;
  generalizability: number;
  novelty: number;
  composite_score: number;
  rank: number;
  weights: {
    statistical: number;
    practical: number;
    robustness: number;
    generalizability: number;
    novelty: number;
  };
}

export const DEFAULT_IMPORTANCE_WEIGHTS = {
  statistical: 0.15,
  practical: 0.25,
  robustness: 0.25,
  generalizability: 0.15,
  novelty: 0.20,
};

export interface FinalReport {
  report_version: 1;
  generated_at: string;
  workflow_name: string;
  run_id: string;
  summary: {
    total_hypotheses_generated: number;
    hypotheses_approved_by_judge: number;
    hypotheses_tested: number;
    hypotheses_validated: number;
    hypotheses_falsified: number;
    hypotheses_generalized: number;
    total_tests_run: number;
    test_budget_used_pct: number;
    fdr_level: number;
  };
  top_findings: ImportanceScore[];
  clusters: FindingCluster[];
  causal_graph: SynthesizedCausalGraph;
  consistency_checks: ConsistencyCheck[];
  gap_analysis: GapAnalysis;
  hypotheses: Hypothesis[];
  methodology: {
    correction_method: string;
    base_alpha: number;
    final_adjusted_alpha: number;
    effect_size_policy: string;
    falsification_strategies_used: string[];
  };
}

// --- Falsifier Strategy Types ---

export type FalsificationStrategyType =
  | 'permutation'
  | 'bootstrap'
  | 'subgroup_reversal'
  | 'leave_one_out'
  | 'temporal_split'
  | 'random_confounder'
  | 'collider_check'
  | 'effect_threshold_probe';

export interface FalsificationStrategyConfig {
  strategy: FalsificationStrategyType;
  params: FalsificationParams;
}

export type FalsificationParams =
  | { strategy: 'permutation'; n_permutations: number }
  | { strategy: 'bootstrap'; n_bootstrap: number; ci_level: number }
  | { strategy: 'subgroup_reversal'; grouping_variables: string[]; reversal_threshold: number }
  | { strategy: 'leave_one_out'; max_n_for_literal_loo: number; influence_threshold: number }
  | { strategy: 'temporal_split'; split_point: 'midpoint' | 'quartiles' }
  | { strategy: 'random_confounder'; n_random_variables: number; max_effect_change_pct: number }
  | { strategy: 'collider_check' }
  | { strategy: 'effect_threshold_probe'; probe_thresholds: number[] };

// Strategy applicability matrix
export const FALSIFICATION_APPLICABILITY: Record<string, FalsificationStrategyType[]> = {
  association: ['permutation', 'bootstrap', 'subgroup_reversal', 'leave_one_out', 'random_confounder', 'effect_threshold_probe'],
  difference: ['permutation', 'bootstrap', 'subgroup_reversal', 'leave_one_out', 'random_confounder', 'effect_threshold_probe'],
  distribution: ['permutation', 'bootstrap'],
  causal: ['permutation', 'bootstrap', 'subgroup_reversal', 'leave_one_out', 'random_confounder', 'collider_check', 'effect_threshold_probe'],
  temporal: ['permutation', 'bootstrap', 'temporal_split', 'random_confounder', 'effect_threshold_probe'],
  structural: ['permutation', 'bootstrap'],
};

// Required strategies (failure = falsified)
export const REQUIRED_FALSIFICATION_STRATEGIES: FalsificationStrategyType[] = ['permutation', 'bootstrap'];

export interface FalsificationAttempt {
  strategy: string;
  result: 'survived' | 'falsified' | 'inconclusive' | 'not_applicable';
  required: boolean;
  confidence: 'high' | 'medium' | 'low';
  details: string;
  metrics: Record<string, unknown>;
}

export interface ExtendedFalsificationResult {
  falsified: boolean;
  robustness_score: number;
  attempts: FalsificationAttempt[];
  primary_falsification: {
    strategy: string;
    explanation: string;
  } | null;
  narrative: string;
}

// --- Generalizer Strategy Types ---

export type GeneralizationStrategyType =
  | 'remove_subgroup'
  | 'remove_confounder'
  | 'weaken_condition'
  | 'broaden_variable'
  | 'cross_time_period'
  | 'merge_hypotheses';

export interface GeneralizationAttempt {
  strategy: string;
  modification: string;
  result: 'still_holds' | 'lost_significance' | 'effect_reversed' | 'error';
  new_effect_size: number | null;
  new_p_value: number | null;
}

export interface ExtendedGeneralizationResult {
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
  attempts: GeneralizationAttempt[];
  generalized_hypothesis: Hypothesis | null;
}
