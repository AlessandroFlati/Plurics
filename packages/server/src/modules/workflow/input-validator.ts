import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InputManifest } from './input-types.js';

export interface ManifestValidationError {
  field: string;
  message: string;
}

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

      case 'inline': {
        if (!Array.isArray(source.data) || source.data.length === 0) {
          errors.push({ field: `sources[${i}].data`, message: 'Inline data must be a non-empty array of objects' });
        }
        break;
      }

      case 'glob': {
        if (!source.pattern) {
          errors.push({ field: `sources[${i}].pattern`, message: 'Glob pattern is required' });
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
        validateQueryOrDiscovery(source, i, errors);
        break;
      }

      case 'postgres': {
        if (!source.connection_string.startsWith('postgres')) {
          errors.push({ field: `sources[${i}].connection_string`, message: 'Must be a postgres:// connection string' });
        }
        validateQueryOrDiscovery(source, i, errors);
        break;
      }

      case 'mysql': {
        if (!source.connection_string.startsWith('mysql')) {
          errors.push({ field: `sources[${i}].connection_string`, message: 'Must be a mysql:// connection string' });
        }
        validateQueryOrDiscovery(source, i, errors);
        break;
      }

      case 'bigquery': {
        if (!source.project || !source.dataset) {
          errors.push({ field: `sources[${i}]`, message: 'project and dataset are required for BigQuery' });
        }
        validateQueryOrDiscovery(source, i, errors);
        break;
      }

      case 'snowflake': {
        if (!source.account || !source.user || !source.database) {
          errors.push({ field: `sources[${i}]`, message: 'account, user, and database are required for Snowflake' });
        }
        validateQueryOrDiscovery(source, i, errors);
        break;
      }

      case 'mongo': {
        if (!source.connection_string.startsWith('mongodb')) {
          errors.push({ field: `sources[${i}].connection_string`, message: 'Must be a mongodb:// connection string' });
        }
        if (!source.database) {
          errors.push({ field: `sources[${i}].database`, message: 'database is required for MongoDB' });
        }
        break;
      }

      case 's3': {
        if (!source.bucket) {
          errors.push({ field: `sources[${i}].bucket`, message: 'bucket is required for S3' });
        }
        break;
      }

      case 'rest_api': {
        if (!source.base_url) {
          errors.push({ field: `sources[${i}].base_url`, message: 'base_url is required' });
        }
        if (!source.endpoints || source.endpoints.length === 0) {
          errors.push({ field: `sources[${i}].endpoints`, message: 'At least one endpoint is required' });
        }
        break;
      }

      case 'google_sheets': {
        if (!source.spreadsheet_id) {
          errors.push({ field: `sources[${i}].spreadsheet_id`, message: 'spreadsheet_id is required' });
        }
        break;
      }
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

function validateQueryOrDiscovery(
  source: { query: string | null; discovery?: unknown },
  index: number,
  errors: ManifestValidationError[],
): void {
  if (source.query && source.discovery) {
    errors.push({ field: `sources[${index}]`, message: 'Specify query OR discovery, not both' });
  }
  if (source.query && !validateSqlReadOnly(source.query)) {
    errors.push({ field: `sources[${index}].query`, message: 'Only SELECT/WITH queries are allowed' });
  }
}

function validateSqlReadOnly(query: string): boolean {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    return false;
  }
  const forbidden = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke', 'exec', 'execute'];
  const tokens = normalized.replace(/[();,]/g, ' ').split(/\s+/);
  return !tokens.some(t => forbidden.includes(t));
}
