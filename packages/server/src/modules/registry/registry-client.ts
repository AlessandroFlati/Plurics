import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  RegistryClientOptions,
  RegistrationError,
  ResolvedPort,
  SchemaDef,
  ToolManifest,
  ToolPortSpec,
  ToolRecord,
  RegistrationRequest,
  RegistrationResult,
  InvocationRequest,
  InvocationResult,
  ListFilters,
  ConverterRecord,
  CategorySummary,
  TestRunResult,
} from './types.js';
import { RegistryLayout, hashToolDirectory } from './storage/filesystem.js';
import { RegistryDb } from './storage/db.js';
import type { ToolInvocationRow } from './storage/db.js';
import { SchemaRegistry } from './schemas/schema-registry.js';
import { BUILTIN_SCHEMAS } from './schemas/builtin.js';
import { parseToolManifest, ManifestParseError } from './manifest/parser.js';
import { validateToolManifest } from './manifest/validator.js';
import { invokeTool } from './execution/executor.js';
import { ValueStore } from './execution/value-store.js';

export class RegistryClient {
  private readonly layout: RegistryLayout;
  private readonly db: RegistryDb;
  private readonly schemas: SchemaRegistry;
  private readonly pythonPath: string | null;
  private resolvedPythonPath: string | null = null;
  private initialized = false;

  /** Resolved Python interpreter; null if probing failed. */
  get python(): string | null {
    return this.resolvedPythonPath;
  }

  constructor(options: RegistryClientOptions = {}) {
    this.layout = new RegistryLayout(options.rootDir);
    this.db = new RegistryDb(this.layout.dbPath);
    this.schemas = new SchemaRegistry();
    this.pythonPath = options.pythonPath ?? null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.layout.ensureLayout();
    const dbExistedBefore = fs.existsSync(this.layout.dbPath);
    this.db.initialize();
    // Seed the schemas table with built-ins (idempotent — INSERT OR REPLACE).
    for (const s of BUILTIN_SCHEMAS) {
      this.db.insertSchema(s);
    }
    this.initialized = true;
    if (!dbExistedBefore && fs.existsSync(this.layout.toolsDir)) {
      const hasContent = fs.readdirSync(this.layout.toolsDir).length > 0;
      if (hasContent) {
        await this.rebuildFromFilesystem();
      }
    }
    this.deployRunner();
    this.resolvedPythonPath = this.pythonPath ?? this.probePython();
  }

  private deployRunner(): void {
    const source = path.resolve(__dirname, 'python', 'runner.py');
    const dest = this.layout.runnerPath;
    const sourceBytes = fs.readFileSync(source);
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    let destHash: string | null = null;
    if (fs.existsSync(dest)) {
      destHash = createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    }
    if (destHash !== sourceHash) {
      fs.writeFileSync(dest, sourceBytes);
    }
  }

