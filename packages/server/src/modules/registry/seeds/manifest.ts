// Seed tool manifest for Plurics Tool Registry Phase 3 pilot.
// Each entry provides the tool name (used for idempotency checks) and the
// relative path from this file to the tool's tool.yaml.

export interface SeedToolDef {
  name: string;    // Must match the `name` field in the corresponding tool.yaml
  relPath: string; // Relative path from this file to tool.yaml
}

export const SEED_TOOLS: SeedToolDef[] = [];
