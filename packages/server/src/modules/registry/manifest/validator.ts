import type { RegistrationError, ToolManifest } from '../types.js';
import type { SchemaRegistry } from '../schemas/schema-registry.js';

const NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const ENTRY_POINT_REGEX = /^[^:]+\.py:[a-zA-Z_][a-zA-Z0-9_]*$/;

export function validateToolManifest(
  manifest: ToolManifest,
  schemas: SchemaRegistry,
): RegistrationError[] {
  const errors: RegistrationError[] = [];

  if (!manifest.name || manifest.name.trim() === '') {
    errors.push({ category: 'manifest_validation', message: 'name must be non-empty', path: 'name' });
  } else if (!NAME_REGEX.test(manifest.name)) {
    errors.push({
      category: 'manifest_validation',
      message: `name "${manifest.name}" must match ${NAME_REGEX}`,
      path: 'name',
    });
  }

  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    errors.push({
      category: 'manifest_validation',
      message: `version must be a positive integer (got ${manifest.version})`,
      path: 'version',
    });
  }

  if (!manifest.description || manifest.description.trim() === '') {
    errors.push({ category: 'manifest_validation', message: 'description must be non-empty', path: 'description' });
  }

  if (Object.keys(manifest.outputs).length === 0) {
    errors.push({
      category: 'manifest_validation',
      message: 'a tool must declare at least one output port',
      path: 'outputs',
    });
  }

  for (const [portName, port] of Object.entries(manifest.inputs)) {
    if (!schemas.has(port.schema)) {
      errors.push({
        category: 'schema_unknown',
        message: `input port "${portName}" references unknown schema "${port.schema}"`,
        path: `inputs.${portName}.schema`,
      });
    }
  }
  for (const [portName, port] of Object.entries(manifest.outputs)) {
    if (!schemas.has(port.schema)) {
      errors.push({
        category: 'schema_unknown',
        message: `output port "${portName}" references unknown schema "${port.schema}"`,
        path: `outputs.${portName}.schema`,
      });
    }
  }

  if (!ENTRY_POINT_REGEX.test(manifest.implementation.entryPoint)) {
    errors.push({
      category: 'manifest_validation',
      message: `implementation.entry_point must match "<file>.py:<function>" (got "${manifest.implementation.entryPoint}")`,
      path: 'implementation.entry_point',
    });
  }

  return errors;
}
