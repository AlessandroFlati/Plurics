// Seed tool manifest for Plurics Tool Registry Phase 3 pilot.
// Each entry provides the tool name (used for idempotency checks) and the
// relative path from this file to the tool's tool.yaml.

export interface SeedToolDef {
  name: string;    // Must match the `name` field in the corresponding tool.yaml
  relPath: string; // Relative path from this file to tool.yaml
}

export const SEED_TOOLS: SeedToolDef[] = [
  { name: 'stats.mean',                relPath: './tools/stats.mean/tool.yaml' },
  { name: 'stats.fft',                 relPath: './tools/stats.fft/tool.yaml' },
  { name: 'json.load',                 relPath: './tools/json.load/tool.yaml' },
  { name: 'json.dump',                 relPath: './tools/json.dump/tool.yaml' },
  { name: 'pandas.load_csv',           relPath: './tools/pandas.load_csv/tool.yaml' },
  { name: 'pandas.save_csv',           relPath: './tools/pandas.save_csv/tool.yaml' },
  { name: 'stats.describe',            relPath: './tools/stats.describe/tool.yaml' },
  { name: 'stats.correlation_matrix',  relPath: './tools/stats.correlation_matrix/tool.yaml' },
  { name: 'sklearn.linear_regression', relPath: './tools/sklearn.linear_regression/tool.yaml' },
  { name: 'statsmodels.ols',           relPath: './tools/statsmodels.ols/tool.yaml' },
  { name: 'stats.median',            relPath: './tools/stats.median/tool.yaml' },
  { name: 'stats.variance',          relPath: './tools/stats.variance/tool.yaml' },
  { name: 'stats.quantile',          relPath: './tools/stats.quantile/tool.yaml' },
  { name: 'stats.histogram',         relPath: './tools/stats.histogram/tool.yaml' },
  { name: 'stats.autocorrelation',   relPath: './tools/stats.autocorrelation/tool.yaml' },
  { name: 'stats.cross_correlation', relPath: './tools/stats.cross_correlation/tool.yaml' },
  { name: 'pandas.load_parquet',     relPath: './tools/pandas.load_parquet/tool.yaml' },
  { name: 'pandas.save_parquet',     relPath: './tools/pandas.save_parquet/tool.yaml' },
  { name: 'yaml.load',               relPath: './tools/yaml.load/tool.yaml' },
  { name: 'yaml.dump',               relPath: './tools/yaml.dump/tool.yaml' },
  { name: 'stats.t_test',            relPath: './tools/stats.t_test/tool.yaml' },
  { name: 'stats.mann_whitney',      relPath: './tools/stats.mann_whitney/tool.yaml' },
  { name: 'stats.ks_test',          relPath: './tools/stats.ks_test/tool.yaml' },
  { name: 'stats.chi_square',       relPath: './tools/stats.chi_square/tool.yaml' },
  { name: 'stats.permutation_test', relPath: './tools/stats.permutation_test/tool.yaml' },
  { name: 'stats.bootstrap_ci',     relPath: './tools/stats.bootstrap_ci/tool.yaml' },
  { name: 'stats.adf_test',         relPath: './tools/stats.adf_test/tool.yaml' },
  { name: 'stats.ljung_box',        relPath: './tools/stats.ljung_box/tool.yaml' },
  { name: 'sklearn.logistic_regression', relPath: './tools/sklearn.logistic_regression/tool.yaml' },
  { name: 'sklearn.ridge',               relPath: './tools/sklearn.ridge/tool.yaml' },
  { name: 'sklearn.lasso',               relPath: './tools/sklearn.lasso/tool.yaml' },
  { name: 'statsmodels.glm',             relPath: './tools/statsmodels.glm/tool.yaml' },
];
