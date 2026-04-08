// --- Profiler Data Manifest ---

import type { HypothesisType } from './hypothesis-types.js';

export interface DataManifest {
  manifest_version: 1;
  generated_at: string;
  metadata: DatasetMetadata;
  columns: ColumnProfile[];
  correlations: CorrelationEntry[];
  collinearity_groups: CollinearityGroup[];
  quality: DataQualityReport;
  leads: AnalysisLead[];
}

export interface DatasetMetadata {
  source_file: string;
  format: 'csv' | 'parquet' | 'json' | 'excel' | 'sqlite' | 'tsv' | 'other';
  row_count: number;
  column_count: number;
  memory_bytes: number;
  is_time_series: boolean;
  time_column: string | null;
  time_range: { start: string; end: string } | null;
  time_frequency: string | null;
  has_natural_experiment: boolean;
  natural_experiment_hint: string | null;
  estimated_subgroup_sizes: Record<string, number> | null;
}

export interface ColumnProfile {
  name: string;
  position: number;
  dtype: string;
  inferred_type: 'numeric' | 'categorical' | 'datetime' | 'text' | 'boolean' | 'identifier';
  semantic_type: SemanticType;
  total_count: number;
  missing_count: number;
  missing_pct: number;
  n_unique: number;
  is_unique: boolean;
  stats: ColumnStats;
  distribution: DistributionSummary | null;
  sample_values: (string | number | null)[];
  anomalies: ColumnAnomaly[];
}

export type SemanticType =
  | 'continuous'
  | 'discrete_numeric'
  | 'categorical_nominal'
  | 'categorical_ordinal'
  | 'binary'
  | 'count'
  | 'proportion'
  | 'currency'
  | 'date'
  | 'duration'
  | 'identifier'
  | 'free_text'
  | 'geospatial'
  | 'unknown';

export interface ColumnStats {
  mean: number | null;
  median: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  p25: number | null;
  p75: number | null;
  skewness: number | null;
  kurtosis: number | null;
  top_values: Array<{ value: string; count: number; pct: number }> | null;
  date_min: string | null;
  date_max: string | null;
  date_frequency: string | null;
  date_gaps: number | null;
}

export interface DistributionSummary {
  shape: 'normal' | 'skewed_right' | 'skewed_left' | 'bimodal' | 'multimodal'
    | 'uniform' | 'exponential' | 'heavy_tailed' | 'sparse' | 'other';
  normality_p_value: number | null;
  is_normal: boolean | null;
  histogram: { bin_edges: number[]; counts: number[] } | null;
}

export interface ColumnAnomaly {
  type: 'outliers_detected' | 'suspicious_zeros' | 'constant_column'
    | 'high_cardinality' | 'mixed_types' | 'negative_where_unexpected'
    | 'future_dates' | 'duplicate_near_values' | 'truncated_values';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  affected_count: number;
  recommendation: string;
}

export interface CorrelationEntry {
  x: string;
  y: string;
  pearson: number | null;
  spearman: number | null;
  method_used: 'pearson' | 'spearman' | 'cramers_v' | 'point_biserial';
  abs_value: number;
}

export interface CollinearityGroup {
  variables: string[];
  max_correlation: number;
  recommendation: string;
}

export interface DataQualityReport {
  overall_score: number;
  issues: Array<{
    category: 'missing_data' | 'duplicates' | 'type_inconsistency' | 'range_violation'
      | 'referential_integrity' | 'temporal_gaps' | 'encoding_issues';
    severity: 'info' | 'warning' | 'critical';
    description: string;
    affected_columns: string[];
    affected_rows: number;
    suggested_action: string;
  }>;
  duplicate_rows: number;
  near_duplicate_rows: number;
  missing_pattern: 'random' | 'systematic' | 'block' | 'none';
  missing_correlation: Array<{
    col_a: string;
    col_b: string;
    correlation: number;
  }>;
}

export interface AnalysisLead {
  id: string;
  category: 'strong_correlation' | 'unexpected_distribution' | 'group_difference'
    | 'temporal_pattern' | 'interaction_hint' | 'anomaly_cluster'
    | 'missing_data_pattern' | 'potential_confounder';
  description: string;
  evidence: string;
  involved_variables: string[];
  suggested_hypothesis_type: HypothesisType;
  priority: 'high' | 'medium' | 'low';
}
