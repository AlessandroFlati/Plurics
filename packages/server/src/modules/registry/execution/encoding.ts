import type { SchemaRegistry } from '../schemas/schema-registry.js';
import type { ValueRef, ValueEnvelope } from '../types.js';
import type { ValueStore } from './value-store.js';

export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodingError';
  }
}

export interface EncodeInputsResult {
  /** The encoded inputs to send to the runner. ValueRefs pass through as-is. */
  encoded: Record<string, unknown>;
  /**
   * Map of handle → envelope for every ValueRef found in `encoded`.
   * The runner receives this as the `value_refs` top-level field.
   * Null when valueStore is null (legacy callers).
   */
  valueRefs: Record<string, ValueEnvelope> | null;
}

/**
 * Encode tool inputs for dispatch to the Python runner.
 *
 * Phase 2 changes:
 * - If valueStore is non-null and an input value is a ValueRef, it is
 *   passed through as-is, AND the corresponding envelope is added to the
 *   returned valueRefs map so the runner can resolve it.
 * - If valueStore is non-null and an input value is a raw JS value for a
 *   pickle_b64 schema, throw "raw pickle inputs not supported".
 * - If valueStore is null, a ValueRef input also throws (cannot resolve
 *   without a store). This preserves Phase 1+2 behavior for legacy callers.
 * - Handle not found in store: throw "handle_not_found: {handle}".
 */
export function encodeInputs(
  values: Record<string, unknown>,
  inputSchemas: Record<string, string>,
  schemas: SchemaRegistry,
  valueStore: ValueStore | null,
): EncodeInputsResult {
  const encoded: Record<string, unknown> = {};
  const valueRefs: Record<string, ValueEnvelope> = {};

  for (const [name, value] of Object.entries(values)) {
    const schemaName = inputSchemas[name];
    if (!schemaName) {
      throw new EncodingError(`input "${name}" has no declared schema`);
    }
    if (!schemas.has(schemaName)) {
      throw new EncodingError(`unknown schema "${schemaName}" on input "${name}"`);
    }

    if (isValueRef(value)) {
      if (valueStore === null) {
        throw new EncodingError(
          `ValueRef input "${name}" cannot be resolved without a ValueStore (no store provided)`,
        );
      }
      const stored = valueStore.resolve(value._handle);
      if (!stored) {
        throw new EncodingError(`handle_not_found: ${value._handle} (input "${name}")`);
      }
      encoded[name] = value;
      valueRefs[value._handle] = stored.envelope;
      continue;
    }

    if (schemas.encodingOf(schemaName) === 'pickle_b64') {
      throw new EncodingError(
        `raw pickle inputs are not supported — use a value handle (input "${name}" has schema "${schemaName}")`,
      );
    }

    encoded[name] = value;
  }

  return {
    encoded,
    valueRefs: valueStore !== null ? valueRefs : null,
  };
}

/**
 * Decode raw runner outputs, optionally registering structured values in the store.
 *
 * Phase 2 changes:
 * - If valueStore is non-null and an output entry is a pickle_b64 envelope,
 *   strip the optional _summary field, store the envelope, and return a ValueRef.
 * - If valueStore is null, pickle envelopes are returned as-is (Phase 1+2 compat).
 */
export function decodeOutputs(
  raw: Record<string, unknown>,
  outputSchemas: Record<string, string>,
  schemas: SchemaRegistry,
  valueStore: ValueStore | null,
  nodeName: string,
  portName: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const schemaName = outputSchemas[name] ?? 'JsonObject';
    if (
      valueStore !== null &&
      schemas.has(schemaName) &&
      schemas.encodingOf(schemaName) === 'pickle_b64' &&
      isPickleEnvelope(value)
    ) {
      // Extract optional runner-computed summary
      const rawEnv = value as Record<string, unknown>;
      const summaryPayload = rawEnv['_summary'];
      const envelope: ValueEnvelope = {
        _schema: rawEnv['_schema'] as string,
        _encoding: 'pickle_b64',
        _data: rawEnv['_data'] as string,
      };

      // Use summarizer from schema registry if available
      let summary = null;
      if (summaryPayload !== undefined) {
        const summarizer = schemas.getSummarizer(schemaName);
        summary = summarizer ? summarizer(summaryPayload) : (summaryPayload as import('../types.js').ValueSummary);
      }

      const handle = valueStore.store(envelope, summary, nodeName, name);
      const ref: ValueRef = { _type: 'value_ref', _handle: handle, _schema: schemaName };
      if (summary) ref._summary = summary;
      out[name] = ref;
    } else {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Build the JSON envelope string sent to the runner on stdin.
 * Includes the value_refs map when it is non-null and non-empty.
 * Includes input_schema_info when provided (Phase 4c: validator support).
 */
export function buildEnvelope(
  inputs: Record<string, unknown>,
  inputSchemas: Record<string, string>,
  outputSchemas: Record<string, string>,
  valueRefs?: Record<string, ValueEnvelope> | null,
  inputSchemaInfo?: Record<string, Record<string, string | null>> | null,
): string {
  const payload: Record<string, unknown> = {
    inputs,
    input_schemas: inputSchemas,
    output_schemas: outputSchemas,
  };
  if (valueRefs && Object.keys(valueRefs).length > 0) {
    payload['value_refs'] = valueRefs;
  }
  if (inputSchemaInfo && Object.keys(inputSchemaInfo).length > 0) {
    payload['input_schema_info'] = inputSchemaInfo;
  }
  return JSON.stringify(payload);
}

function isValueRef(v: unknown): v is ValueRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>)['_type'] === 'value_ref' &&
    typeof (v as Record<string, unknown>)['_handle'] === 'string'
  );
}

function isPickleEnvelope(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>)['_encoding'] === 'pickle_b64' &&
    typeof (v as Record<string, unknown>)['_data'] === 'string'
  );
}
