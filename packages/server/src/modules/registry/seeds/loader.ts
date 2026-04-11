import { RegistryClient } from '../registry-client.js';

export interface SeedLoadResult {
  registered: number;
  skipped: number;
  failed: number;
  errors: Array<{ name: string; error: string }>;
}

// Stub implementation — no tools in manifest yet.
// Will be replaced in Task 3.
export async function loadSeedTools(_client: RegistryClient): Promise<SeedLoadResult> {
  return { registered: 0, skipped: 0, failed: 0, errors: [] };
}
