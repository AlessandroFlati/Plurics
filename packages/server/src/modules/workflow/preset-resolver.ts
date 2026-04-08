import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PresetRepository } from '../../db/preset-repository.js';

/**
 * Resolves a preset name to its content.
 * Lookup order:
 * 1. Filesystem: workflows/presets/{name}.md (relative to project root)
 * 2. Database: agent_presets table by name
 * 3. Fallback: generic description
 */
export function resolvePresetContent(
  presetName: string,
  projectRoot: string,
  presetRepo: PresetRepository,
): string {
  // 1. Try filesystem
  const filePath = path.join(projectRoot, 'workflows', 'presets', ...presetName.split('/')) + '.md';
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // Fall through to DB
  }

  // 2. Try database
  const dbPreset = presetRepo.list().find(p => p.name === presetName);
  if (dbPreset) {
    return dbPreset.purpose;
  }

  // 3. Fallback
  return `You are the ${presetName} agent.`;
}

/**
 * Resolves {{PLACEHOLDER}} syntax in a preset template.
 * Unknown placeholders are left as-is.
 */
export function resolvePlaceholders(
  template: string,
  variables: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in variables) {
      return String(variables[key]);
    }
    return match;
  });
}

/**
 * Scans workflows/presets/ and imports all .md files into the DB
 * as agent presets. Skips presets that already exist (by name).
 * Returns the number of newly imported presets.
 */
export function seedPresetsFromFilesystem(
  projectRoot: string,
  presetRepo: PresetRepository,
): number {
  const presetsDir = path.join(projectRoot, 'workflows', 'presets');
  if (!fs.existsSync(presetsDir)) return 0;

  const existingNames = new Set(presetRepo.list().map(p => p.name));
  let imported = 0;

  function scanDir(dir: string, prefix: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md')) {
        const name = prefix
          ? `${prefix}/${entry.name.replace(/\.md$/, '')}`
          : entry.name.replace(/\.md$/, '');

        if (!existingNames.has(name)) {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
          // Extract first heading as a summary, use full content as purpose
          const firstLine = content.split('\n').find(l => l.startsWith('# '));
          const summary = firstLine ? firstLine.replace(/^#\s+/, '').trim() : name;
          presetRepo.create({ name, purpose: content });
          imported++;
        }
      }
    }
  }

  scanDir(presetsDir, '');
  return imported;
}
