import { randomBytes, createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import type { DagNode } from './types.js';

export async function writeJsonAtomic(filepath: string, data: unknown): Promise<void> {
  const tmpPath = `${filepath}.${randomBytes(4).toString('hex')}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, filepath);
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function buildSignalFilename(node: Pick<DagNode, 'name' | 'scope' | 'retryCount'>): string {
  let filename = node.name;
  if (node.scope) filename += `.${node.scope}`;
  if (node.retryCount > 0) filename += `.retry-${node.retryCount}`;
  return `${filename}.done.json`;
}

export async function computeSha256(filepath: string): Promise<string> {
  const content = await fs.readFile(filepath);
  return createHash('sha256').update(content).digest('hex');
}

export async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Platform directory name inside each workspace.
 * Historically ".caam/", renamed to ".plurics/" post-rebrand.
 */
export const PLURICS_DIR = '.plurics';
export const LEGACY_DIR = '.caam';

/**
 * Resolve a workspace-relative path inside the platform directory.
 * Prefers `.plurics/...`; if that does not exist on disk but `.caam/...`
 * does, returns the legacy path. Use this when READING artifacts from
 * potentially-migrated workspaces.
 *
 * For writes, always use `.plurics/` directly.
 */
export function resolvePluricsPath(workspacePath: string, ...segments: string[]): string {
  const modernPath = path.join(workspacePath, PLURICS_DIR, ...segments);
  if (fsSync.existsSync(modernPath)) return modernPath;
  const legacyPath = path.join(workspacePath, LEGACY_DIR, ...segments);
  if (fsSync.existsSync(legacyPath)) return legacyPath;
  return modernPath;
}

/**
 * Normalize a path written by an LLM agent.
 * Strips duplicate .plurics/ or .caam/ prefix (legacy), converts backslashes
 * to forward slashes. Use this everywhere an agent-written path is consumed
 * by the platform.
 *
 * The .caam/ prefix is accepted for backward compatibility: presets authored
 * before the rename may still instruct agents to write to .caam/..., and
 * in-flight runs across the migration boundary must not break.
 */
export function normalizeAgentPath(rawPath: string): string {
  let p = rawPath.replace(/\\/g, '/');
  // Strip leading .plurics/ (current) or .caam/ (legacy) — the caller will prepend it
  if (p.startsWith('.plurics/')) p = p.slice(9);
  else if (p.startsWith('.caam/')) p = p.slice(6);
  // Strip leading / if any
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

/**
 * Wait for terminal output matching a pattern before proceeding.
 * Resolves when the pattern is found, rejects on timeout.
 */
export function waitForOutput(
  session: { onOutput: (cb: (data: string) => void) => (() => void) },
  pattern: RegExp,
  options: { timeout?: number; pollInterval?: number } = {},
): Promise<string> {
  const { timeout = 30000 } = options;
  let buffer = '';

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`waitForOutput timed out after ${timeout}ms waiting for ${pattern}`));
    }, timeout);

    const unsub = session.onOutput((data: string) => {
      buffer += data;
      if (pattern.test(buffer)) {
        clearTimeout(timer);
        unsub();
        resolve(buffer);
      }
    });
  });
}

/**
 * Normalize a raw signal object from an LLM agent.
 * Centralizes all tolerances: field aliases, path normalization, schema flexibility.
 * Call this BEFORE schema validation.
 */
export function normalizeAgentSignal(raw: Record<string, unknown>): Record<string, unknown> {
  // Normalize outputs array
  if (Array.isArray(raw.outputs)) {
    raw.outputs = (raw.outputs as Record<string, unknown>[]).map(out => {
      // size -> size_bytes alias
      if (out.size !== undefined && out.size_bytes === undefined) {
        out.size_bytes = out.size;
      }
      // Normalize path
      if (typeof out.path === 'string') {
        out.path = normalizeAgentPath(out.path);
      }
      return out;
    });
  }

  // Normalize decision: any truthy object/string is kept as-is.
  // The platform will try decision.goto for routing; plugin handles the rest.

  return raw;
}
