// --- Input Manifest ---

export interface InputManifest {
  sources: DataSource[];
  config_overrides: Record<string, unknown>;
  scope: ScopeConstraint | null;
  description: string | null;
}

// --- Data Source Types ---

export type DataSource =
  // Flat files
  | LocalFileSource
  | UrlSource
  | InlineSource
  | GlobSource
  // Relational databases
  | PostgresSource
  | MysqlSource
  | SqliteSource
  // Cloud warehouses
  | BigQuerySource
  | SnowflakeSource
  // Document stores
  | MongoSource
  // Cloud storage
  | S3Source
  // APIs
  | RestApiSource
  // Spreadsheets
  | GoogleSheetsSource;

// -- Flat files --

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

export interface InlineSource {
  type: 'inline';
  data: Record<string, unknown>[];
}

export interface GlobSource {
  type: 'glob';
  pattern: string;
  format: 'csv' | 'tsv' | 'json' | 'jsonl' | 'parquet' | 'auto';
  merge_strategy: 'concatenate' | 'by_filename_column';
}

// -- Relational databases --

export interface DiscoveryConfig {
  schemas?: string[];
  include_tables: string[] | null;
  exclude_tables: string[] | null;
  include_views?: boolean;
  sample_rows_per_table: number;
  max_tables: number;
}

export interface PostgresSource {
  type: 'postgres';
  connection_string: string;
  query: string | null;
  discovery: DiscoveryConfig | null;
}

export interface MysqlSource {
  type: 'mysql';
  connection_string: string;
  query: string | null;
  discovery: DiscoveryConfig | null;
}

export interface SqliteSource {
  type: 'sqlite';
  path: string;
  query: string | null;
  discovery: Omit<DiscoveryConfig, 'schemas' | 'include_views'> | null;
}

// -- Cloud warehouses --

export interface BigQuerySource {
  type: 'bigquery';
  project: string;
  dataset: string;
  credentials_path: string | null;
  query: string | null;
  discovery: Omit<DiscoveryConfig, 'schemas' | 'include_views'> | null;
}

export interface SnowflakeSource {
  type: 'snowflake';
  account: string;
  user: string;
  password: string;
  warehouse: string;
  database: string;
  schema: string;
  query: string | null;
  discovery: Omit<DiscoveryConfig, 'schemas' | 'include_views'> | null;
}

// -- Document stores --

export interface MongoSource {
  type: 'mongo';
  connection_string: string;
  database: string;
  collection: string | null;
  pipeline: Record<string, unknown>[] | null;
  discovery: {
    include_collections: string[] | null;
    exclude_collections: string[] | null;
    sample_docs_per_collection: number;
    max_collections: number;
  } | null;
}

// -- Cloud storage --

export interface S3Source {
  type: 's3';
  bucket: string;
  prefix: string;
  format: 'csv' | 'tsv' | 'json' | 'jsonl' | 'parquet' | 'auto';
  region: string | null;
  endpoint: string | null;
  access_key: string | null;
  secret_key: string | null;
  merge_strategy: 'concatenate' | 'by_filename_column';
}

// -- APIs --

export interface RestApiSource {
  type: 'rest_api';
  base_url: string;
  endpoints: ApiEndpoint[];
  auth: ApiAuth | null;
}

export interface ApiEndpoint {
  path: string;
  method: 'GET' | 'POST';
  params: Record<string, string>;
  pagination: {
    type: 'offset' | 'cursor' | 'page' | 'link_header' | 'none';
    param_name: string;
    page_size: number;
    max_pages: number;
    cursor_field: string | null;
  };
  data_path: string;
  result_name: string;
}

export interface ApiAuth {
  type: 'bearer' | 'api_key' | 'basic';
  token: string | null;
  header_name: string | null;
  header_value: string | null;
  username: string | null;
  password: string | null;
}

// -- Spreadsheets --

export interface GoogleSheetsSource {
  type: 'google_sheets';
  spreadsheet_id: string;
  sheet_name: string | null;
  range: string | null;
  credentials_path: string | null;
  has_header_row: boolean;
}

// --- Scope Constraints ---

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

// --- Multi-Table Output Types ---

export interface RelationshipGraph {
  version: 1;
  tables: Array<{
    name: string;
    file: string;
    row_count: number;
    granularity: string;
    primary_key: string[];
    role_hint: 'fact' | 'dimension' | 'bridge' | 'lookup' | 'unknown';
  }>;
  edges: Array<{
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
    type: 'foreign_key' | 'inferred';
    cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
    confidence: number;
  }>;
  join_paths: Array<{
    from: string;
    to: string;
    path: Array<{
      join_table: string;
      join_type: 'inner' | 'left' | 'right';
      on_left: string;
      on_right: string;
    }>;
  }>;
}

// --- Source Catalog (Discovery Output) ---

export interface SourceCatalog {
  catalog_version: 1;
  generated_at: string;
  source_type: string;
  connection_summary: string;
  schemas: SchemaCatalog[] | null;
  collections: CollectionCatalog[] | null;
  files: FileCatalog[] | null;
  relationships: Array<{
    type: 'foreign_key' | 'inferred';
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
    cardinality: '1:1' | '1:N' | 'N:1' | 'N:M' | 'unknown';
    confidence: number;
  }>;
  extraction_plan: ExtractionPlan;
}

export interface SchemaCatalog {
  schema_name: string;
  tables: TableCatalog[];
  views: ViewCatalog[];
}

export interface TableCatalog {
  name: string;
  type: 'table' | 'materialized_view';
  row_count: number;
  size_bytes: number | null;
  columns: CatalogColumn[];
  primary_key: string[] | null;
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
  sample_rows: Record<string, unknown>[];
  comment: string | null;
}

export interface CatalogColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  foreign_key_target: { table: string; column: string } | null;
  comment: string | null;
  distinct_count: number | null;
  null_fraction: number | null;
  sample_values: unknown[];
}

export interface ViewCatalog {
  name: string;
  columns: CatalogColumn[];
  definition: string | null;
  row_count: number | null;
}

export interface CollectionCatalog {
  name: string;
  document_count: number;
  avg_document_size_bytes: number;
  inferred_schema: {
    fields: Array<{
      path: string;
      types_observed: string[];
      frequency: number;
      sample_values: unknown[];
    }>;
  };
  indexes: Array<{ name: string; keys: Record<string, number>; unique: boolean }>;
  sample_documents: Record<string, unknown>[];
}

export interface FileCatalog {
  path: string;
  size_bytes: number;
  last_modified: string;
  format: string;
  row_count: number | null;
  columns: string[] | null;
}

export interface ExtractionPlan {
  strategy: 'all_tables' | 'selected_tables' | 'single_query';
  tables_to_extract: Array<{
    name: string;
    role_hint: 'fact' | 'dimension' | 'bridge' | 'lookup' | 'supplementary';
    columns_to_include: string[] | null;
    columns_to_exclude: string[] | null;
    estimated_rows: number;
    reason: string;
  }>;
  tables_excluded: Array<{
    name: string;
    reason: string;
  }>;
  warnings: string[];
  rationale: string;
}
