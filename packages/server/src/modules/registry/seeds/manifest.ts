// Seed tool manifest for Plurics Tool Registry Phase 3 pilot.
// Each entry provides the tool name (used for idempotency checks) and the
// relative path from this file to the tool's tool.yaml.

export interface SeedToolDef {
  name: string;    // Must match the `name` field in the corresponding tool.yaml
  relPath: string; // Relative path from this file to tool.yaml
}

export const SEED_TOOLS: SeedToolDef[] = [
  { name: 'stats.mean', relPath: './tools/stats.mean/tool.yaml' },
  { name: 'stats.fft',  relPath: './tools/stats.fft/tool.yaml' },
  { name: 'json.load', relPath: './tools/json.load/tool.yaml' },
  { name: 'json.dump', relPath: './tools/json.dump/tool.yaml' },
  { name: 'pandas.load_csv', relPath: './tools/pandas.load_csv/tool.yaml' },
  { name: 'pandas.save_csv', relPath: './tools/pandas.save_csv/tool.yaml' },
  { name: 'stats.describe', relPath: './tools/stats.describe/tool.yaml' },
  { name: 'stats.correlation_matrix', relPath: './tools/stats.correlation_matrix/tool.yaml' },
  { name: 'sklearn.linear_regression', relPath: './tools/sklearn.linear_regression/tool.yaml' },
];