  private probePython(): string | null {
    const candidates = process.platform === 'win32'
      ? ['python', 'py']
      : ['python3', 'python'];
    for (const cmd of candidates) {
      try {
        const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
        const r = spawnSync(cmd, args, { encoding: 'utf8' });
        if (r.status === 0) {
          return cmd === 'py' ? 'py' : cmd;
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  close(): void {
    this.db.close();
    this.initialized = false;
  }

  listSchemas(): SchemaDef[] {
    return this.schemas.list();
  }

  getSchema(name: string): SchemaDef | null {
    return this.schemas.get(name);
  }

  getSchemaRegistry(): SchemaRegistry {
    return this.schemas;
  }

  async register(request: RegistrationRequest): Promise<RegistrationResult> {
    const start = Date.now();
    const caller = request.caller;

    // Stub: agent-caller tests are not implemented in phase 1+2.
    if (caller === 'agent' && request.testsRequired === true) {
      return {
        success: false,
        toolName: '',
        version: null,
        errors: [{
          category: 'internal',
          message: 'agent-caller tests not implemented in phase 1+2',
        }],
      };
    }

    // 1. Read + parse the manifest.
    let yamlText: string;
    try {
      yamlText = fs.readFileSync(request.manifestPath, 'utf8');
    } catch (err) {
      return this.failRegistration('', null, [{
        category: 'filesystem',
        message: `cannot read manifest at ${request.manifestPath}: ${(err as Error).message}`,
      }], start, caller);
    }

    let manifest: ToolManifest;
    try {
      manifest = parseToolManifest(yamlText);
    } catch (err) {
      if (err instanceof ManifestParseError) {
        return this.failRegistration('', null, [{
          category: 'manifest_parse',
          message: err.message,
          ...(err.path ? { path: err.path } : {}),
        }], start, caller);
      }
      throw err;
    }

    // 2. Semantic validation.
    const validationErrors = validateToolManifest(manifest, this.schemas);
    if (validationErrors.length > 0) {
      return this.failRegistration(manifest.name, manifest.version, validationErrors, start, caller);
    }

    // 3. Version conflict.
    const existing = this.db.getTool(manifest.name, manifest.version);
    if (existing !== null) {
      return this.failRegistration(manifest.name, manifest.version, [{
        category: 'version_conflict',
        message: `tool ${manifest.name} version ${manifest.version} already registered`,
      }], start, caller);
    }

    // 4. Verify the entry-point file exists.
    const sourceDir = path.dirname(request.manifestPath);
    const [entryFile] = manifest.implementation.entryPoint.split(':');
    const entryPath = path.join(sourceDir, entryFile);
    if (!fs.existsSync(entryPath)) {
      return this.failRegistration(manifest.name, manifest.version, [{
        category: 'entry_point_missing',
        message: `entry point file not found: ${entryPath}`,
      }], start, caller);
    }

    // 5. Tests stub: not run in this slice for non-agent callers.
    const testsRequired = request.testsRequired ?? false;
    const testsRun = 0;
    const testsPassed = 0;

    // 6. Stage: copy manifest + impl + optional files into a staging dir.
    const staged = this.layout.createStagingDir();
    try {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const name = e.name;
        if (name === 'tool.yaml' || name === entryFile || name === 'tests.py' || name === 'README.md') {
          fs.copyFileSync(path.join(sourceDir, name), path.join(staged, name));
        }
      }

      // 7. Compute hash over the staged contents.
      const toolHash = hashToolDirectory(staged);

      // 8. Build the ToolRecord.
      const now = new Date().toISOString();
      const targetDir = this.layout.toolVersionDir(manifest.name, manifest.version);
      const record: ToolRecord = {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        category: manifest.category ?? null,
        tags: manifest.tags ?? [],
        inputs: this.portsFromManifest(manifest.inputs, 'input'),
        outputs: this.portsFromManifest(manifest.outputs, 'output'),
        entryPoint: manifest.implementation.entryPoint,
        language: 'python',
        requires: manifest.implementation.requires ?? [],
        stability: manifest.metadata?.stability ?? null,
        costClass: manifest.metadata?.costClass ?? null,
        author: manifest.metadata?.author ?? null,
        createdAt: manifest.metadata?.createdAt ?? now,
        changeType: manifest.change_type,
        toolHash,
        status: 'active',
        directory: targetDir,
      };

      // 9. SQL transaction + atomic rename.
      try {
        this.db.withTransaction(() => {
          this.db.insertTool(record, testsRun, testsPassed, testsRequired, manifest);
          this.db.appendRegistrationLog({
            timestamp: now,
            toolName: manifest.name,
            version: manifest.version,
            caller,
            outcome: 'success',
            errorMessage: null,
            testsRun,
            testsPassed,
            durationMs: Date.now() - start,
          });
        });
      } catch (err) {
        this.layout.cleanupStaging(staged);
        return this.failRegistration(manifest.name, manifest.version, [{
          category: 'database',
          message: `SQL insert failed: ${(err as Error).message}`,
        }], start, caller);
      }

      try {
        this.layout.commitStaging(staged, targetDir);
      } catch (err) {
        // Best-effort rollback: DB row is already committed; accept the orphan.
        this.layout.cleanupStaging(staged);
        return this.failRegistration(manifest.name, manifest.version, [{
          category: 'filesystem',
          message: `staging commit failed: ${(err as Error).message}`,
        }], start, caller);
      }

      this.appendRegistrationLogFile({
        timestamp: now,
        toolName: manifest.name,
        version: manifest.version,
        caller,
        outcome: 'success',
        errorMessage: null,
        durationMs: Date.now() - start,
      });

      return {
        success: true,
        toolName: manifest.name,
        version: manifest.version,
        toolHash,
        testsRun,
        testsPassed,
        directory: targetDir,
      };
    } catch (err) {
      this.layout.cleanupStaging(staged);
      return this.failRegistration(manifest.name, manifest.version, [{
        category: 'internal',
        message: (err as Error).message,
      }], start, caller);
    }
  }

  private portsFromManifest(
    ports: Record<string, ToolPortSpec>,
    direction: 'input' | 'output',
  ): ResolvedPort[] {
    return Object.entries(ports).map(([name, spec], idx) => ({
      name,
      direction,
      schemaName: spec.schema,
      required: spec.required ?? true,
      default: spec.default,
      description: spec.description ?? null,
      position: idx,
    }));
  }

  private failRegistration(
    toolName: string,
    version: number | null,
    errors: RegistrationError[],
    start: number,
    caller: 'seed' | 'human' | 'agent',
  ): RegistrationResult {
    const now = new Date().toISOString();
    const errorMessage = errors.map((e) => e.message).join('; ');
    try {
      this.db.appendRegistrationLog({
        timestamp: now,
        toolName,
        version,
        caller,
        outcome: 'failure',
        errorMessage,
        testsRun: null,
        testsPassed: null,
        durationMs: Date.now() - start,
      });
    } catch {
      // Fall through: failure logging is best-effort.
    }
    this.appendRegistrationLogFile({
      timestamp: now,
      toolName,
      version,
      caller,
      outcome: 'failure',
      errorMessage,
      durationMs: Date.now() - start,
    });
    return { success: false, toolName, version, errors };
  }

  private appendRegistrationLogFile(row: {
    timestamp: string;
    toolName: string;
    version: number | null;
    caller: string;
    outcome: string;
    errorMessage: string | null;
    durationMs: number;
  }): void {
    const line = `${row.timestamp}\t${row.outcome}\t${row.caller}\t${row.toolName}\tv${row.version ?? '?'}\t${row.durationMs}ms\t${row.errorMessage ?? ''}\n`;
    try {
      fs.appendFileSync(path.join(this.layout.logsDir, 'registration.log'), line);
    } catch {
      // Best-effort.
    }
  }

  get(name: string, version?: number): ToolRecord | null {
    const record = this.db.getTool(name, version);
    return record ? this.withDirectory(record) : null;
  }

  getAllVersions(name: string): ToolRecord[] {
    return this.db.getAllVersions(name).map((r) => this.withDirectory(r));
  }

  list(filters?: ListFilters): ToolRecord[] {
    return this.db.listTools(filters).map((r) => this.withDirectory(r));
  }

  findProducers(schemaName: string): ToolRecord[] {
    return this.db.findProducers(schemaName).map((r) => this.withDirectory(r));
  }

  findConsumers(schemaName: string): ToolRecord[] {
    return this.db.findConsumers(schemaName).map((r) => this.withDirectory(r));
  }

  findConverter(source: string, target: string): ConverterRecord | null {
    return this.db.findConverter(source, target);
  }

  listTools(filters?: ListFilters): ToolRecord[] {
    return this.db.listTools(filters ?? {}).map((r) => this.withDirectory(r));
  }

  getTool(name: string, version: number): ToolRecord | null {
    const record = this.db.getTool(name, version);
    return record ? this.withDirectory(record) : null;
  }

  getToolsByName(name: string): ToolRecord[] {
    return this.db.getToolsByName(name).map((r) => this.withDirectory(r));
  }

  listConverters(): ConverterRecord[] {
    return this.db.listConverters();
  }

  getConverter(src: string, tgt: string): ConverterRecord | null {
    return this.db.getConverter(src, tgt);
  }

  searchTools(query: string): ToolRecord[] {
    return this.db.searchTools(query).map((r) => this.withDirectory(r));
  }

  listCategories(): CategorySummary[] {
    return this.db.listCategories();
  }

  async runTests(name: string, version: number): Promise<TestRunResult> {
    const record = this.db.getTool(name, version);
    if (!record) throw new Error(`tool not found: ${name} v${version}`);
    const fullRecord = this.withDirectory(record);
    const testsPath = path.join(fullRecord.directory, 'tests.py');
    if (!fs.existsSync(testsPath)) {
      return { toolName: name, version, passed: 0, failed: 0, errors: 0, durationMs: 0, stdout: '', stderr: 'tests.py not found' };
    }
    const python = this.resolvedPythonPath;
    if (!python) {
      throw new Error('python_unavailable');
    }
    const start = Date.now();
    const result = spawnSync(python, ['-m', 'pytest', testsPath, '--tb=short', '-q'], {
      encoding: 'utf8',
      timeout: 60_000,
      cwd: fullRecord.directory,
    });
    const durationMs = Date.now() - start;
    const stdout = result.stdout ?? '';
    const passedMatch = stdout.match(/(\d+) passed/);
    const failedMatch = stdout.match(/(\d+) failed/);
    const errorsMatch = stdout.match(/(\d+) error/);
    return {
      toolName: name,
      version,
      passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
      failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
      errors: errorsMatch ? parseInt(errorsMatch[1], 10) : 0,
      durationMs,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  private withDirectory(record: ToolRecord): ToolRecord {
    return { ...record, directory: this.layout.toolVersionDir(record.name, record.version) };
  }

  async invoke(request: InvocationRequest, valueStore?: ValueStore | null): Promise<InvocationResult> {
    const tool = this.get(request.toolName, request.version);
    if (!tool) {
      return {
        success: false,
        error: {
          category: 'tool_not_found',
          message: `tool ${request.toolName}${request.version ? ` v${request.version}` : ''} not found`,
        },
        metrics: { durationMs: 0 },
      };
    }
    const resolvedVersion = tool.version;
    const result = await invokeTool(
      {
        schemas: this.schemas,
        runnerPath: this.layout.runnerPath,
        pythonPath: this.resolvedPythonPath,
        valueStore: valueStore ?? null,
        registryModuleDir: __dirname,
      },
      tool,
      request,
    );
    if (request.callerContext?.workflowRunId) {
      try {
        const invRow: ToolInvocationRow = {
          toolName: request.toolName,
          toolVersion: resolvedVersion,
          runId: request.callerContext.workflowRunId,
          nodeName: request.callerContext.nodeName,
          scope: request.callerContext.scope ?? null,
          durationMs: result.metrics.durationMs,
          success: result.success,
        };
        this.db.insertToolInvocation(invRow);
      } catch (err) {
        console.error('[RegistryClient] Failed to log tool invocation:', err);
      }
    }
    return result;
  }

  async rebuildFromFilesystem(): Promise<void> {
    if (!this.initialized) {
      throw new Error('rebuildFromFilesystem called before initialize');
    }
    if (!fs.existsSync(this.layout.toolsDir)) return;

    // Truncate the derived tables (registration_log is kept).
    const raw = this.db.raw();
    raw.exec('DELETE FROM tool_ports; DELETE FROM tools;');

    const toolNames = fs.readdirSync(this.layout.toolsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const toolName of toolNames) {
      const toolDir = path.join(this.layout.toolsDir, toolName);
      const versions = fs.readdirSync(toolDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
        .map((d) => d.name);
      for (const v of versions) {
        const versionDir = path.join(toolDir, v);
        const manifestPath = path.join(versionDir, 'tool.yaml');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = parseToolManifest(fs.readFileSync(manifestPath, 'utf8'));
          const errors = validateToolManifest(manifest, this.schemas);
          if (errors.length > 0) continue;
          const record: ToolRecord = {
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            category: manifest.category ?? null,
            tags: manifest.tags ?? [],
            inputs: this.portsFromManifest(manifest.inputs, 'input'),
            outputs: this.portsFromManifest(manifest.outputs, 'output'),
            entryPoint: manifest.implementation.entryPoint,
            language: 'python',
            requires: manifest.implementation.requires ?? [],
            stability: manifest.metadata?.stability ?? null,
            costClass: manifest.metadata?.costClass ?? null,
            author: manifest.metadata?.author ?? null,
            createdAt: manifest.metadata?.createdAt ?? new Date().toISOString(),
            changeType: manifest.change_type,
            toolHash: hashToolDirectory(versionDir),
            status: 'active',
            directory: versionDir,
          };
          this.db.insertTool(record, 0, 0, false);
        } catch {
          // Skip malformed versions; operator can inspect logs/registration.log.
        }
      }
    }
  }
}
