import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { SignalFile, ValidationResult } from './types.js';
import { computeSha256, fileExists, normalizeAgentPath } from './utils.js';

export function validateSignalSchema(signal: unknown): signal is SignalFile {
  if (typeof signal !== 'object' || signal === null) return false;
  const s = signal as Record<string, unknown>;

  if (s.schema_version !== 1) return false;
  if (typeof s.signal_id !== 'string') return false;
  if (typeof s.agent !== 'string') return false;
  if (s.scope !== null && typeof s.scope !== 'string') return false;
  if (!['success', 'failure', 'branch', 'budget_exhausted'].includes(s.status as string)) return false;

  if (s.decision !== null && s.decision !== undefined) {
    // Decision can be any structure — goto/reason are optional.
    // The DAG executor interprets the decision based on node branch rules.
    if (typeof s.decision !== 'object' && typeof s.decision !== 'string') return false;
  }

  if (!Array.isArray(s.outputs)) return false;
  for (const o of s.outputs as unknown[]) {
    if (typeof o !== 'object' || o === null) return false;
    const out = o as Record<string, unknown>;
    if (typeof out.path !== 'string') return false;
    if (typeof out.sha256 !== 'string') return false;
    if (typeof out.size_bytes !== 'number') return false; // normalizeAgentSignal maps size -> size_bytes
  }

  if (typeof s.metrics !== 'object' || s.metrics === null) return false;
  const m = s.metrics as Record<string, unknown>;
  if (typeof m.duration_seconds !== 'number') return false;
  if (typeof m.retries_used !== 'number') return false;

  if (s.error !== null) {
    if (typeof s.error !== 'object') return false;
    const e = s.error as Record<string, unknown>;
    if (typeof e.category !== 'string') return false;
    if (typeof e.message !== 'string') return false;
    if (typeof e.recoverable !== 'boolean') return false;
  }

  return true;
}

export async function validateSignalOutputs(
  workspacePath: string,
  signal: SignalFile,
): Promise<ValidationResult> {
  const errors: ValidationResult['errors'] = [];

  for (const output of signal.outputs) {
    const outputPath = normalizeAgentPath(output.path);
    const fullPath = path.join(workspacePath, '.plurics', outputPath);

    if (!await fileExists(fullPath)) {
      errors.push({ path: output.path, issue: 'missing', expected: 'exists', actual: null });
      continue;
    }

    const stat = await fs.stat(fullPath);
    const expectedSize = output.size_bytes;
    if (expectedSize !== undefined && stat.size !== expectedSize) {
      errors.push({ path: output.path, issue: 'size_mismatch', expected: expectedSize, actual: stat.size });
      continue;
    }

    const hash = await computeSha256(fullPath);
    if (hash !== output.sha256) {
      errors.push({ path: output.path, issue: 'sha256_mismatch', expected: output.sha256, actual: hash });
      continue;
    }

    if (output.path.endsWith('.json')) {
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        JSON.parse(content);
      } catch {
        errors.push({ path: output.path, issue: 'json_parse_failed', expected: 'valid JSON', actual: 'parse error' });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateOutputNamespace(
  scope: string | null,
  signal: SignalFile,
  allowedPatterns: string[],
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const output of signal.outputs) {
    // Check scope containment
    if (scope && !output.path.includes(scope)) {
      violations.push(`Output "${output.path}" does not contain scope "${scope}"`);
    }

    // Check against allowed patterns (if declared)
    if (allowedPatterns.length > 0) {
      const matches = allowedPatterns.some(pattern => {
        const regex = pattern
          .replace(/\{hypothesis_id\}/g, scope || '[^/]+')
          .replace(/\*/g, '[^/]*')
          .replace(/\*\*/g, '.*');
        return new RegExp(regex).test(output.path);
      });
      if (!matches) {
        violations.push(`Output "${output.path}" does not match any allowed pattern: ${allowedPatterns.join(', ')}`);
      }
    }
  }

  return { valid: violations.length === 0, violations };
}
