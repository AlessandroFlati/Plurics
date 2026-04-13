import { parse as parseYaml } from 'yaml';
import type { ToolManifest, ToolPortSpec, Stability, CostClass, ChangeType } from '../types.js';
import { parseTypeExpr, ParseError } from '../../workflow/type-parser.js';

const VALID_CHANGE_TYPES = new Set<string>(['net_new', 'additive', 'destructive']);

export class ManifestParseError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = 'ManifestParseError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, path: string): string {
  if (typeof v !== 'string') {
    throw new ManifestParseError(`${path} must be a string`, path);
  }
  return v;
}

function asOptionalString(v: unknown, path: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new ManifestParseError(`${path} must be a string`, path);
  }
  return v;
}

function asInteger(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new ManifestParseError(`${path} must be an integer`, path);
  }
  return v;
}

function asPortMap(v: unknown, path: string): Record<string, ToolPortSpec> {
  if (v === undefined || v === null) return {};
  if (!isRecord(v)) {
    throw new ManifestParseError(`${path} must be a mapping`, path);
  }
  const out: Record<string, ToolPortSpec> = {};
  for (const [key, raw] of Object.entries(v)) {
    const portPath = `${path}.${key}`;
    if (!isRecord(raw)) {
      throw new ManifestParseError(`${portPath} must be a mapping`, portPath);
    }
    const schema = raw.schema;
    if (typeof schema !== 'string') {
      throw new ManifestParseError(`${portPath}.schema is required and must be a string`, portPath);
    }
    let parsedTypeExpr: ToolPortSpec['parsedTypeExpr'] = undefined;
    if (schema.includes('[')) {
      try {
        parsedTypeExpr = parseTypeExpr(schema);
      } catch (err) {
        if (err instanceof ParseError) {
          throw new ManifestParseError(
            `${portPath}.schema contains an invalid parametrized type expression: ${err.message}`,
            portPath,
          );
        }
        throw err;
      }
    }
    const port: ToolPortSpec = { schema, ...(parsedTypeExpr !== undefined ? { parsedTypeExpr } : {}) };
    if ('required' in raw) {
      if (typeof raw.required !== 'boolean') {
        throw new ManifestParseError(`${portPath}.required must be a boolean`, portPath);
      }
      port.required = raw.required;
    }
    if ('default' in raw) {
      port.default = raw.default;
    }
    if ('description' in raw) {
      port.description = asOptionalString(raw.description, `${portPath}.description`);
    }
    out[key] = port;
  }
  return out;
}

export function parseToolManifest(yamlText: string): ToolManifest {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    throw new ManifestParseError(`YAML parse error: ${(err as Error).message}`);
  }
  if (!isRecord(doc)) {
    throw new ManifestParseError('manifest must be a mapping at the top level');
  }

  const name = asString(doc.name, 'name');
  const version = asInteger(doc.version, 'version');
  const rawChangeType = doc.change_type;
  if (rawChangeType === undefined || rawChangeType === null) {
    throw new ManifestParseError('change_type is required', 'change_type');
  }
  if (typeof rawChangeType !== 'string' || !VALID_CHANGE_TYPES.has(rawChangeType)) {
    throw new ManifestParseError(
      `change_type must be one of net_new|additive|destructive (got "${String(rawChangeType)}")`,
      'change_type',
    );
  }
  const description = asString(doc.description, 'description');

  const implRaw = doc.implementation;
  if (!isRecord(implRaw)) {
    throw new ManifestParseError('implementation is required and must be a mapping', 'implementation');
  }
  const language = asString(implRaw.language, 'implementation.language');
  if (language !== 'python') {
    throw new ManifestParseError(`implementation.language must be "python" (got "${language}")`, 'implementation.language');
  }
  const entryPoint = asString(implRaw.entry_point, 'implementation.entry_point');
  let requires: string[] | undefined;
  if ('requires' in implRaw && implRaw.requires !== undefined) {
    if (!Array.isArray(implRaw.requires) || implRaw.requires.some((r) => typeof r !== 'string')) {
      throw new ManifestParseError('implementation.requires must be a list of strings', 'implementation.requires');
    }
    requires = implRaw.requires as string[];
  }

  const manifest: ToolManifest = {
    name,
    version,
    change_type: rawChangeType as ChangeType,
    description,
    inputs: asPortMap(doc.inputs, 'inputs'),
    outputs: asPortMap(doc.outputs, 'outputs'),
    implementation: { language: 'python', entryPoint, ...(requires ? { requires } : {}) },
  };

  if ('category' in doc) {
    manifest.category = asOptionalString(doc.category, 'category');
  }
  if ('tags' in doc && doc.tags !== undefined) {
    if (!Array.isArray(doc.tags) || doc.tags.some((t) => typeof t !== 'string')) {
      throw new ManifestParseError('tags must be a list of strings', 'tags');
    }
    manifest.tags = doc.tags as string[];
  }
  if ('tests' in doc && doc.tests !== undefined) {
    if (!isRecord(doc.tests)) {
      throw new ManifestParseError('tests must be a mapping', 'tests');
    }
    const file = asString(doc.tests.file, 'tests.file');
    const required = doc.tests.required;
    if (typeof required !== 'boolean') {
      throw new ManifestParseError('tests.required must be a boolean', 'tests.required');
    }
    manifest.tests = { file, required };
  }
  if ('metadata' in doc && doc.metadata !== undefined) {
    if (!isRecord(doc.metadata)) {
      throw new ManifestParseError('metadata must be a mapping', 'metadata');
    }
    const md = doc.metadata;
    const meta: NonNullable<ToolManifest['metadata']> = {};
    if (md.author !== undefined) {
      meta.author = asString(md.author, 'metadata.author');
    }
    if (md.created_at !== undefined) {
      meta.createdAt = asString(md.created_at, 'metadata.created_at');
    }
    if (md.stability !== undefined) {
      const s = asString(md.stability, 'metadata.stability');
      if (s !== 'experimental' && s !== 'stable' && s !== 'deprecated') {
        throw new ManifestParseError(
          `metadata.stability must be one of experimental|stable|deprecated (got "${s}")`,
          'metadata.stability',
        );
      }
      meta.stability = s as Stability;
    }
    if (md.cost_class !== undefined) {
      const c = asString(md.cost_class, 'metadata.cost_class');
      if (c !== 'fast' && c !== 'medium' && c !== 'slow') {
        throw new ManifestParseError(
          `metadata.cost_class must be one of fast|medium|slow (got "${c}")`,
          'metadata.cost_class',
        );
      }
      meta.costClass = c as CostClass;
    }
    if (md.is_converter === true) {
      meta.isConverter = true;
    }
    if (typeof md.source_schema === 'string') {
      meta.sourceSchema = md.source_schema;
    }
    if (typeof md.target_schema === 'string') {
      meta.targetSchema = md.target_schema;
    }
    manifest.metadata = meta;
  }

  return manifest;
}
