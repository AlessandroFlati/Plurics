// --- Architect Test Plan ---

export interface TestPlan {
  hypothesis_id: string;
  mode: 'correlation' | 'causal' | 'distributional' | 'structural';
  correlation_plan: CorrelationPlan | null;
  causal_plan: CausalPlan | null;
  distributional_plan: DistributionalPlan | null;
  structural_plan: StructuralPlan | null;
  preprocessing: PreprocessingStep[];
  assumption_checks: AssumptionCheck[];
  sample_size_analysis: SampleSizeAnalysis;
}

// --- Correlation mode ---

export interface CorrelationPlan {
  test: CorrelationTest;
  variables: { x: string; y: string };
  controls: string[];
  custom_params: Record<string, unknown>;
}

export type CorrelationTest =
  | 'pearson'
  | 'spearman'
  | 'kendall'
  | 'partial_pearson'
  | 'partial_spearman'
  | 'mutual_information'
  | 'distance_correlation'
  | 'chi_squared'
  | 'point_biserial'
  | 'anova_f'
  | 'mann_whitney_u'
  | 'kruskal_wallis'
  | 'welch_t'
  | 'linear_regression'
  | 'logistic_regression'
  | 'ordinal_regression';

// --- Causal mode ---

export interface CausalPlan {
  framework: CausalFramework;
  treatment: string;
  outcome: string;
  identification: IdentificationStrategy;
  robustness: RobustnessCheck[];
}

export type CausalFramework = 'dowhy' | 'statsmodels' | 'causalml' | 'pcalg_compat';

export type IdentificationStrategy =
  | {
      method: 'backdoor';
      backdoor_set: string[];
      estimator: 'linear_regression' | 'propensity_score_matching'
        | 'inverse_propensity_weighting' | 'doubly_robust';
    }
  | {
      method: 'instrumental_variable';
      instruments: string[];
      estimator: '2sls' | 'wald';
      instrument_justification: string;
    }
  | {
      method: 'regression_discontinuity';
      running_variable: string;
      cutoff: number;
      bandwidth: number | 'auto';
      estimator: 'local_linear' | 'local_polynomial';
    }
  | {
      method: 'difference_in_differences';
      time_variable: string;
      treatment_period: string;
      group_variable: string;
      treatment_group: string;
      control_group: string;
    }
  | {
      method: 'granger';
      max_lag: number;
      information_criterion: 'aic' | 'bic';
    }
  | {
      method: 'causal_discovery';
      algorithm: 'pc' | 'fci' | 'ges' | 'lingam';
      variables: string[];
      alpha: number;
    };

export type RobustnessCheck =
  | { type: 'placebo_treatment'; placebo_variable: string }
  | { type: 'placebo_outcome'; placebo_variable: string }
  | { type: 'sensitivity_analysis'; method: 'rosenbaum_bounds' | 'e_value' }
  | { type: 'refutation_random_cause' }
  | { type: 'refutation_data_subset'; fraction: number }
  | { type: 'refutation_add_unobserved_confounder'; effect_fraction: number };

// --- Distributional mode ---

export interface DistributionalPlan {
  test: DistributionalTest;
  variable: string;
  params: Record<string, unknown>;
}

export type DistributionalTest =
  | 'shapiro_wilk'
  | 'dagostino_pearson'
  | 'anderson_darling'
  | 'kolmogorov_smirnov'
  | 'lilliefors'
  | 'dip_test'
  | 'grubbs'
  | 'esd_test'
  | 'isolation_forest'
  | 'adf'
  | 'kpss'
  | 'ljung_box';

// --- Structural mode ---

export interface StructuralPlan {
  test: StructuralTest;
  variables: string[];
  params: Record<string, unknown>;
}

export type StructuralTest =
  | 'kmeans_silhouette'
  | 'dbscan'
  | 'gaussian_mixture_bic'
  | 'factor_analysis'
  | 'pca_variance'
  | 'subgroup_interaction';

// --- Common supporting types ---

export interface PreprocessingStep {
  order: number;
  operation: 'drop_na' | 'impute_median' | 'impute_knn' | 'winsorize'
    | 'log_transform' | 'standardize' | 'one_hot_encode'
    | 'filter_subgroup' | 'resample' | 'detrend' | 'difference';
  target_columns: string[];
  params: Record<string, unknown>;
}

export interface AssumptionCheck {
  name: string;
  test: string;
  required: boolean;
  fallback_test: string | null;
}

export interface SampleSizeAnalysis {
  available_n: number;
  required_n_for_power_80: number;
  power_at_available_n: number;
  is_underpowered: boolean;
  recommendation: string | null;
}
