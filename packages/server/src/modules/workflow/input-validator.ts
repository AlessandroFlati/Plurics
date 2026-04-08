import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InputManifest } from './input-types.js';

export interface ManifestValidationError {
  field: string;
  message: string;
}

const KNOWN_CONFIG_KEYS = [
  'max_hypothesis_rounds', 'max_audit_rounds', 'max_total_tests',
  'agent_timeout_seconds', 'base_significance', 'max_parallel_hypotheses',
  'hypotheses_per_batch', 'min_hypotheses_to_proceed', 'script_timeout_seconds',
];

export function validateInputManifest(
  manifest: InputManifest,
  workspacePath: string,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  if (!manifest.sources || manifest.sources.length === 0) {
    errors.push({ field: 'sources', message: 'At least one data source is required' });
  }

  for (const [i, source] of (manifest.sources || []).entries()) {
    switch (source.type) {
      case 'local_file': {
        const resolved = path.isAbsolute(source.path)
          ? source.path
          : path.join(workspacePath, source.path);
        if (!fs.existsSync(resolved)) {
          errors.push({ field: `sources[${i}].path`, message: `File not found: ${resolved}` });
        }
        break;
      }

      case 'url': {
        try { new URL(source.url); }
        catch { errors.push({ field: `sources[${i}].url`, message: 'Invalid URL' }); }
        if (source.url && !source.url.startsWith('https://')) {
          errors.push({ field: `sources[${i}].url`, message: 'Only HTTPS URLs are supported' });
        }
        break;
      }

      case 'sqlite': {
        const resolved = path.isAbsolute(source.path)
          ? source.path
          : path.join(workspacePath, source.path);
        if (!fs.existsSync(resolved)) {
          errors.push({ field: `sources[${i}].path`, message: `Database not found: ${resolved}` });
        }
        if (!validateSqlReadOnly(source.query)) {
          errors.push({ field: `sources[${i}].query`, message: 'Only SELECT queries are allowed' });
        }
        break;
      }

      case 'postgres': {
        if (!source.connection_string.startsWith('postgres')) {
          errors.push({ field: `sources[${i}].connection_string`, message: 'Must be a postgres:// connection string' });
        }
        if (!validateSqlReadOnly(source.query)) {
          errors.push({ field: `sources[${i}].query`, message: 'Only SELECT queries are allowed' });
        }
        break;
      }

      case 'inline': {
        if (!Array.isArray(source.data) || source.data.length === 0) {
          errors.push({ field: `sources[${i}].data`, message: 'Inline data must be a non-empty array of objects' });
        }
        break;
      }
    }
  }

  for (const key of Object.keys(manifest.config_overrides || {})) {
    if (!KNOWN_CONFIG_KEYS.includes(key)) {
      errors.push({ field: `config_overrides.${key}`, message: `Unknown config key: ${key}` });
    }
  }

  if (manifest.scope) {
    if (manifest.scope.include_columns && manifest.scope.exclude_columns) {
      errors.push({ field: 'scope', message: 'Cannot specify both include_columns and exclude_columns' });
    }
    if (manifest.scope.max_rows !== null && manifest.scope.max_rows !== undefined && manifest.scope.max_rows < 100) {
      errors.push({ field: 'scope.max_rows', message: 'max_rows must be at least 100 for meaningful analysis' });
    }
    if (manifest.scope.sampling_method === 'stratified' && !manifest.scope.stratify_column) {
      errors.push({ field: 'scope.stratify_column', message: 'stratify_column is required when sampling_method is "stratified"' });
    }
  }

  return errors;
}

function validateSqlReadOnly(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    return false;
  }
  const forbidden = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke', 'exec', 'execute'];
  const tokens = normalized.replace(/[();,]/g, ' ').split(/\s+/);
  return !tokens.some(t => forbidden.includes(t));
}
