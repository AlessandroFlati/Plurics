import { randomBytes, createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
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
