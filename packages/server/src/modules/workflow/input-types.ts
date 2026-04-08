// --- Input Manifest ---

export interface InputManifest {
  sources: DataSource[];
  config_overrides: Record<string, unknown>;
  scope: ScopeConstraint | null;
  description: string | null;
}

export type DataSource =
  | LocalFileSource
  | UrlSource
  | SqliteSource
  | PostgresSource
  | InlineSource;

export interface LocalFileSource {
  type: 'local_file';
  path: string;
  format: 'csv' | 'tsv' | 'json' | 'jsonl' | 'parquet' | 'excel' | 'auto';
  sheet: string | null;
  encoding: string | null;
  delimiter: string | null;
}

export interface UrlSource {
  type: 'url';
  url: string;
  format: 'csv' | 'tsv' | 'json' | 'jsonl' | 'parquet' | 'excel' | 'auto';
  headers: Record<string, string>;
}

export interface SqliteSource {
  type: 'sqlite';
  path: string;
  query: string;
}

export interface PostgresSource {
  type: 'postgres';
  connection_string: string;
  query: string;
}

export interface InlineSource {
  type: 'inline';
  data: Record<string, unknown>[];
}

export interface ScopeConstraint {
  include_columns: string[] | null;
  exclude_columns: string[] | null;
  date_range: {
    column: string;
    start: string | null;
    end: string | null;
  } | null;
  row_filter: {
    column: string;
    operator: '==' | '!=' | '>' | '<' | 'in';
    value: unknown;
  } | null;
  max_rows: number | null;
  sampling_method: 'head' | 'random' | 'stratified' | null;
  stratify_column: string | null;
}
