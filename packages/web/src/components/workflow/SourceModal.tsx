import { useState, useEffect } from 'react';
import type { DataSource } from '../../types';
import './SourceModal.css';

const SOURCE_TYPES = [
  { value: 'local_file', label: 'Local File' },
  { value: 'url', label: 'URL' },
  { value: 'glob', label: 'File Pattern (Glob)' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'bigquery', label: 'BigQuery' },
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'mongo', label: 'MongoDB' },
  { value: 's3', label: 'S3 / MinIO' },
  { value: 'rest_api', label: 'REST API' },
  { value: 'google_sheets', label: 'Google Sheets' },
  { value: 'inline', label: 'Inline Data' },
];

interface SourceModalProps {
  onAdd: (source: DataSource) => void;
  onClose: () => void;
  workspacePath: string | null;
}

interface WorkspaceFile {
  name: string;
  size: number;
}

export function SourceModal({ onAdd, onClose, workspacePath }: SourceModalProps) {
  const [sourceType, setSourceType] = useState('local_file');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [wsFiles, setWsFiles] = useState<WorkspaceFile[]>([]);

  useEffect(() => {
    if (workspacePath) {
      fetch(`/api/list-files?dir=${encodeURIComponent(workspacePath)}&extensions=csv,tsv,json,jsonl,parquet,xlsx,xls,db,sqlite`)
        .then(r => r.json())
        .then((data: { files: WorkspaceFile[] }) => setWsFiles(data.files))
        .catch(() => {});
    }
  }, [workspacePath]);

  useEffect(() => {
    setFields({});
  }, [sourceType]);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  function set(key: string, value: unknown) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  function handleAdd() {
    const source = buildSource();
    if (source) { onAdd(source); onClose(); }
  }

  function buildSource(): DataSource | null {
    switch (sourceType) {
      case 'local_file':
        if (!fields.path) return null;
        return { type: 'local_file', path: fields.path as string, format: (fields.format as string) || 'auto', sheet: (fields.sheet as string) || null, encoding: null, delimiter: null };

      case 'url':
        if (!fields.url) return null;
        return { type: 'url', url: fields.url as string, format: (fields.format as string) || 'auto', headers: {} };

      case 'glob':
        if (!fields.pattern) return null;
        return { type: 'glob', pattern: fields.pattern as string, format: (fields.format as string) || 'auto', merge_strategy: (fields.merge_strategy as string) || 'concatenate' };

      case 'postgres':
        if (!fields.connection_string) return null;
        return { type: 'postgres', connection_string: fields.connection_string as string, query: (fields.query as string) || null, discovery: fields.use_discovery ? { include_tables: null, exclude_tables: null, sample_rows_per_table: 5, max_tables: 50 } : null };

      case 'mysql':
        if (!fields.connection_string) return null;
        return { type: 'mysql', connection_string: fields.connection_string as string, query: (fields.query as string) || null, discovery: fields.use_discovery ? { include_tables: null, exclude_tables: null, sample_rows_per_table: 5, max_tables: 50 } : null };

      case 'sqlite':
        if (!fields.path) return null;
        return { type: 'sqlite', path: fields.path as string, query: (fields.query as string) || null, discovery: fields.use_discovery ? { include_tables: null, exclude_tables: null, sample_rows_per_table: 5, max_tables: 50 } : null };

      case 'bigquery':
        if (!fields.project || !fields.dataset) return null;
        return { type: 'bigquery', project: fields.project as string, dataset: fields.dataset as string, credentials_path: (fields.credentials_path as string) || null, query: (fields.query as string) || null, discovery: fields.use_discovery ? { include_tables: null, exclude_tables: null, sample_rows_per_table: 5, max_tables: 50 } : null };

      case 'snowflake':
        if (!fields.account || !fields.user || !fields.database) return null;
        return { type: 'snowflake', account: fields.account as string, user: fields.user as string, password: fields.password as string || '', warehouse: (fields.warehouse as string) || '', database: fields.database as string, schema: (fields.schema as string) || 'PUBLIC', query: (fields.query as string) || null, discovery: fields.use_discovery ? { include_tables: null, exclude_tables: null, sample_rows_per_table: 5, max_tables: 50 } : null };

      case 'mongo':
        if (!fields.connection_string || !fields.database) return null;
        return { type: 'mongo', connection_string: fields.connection_string as string, database: fields.database as string, collection: (fields.collection as string) || null, pipeline: null, discovery: fields.use_discovery ? { include_collections: null, exclude_collections: null, sample_docs_per_collection: 10, max_collections: 30 } : null };

      case 's3':
        if (!fields.bucket) return null;
        return { type: 's3', bucket: fields.bucket as string, prefix: (fields.prefix as string) || '', format: (fields.format as string) || 'auto', region: (fields.region as string) || null, endpoint: (fields.endpoint as string) || null, access_key: (fields.access_key as string) || null, secret_key: (fields.secret_key as string) || null, merge_strategy: 'concatenate' };

      case 'rest_api':
        if (!fields.base_url) return null;
        return { type: 'rest_api', base_url: fields.base_url as string, endpoints: [{ path: (fields.endpoint_path as string) || '/', method: 'GET', params: {}, pagination: { type: 'none', param_name: '', page_size: 100, max_pages: 10, cursor_field: null }, data_path: (fields.data_path as string) || 'data', result_name: (fields.result_name as string) || 'data' }], auth: fields.token ? { type: 'bearer', token: fields.token as string, header_name: null, header_value: null, username: null, password: null } : null };

      case 'google_sheets':
        if (!fields.spreadsheet_id) return null;
        return { type: 'google_sheets', spreadsheet_id: fields.spreadsheet_id as string, sheet_name: (fields.sheet_name as string) || null, range: (fields.range as string) || null, credentials_path: (fields.credentials_path as string) || null, has_header_row: true };

      case 'inline':
        return { type: 'inline', data: [{ example: 'Replace with your data' }] };

      default:
        return null;
    }
  }

  function renderFields() {
    switch (sourceType) {
      case 'local_file':
        return (
          <>
            <div className="source-modal-field">
              <label className="source-modal-label">File</label>
              {wsFiles.length > 0 ? (
                <select className="source-modal-select" value={(fields.path as string) || ''} onChange={e => set('path', e.target.value)}>
                  <option value="">Select file...</option>
                  {wsFiles.map(f => <option key={f.name} value={f.name}>{f.name} ({(f.size / 1024).toFixed(0)} KB)</option>)}
                </select>
              ) : (
                <input className="source-modal-input" placeholder="path/to/file.csv" value={(fields.path as string) || ''} onChange={e => set('path', e.target.value)} />
              )}
            </div>
            <div className="source-modal-field">
              <label className="source-modal-label">Format</label>
              <select className="source-modal-select" value={(fields.format as string) || 'auto'} onChange={e => set('format', e.target.value)}>
                <option value="auto">Auto-detect</option>
                <option value="csv">CSV</option>
                <option value="tsv">TSV</option>
                <option value="json">JSON</option>
                <option value="jsonl">JSON Lines</option>
                <option value="parquet">Parquet</option>
                <option value="excel">Excel</option>
              </select>
            </div>
          </>
        );

      case 'url':
        return (
          <>
            <div className="source-modal-field">
              <label className="source-modal-label">URL</label>
              <input className="source-modal-input source-modal-input--mono" placeholder="https://example.com/data.csv" value={(fields.url as string) || ''} onChange={e => set('url', e.target.value)} />
            </div>
            <div className="source-modal-field">
              <label className="source-modal-label">Format</label>
              <select className="source-modal-select" value={(fields.format as string) || 'auto'} onChange={e => set('format', e.target.value)}>
                <option value="auto">Auto-detect</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="parquet">Parquet</option>
              </select>
            </div>
          </>
        );

      case 'glob':
        return (
          <>
            <div className="source-modal-field">
              <label className="source-modal-label">Pattern</label>
              <input className="source-modal-input source-modal-input--mono" placeholder="data/sales_*.csv" value={(fields.pattern as string) || ''} onChange={e => set('pattern', e.target.value)} />
            </div>
            <div className="source-modal-field">
              <label className="source-modal-label">Merge strategy</label>
              <select className="source-modal-select" value={(fields.merge_strategy as string) || 'concatenate'} onChange={e => set('merge_strategy', e.target.value)}>
                <option value="concatenate">Concatenate (stack rows)</option>
                <option value="by_filename_column">Add _source_file column</option>
              </select>
            </div>
          </>
        );

      case 'postgres':
      case 'mysql':
        return (
          <>
            <div className="source-modal-field">
              <label className="source-modal-label">Connection String</label>
              <input className="source-modal-input source-modal-input--mono" type="password" placeholder={`${sourceType}://user:pass@host:5432/db`} value={(fields.connection_string as string) || ''} onChange={e => set('connection_string', e.target.value)} />
            </div>
            <label className="source-modal-check">
              <input type="checkbox" checked={!!fields.use_discovery} onChange={e => set('use_discovery', e.target.checked)} />
              Discover tables automatically
            </label>
            {!fields.use_discovery && (
              <div className="source-modal-field">
                <label className="source-modal-label">SQL Query</label>
                <textarea className="source-modal-textarea" placeholder="SELECT * FROM customers" value={(fields.query as string) || ''} onChange={e => set('query', e.target.value)} />
              </div>
            )}
          </>
        );

      case 'sqlite':
        return (
          <>
            <div className="source-modal-field">
              <label className="source-modal-label">Database File</label>
              {wsFiles.filter(f => f.name.endsWith('.db') || f.name.endsWith('.sqlite')).length > 0 ? (
                <select className="source-modal-select" value={(fields.path as string) || ''} onChange={e => set('path', e.target.value)}>
                  <option value="">Select database...</option>
                  {wsFiles.filter(f => f.name.endsWith('.db') || f.name.endsWith('.sqlite')).map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              ) : (
                <input className="source-modal-input" placeholder="path/to/database.db" value={(fields.path as string) || ''} onChange={e => set('path', e.target.value)} />
              )}
            </div>
            <label className="source-modal-check">
              <input type="checkbox" checked={!!fields.use_discovery} onChange={e => set('use_discovery', e.target.checked)} />
              Discover tables automatically
            </label>
            {!fields.use_discovery && (
              <div className="source-modal-field">
                <label className="source-modal-label">SQL Query</label>
                <textarea className="source-modal-textarea" placeholder="SELECT * FROM users" value={(fields.query as string) || ''} onChange={e => set('query', e.target.value)} />
              </div>
            )}
          </>
        );

      case 'bigquery':
        return (
          <>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">Project</label>
                <input className="source-modal-input" placeholder="my-project-id" value={(fields.project as string) || ''} onChange={e => set('project', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Dataset</label>
                <input className="source-modal-input" placeholder="analytics" value={(fields.dataset as string) || ''} onChange={e => set('dataset', e.target.value)} />
              </div>
            </div>
            <div className="source-modal-field">
              <label className="source-modal-label">Credentials (service account JSON path)</label>
              <input className="source-modal-input" placeholder="Optional (uses ADC if empty)" value={(fields.credentials_path as string) || ''} onChange={e => set('credentials_path', e.target.value)} />
            </div>
            <label className="source-modal-check">
              <input type="checkbox" checked={!!fields.use_discovery} onChange={e => set('use_discovery', e.target.checked)} />
              Discover tables automatically
            </label>
            {!fields.use_discovery && (
              <div className="source-modal-field">
                <label className="source-modal-label">SQL Query</label>
                <textarea className="source-modal-textarea" placeholder="SELECT * FROM `dataset.table`" value={(fields.query as string) || ''} onChange={e => set('query', e.target.value)} />
              </div>
            )}
          </>
        );

      case 'snowflake':
        return (
          <>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">Account</label>
                <input className="source-modal-input" placeholder="xy12345.us-east-1" value={(fields.account as string) || ''} onChange={e => set('account', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Database</label>
                <input className="source-modal-input" placeholder="ANALYTICS" value={(fields.database as string) || ''} onChange={e => set('database', e.target.value)} />
              </div>
            </div>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">User</label>
                <input className="source-modal-input" value={(fields.user as string) || ''} onChange={e => set('user', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Password</label>
                <input className="source-modal-input" type="password" value={(fields.password as string) || ''} onChange={e => set('password', e.target.value)} />
              </div>
            </div>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">Warehouse</label>
                <input className="source-modal-input" placeholder="COMPUTE_WH" value={(fields.warehouse as string) || ''} onChange={e => set('warehouse', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Schema</label>
                <input className="source-modal-input" placeholder="PUBLIC" value={(fields.schema as string) || ''} onChange={e => set('schema', e.target.value)} />
              </div>
            </div>
            <label className="source-modal-check">
              <input type="checkbox" checked={!!fields.use_discovery} onChange={e => set('use_discovery', e.target.checked)} />
              Discover tables
            </label>
            {!fields.use_discovery && (
              <div className="source-modal-field">
                <label className="source-modal-label">SQL Query</label>
                <textarea className="source-modal-textarea" value={(fields.query as string) || ''} onChange={e => set('query', e.target.value)} />
              </div>
            )}
          </>
        );

      case 'mongo':
        return (
          <>
            <div className="source-modal-field">
              <label className="source-modal-label">Connection String</label>
              <input className="source-modal-input source-modal-input--mono" type="password" placeholder="mongodb://user:pass@host:27017" value={(fields.connection_string as string) || ''} onChange={e => set('connection_string', e.target.value)} />
            </div>
            <div className="source-modal-field">
              <label className="source-modal-label">Database</label>
              <input className="source-modal-input" placeholder="mydb" value={(fields.database as string) || ''} onChange={e => set('database', e.target.value)} />
            </div>
            <label className="source-modal-check">
              <input type="checkbox" checked={!!fields.use_discovery} onChange={e => set('use_discovery', e.target.checked)} />
              Discover collections automatically
            </label>
            {!fields.use_discovery && (
              <div className="source-modal-field">
                <label className="source-modal-label">Collection</label>
                <input className="source-modal-input" placeholder="customers" value={(fields.collection as string) || ''} onChange={e => set('collection', e.target.value)} />
              </div>
            )}
          </>
        );

      case 's3':
        return (
          <>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">Bucket</label>
                <input className="source-modal-input" placeholder="my-data-bucket" value={(fields.bucket as string) || ''} onChange={e => set('bucket', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Prefix</label>
                <input className="source-modal-input source-modal-input--mono" placeholder="data/2025/" value={(fields.prefix as string) || ''} onChange={e => set('prefix', e.target.value)} />
              </div>
            </div>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">Region</label>
                <input className="source-modal-input" placeholder="us-east-1 (optional)" value={(fields.region as string) || ''} onChange={e => set('region', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Endpoint</label>
                <input className="source-modal-input source-modal-input--mono" placeholder="For MinIO/R2 (optional)" value={(fields.endpoint as string) || ''} onChange={e => set('endpoint', e.target.value)} />
              </div>
            </div>
            <div className="source-modal-hint">Leave credentials empty to use environment variables or IAM role.</div>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">Access Key</label>
                <input className="source-modal-input" type="password" value={(fields.access_key as string) || ''} onChange={e => set('access_key', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Secret Key</label>
                <input className="source-modal-input" type="password" value={(fields.secret_key as string) || ''} onChange={e => set('secret_key', e.target.value)} />
              </div>
            </div>
          </>
        );

      case 'rest_api':
        return (
          <>
            <div className="source-modal-field">
              <label className="source-modal-label">Base URL</label>
              <input className="source-modal-input source-modal-input--mono" placeholder="https://api.example.com/v1" value={(fields.base_url as string) || ''} onChange={e => set('base_url', e.target.value)} />
            </div>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">Endpoint Path</label>
                <input className="source-modal-input source-modal-input--mono" placeholder="/customers" value={(fields.endpoint_path as string) || ''} onChange={e => set('endpoint_path', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Data Path (JSONPath)</label>
                <input className="source-modal-input source-modal-input--mono" placeholder="data" value={(fields.data_path as string) || ''} onChange={e => set('data_path', e.target.value)} />
              </div>
            </div>
            <div className="source-modal-field">
              <label className="source-modal-label">Bearer Token (optional)</label>
              <input className="source-modal-input" type="password" value={(fields.token as string) || ''} onChange={e => set('token', e.target.value)} />
            </div>
          </>
        );

      case 'google_sheets':
        return (
          <>
            <div className="source-modal-field">
              <label className="source-modal-label">Spreadsheet ID</label>
              <input className="source-modal-input source-modal-input--mono" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" value={(fields.spreadsheet_id as string) || ''} onChange={e => set('spreadsheet_id', e.target.value)} />
              <div className="source-modal-hint">From the URL: docs.google.com/spreadsheets/d/<b>THIS_PART</b>/edit</div>
            </div>
            <div className="source-modal-row">
              <div className="source-modal-field">
                <label className="source-modal-label">Sheet Name</label>
                <input className="source-modal-input" placeholder="Sheet1 (optional)" value={(fields.sheet_name as string) || ''} onChange={e => set('sheet_name', e.target.value)} />
              </div>
              <div className="source-modal-field">
                <label className="source-modal-label">Range</label>
                <input className="source-modal-input" placeholder="A1:Z1000 (optional)" value={(fields.range as string) || ''} onChange={e => set('range', e.target.value)} />
              </div>
            </div>
            <div className="source-modal-field">
              <label className="source-modal-label">Credentials Path</label>
              <input className="source-modal-input" placeholder="Optional (service account JSON)" value={(fields.credentials_path as string) || ''} onChange={e => set('credentials_path', e.target.value)} />
            </div>
          </>
        );

      case 'inline':
        return (
          <div className="source-modal-hint">
            Inline data will be added as a placeholder. Edit the JSON in the input manifest after adding.
          </div>
        );

      default:
        return null;
    }
  }

  const isValid = buildSource() !== null;

  return (
    <div className="source-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="source-modal">
        <div className="source-modal-header">Add Data Source</div>
        <div className="source-modal-body">
          <div className="source-modal-field">
            <label className="source-modal-label">Source Type</label>
            <select className="source-modal-select" value={sourceType} onChange={e => setSourceType(e.target.value)}>
              {SOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {renderFields()}
        </div>
        <div className="source-modal-footer">
          <button className="source-modal-btn" onClick={onClose}>Cancel</button>
          <button className="source-modal-btn source-modal-btn--primary" onClick={handleAdd} disabled={!isValid}>
            Add Source
          </button>
        </div>
      </div>
    </div>
  );
}
