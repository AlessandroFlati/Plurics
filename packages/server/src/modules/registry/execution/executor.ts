import type { InvocationRequest, InvocationResult, ToolRecord } from '../types.js';
import type { SchemaRegistry } from '../schemas/schema-registry.js';
import type { ValueStore } from './value-store.js';
import { runSubprocess } from './subprocess.js';
import { buildEnvelope, encodeInputs, decodeOutputs, EncodingError } from './encoding.js';

export interface ExecutorDeps {
  schemas: SchemaRegistry;
  runnerPath: string;
  pythonPath: string | null;
  /**
   * Optional value store for the current workflow run.
   * If null (the default), pickle inputs are rejected and pickle outputs
   * are returned as raw envelopes — preserving Phase 1+2 behavior.
   * Phase 2 note: pass the run-level ValueStore from the DAG executor to
   * enable handle generation and resolution.
   */
  valueStore?: ValueStore | null;
}

export async function invokeTool(
  deps: ExecutorDeps,
  tool: ToolRecord,
  request: InvocationRequest,
): Promise<InvocationResult> {
  const start = Date.now();
  const durationMs = () => Date.now() - start;

  if (deps.pythonPath === null) {
    return {
      success: false,
      error: { category: 'python_unavailable', message: 'no Python interpreter was found at initialize time' },
      metrics: { durationMs: durationMs() },
    };
  }

  // Validate inputs against declared ports.
  const inputValidation = validateInputs(tool, request.inputs);
  if (inputValidation) {
    return {
      success: false,
      error: { category: 'validation', message: inputValidation },
      metrics: { durationMs: durationMs() },
    };
  }

  // Apply defaults for omitted optional ports.
  const mergedInputs: Record<string, unknown> = {};
  for (const port of tool.inputs) {
    if (port.name in request.inputs) {
      mergedInputs[port.name] = request.inputs[port.name];
    } else if (port.default !== undefined) {
      mergedInputs[port.name] = port.default;
    }
  }

  const inputSchemas = Object.fromEntries(tool.inputs.map((p) => [p.name, p.schemaName]));
  const outputSchemas = Object.fromEntries(tool.outputs.map((p) => [p.name, p.schemaName]));
  const valueStore = deps.valueStore ?? null;

  let envelope: string;
  try {
    const encodeResult = encodeInputs(mergedInputs, inputSchemas, deps.schemas, valueStore);
    envelope = buildEnvelope(encodeResult.encoded, inputSchemas, outputSchemas, encodeResult.valueRefs);
  } catch (err) {
    if (err instanceof EncodingError) {
      return {
        success: false,
        error: { category: 'validation', message: err.message },
        metrics: { durationMs: durationMs() },
      };
    }
    throw err;
  }

  const args = deps.pythonPath === 'py'
    ? ['-3', deps.runnerPath, tool.directory, tool.entryPoint]
    : [deps.runnerPath, tool.directory, tool.entryPoint];
  const command = deps.pythonPath === 'py' ? 'py' : deps.pythonPath;

  const sub = await runSubprocess({
    command,
    args,
    stdin: envelope,
    timeoutMs: request.timeoutMs ?? 300_000,
    maxOutputBytes: 100 * 1024 * 1024,
  });

  if (sub.kind === 'timeout') {
    return {
      success: false,
      error: { category: 'timeout', message: 'tool exceeded timeout' },
      metrics: { durationMs: durationMs() },
    };
  }
  if (sub.kind === 'spawn_error') {
    return {
      success: false,
      error: { category: 'subprocess_crash', message: sub.message },
      metrics: { durationMs: durationMs() },
    };
  }
  if (sub.kind === 'output_too_large') {
    return {
      success: false,
      error: { category: 'output_mismatch', message: 'stdout exceeded 100 MB cap', stderr: sub.stderr },
      metrics: { durationMs: durationMs() },
    };
  }

  if (sub.exitCode !== 0 && sub.exitCode !== 1) {
    return {
      success: false,
      error: {
        category: 'subprocess_crash',
        message: `runner exited with code ${sub.exitCode}`,
        stderr: sub.stderr,
      },
      metrics: { durationMs: durationMs() },
    };
  }

  let parsed: { ok: boolean; outputs?: Record<string, unknown>; error?: { message: string; type: string } };
  try {
    parsed = JSON.parse(sub.stdout);
  } catch {
    return {
      success: false,
      error: {
        category: 'output_mismatch',
        message: `runner stdout is not valid JSON (exit ${sub.exitCode})`,
        stderr: sub.stderr,
      },
      metrics: { durationMs: durationMs() },
    };
  }

  if (sub.exitCode === 1 || parsed.ok === false) {
    return {
      success: false,
      error: {
        category: 'runtime',
        message: parsed.error?.message ?? 'tool raised an error',
        stderr: sub.stderr,
      },
      metrics: { durationMs: durationMs() },
    };
  }

  const rawOutputs = parsed.outputs ?? {};
  const missing = tool.outputs.filter((p) => !(p.name in rawOutputs));
  if (missing.length > 0) {
    return {
      success: false,
      error: {
        category: 'output_mismatch',
        message: `runner omitted output ports: ${missing.map((p) => p.name).join(', ')}`,
      },
      metrics: { durationMs: durationMs() },
    };
  }
  const extras = Object.keys(rawOutputs).filter((k) => !tool.outputs.some((p) => p.name === k));
  if (extras.length > 0) {
    return {
      success: false,
      error: {
        category: 'output_mismatch',
        message: `runner emitted unknown output ports: ${extras.join(', ')}`,
      },
      metrics: { durationMs: durationMs() },
    };
  }

  // Use the requesting node name for handle provenance, fall back to tool name.
  const nodeNameForHandles = request.callerContext?.nodeName ?? tool.name;
  const outputs = decodeOutputs(rawOutputs, outputSchemas, deps.schemas, valueStore, nodeNameForHandles, '');
  return { success: true, outputs, metrics: { durationMs: durationMs() } };
}

function validateInputs(tool: ToolRecord, inputs: Record<string, unknown>): string | null {
  const declared = new Set(tool.inputs.map((p) => p.name));
  for (const port of tool.inputs) {
    if (port.required && !(port.name in inputs) && port.default === undefined) {
      return `required input "${port.name}" is missing`;
    }
  }
  for (const name of Object.keys(inputs)) {
    if (!declared.has(name)) {
      return `unknown input port: ${name}`;
    }
  }
  return null;
}
