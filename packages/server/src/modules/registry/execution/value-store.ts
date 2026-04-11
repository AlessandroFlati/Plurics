/**
 * ValueStore — in-memory per-run store for structured Python values (pickle envelopes).
 *
 * Phase 2 scope: single in-memory Map<handle, StoredValue>. All values go to the
 * same map regardless of whether they originate from a tool node or a reasoning node
 * (stub). The scope-local / run-level distinction is plumbed in the API surface but
 * has no behavioral difference until NR Phase 3 adds the tool-calling loop.
 *
 * Disk layout (per flush):
 *   {runsDir}/runs/{runId}/values/{handle}.pkl.b64      — JSON: envelope + provenance
 *   {runsDir}/runs/{runId}/values/{handle}.summary.json — JSON: ValueSummary (if present)
 *
 * See: docs/superpowers/specs/2026-04-11-node-runtimes-phase-2-design.md §7
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ValueEnvelope, ValueSummary, StoredValue } from '../types.js';

export class ValueStore {
  /** In-memory map from handle → StoredValue. */
  private readonly map: Map<string, StoredValue> = new Map();

  /**
   * @param runId    Identifier for the current workflow run.
   * @param runsDir  Root directory under which run data is stored.
   *                 Values directory: {runsDir}/runs/{runId}/values/
   */
  constructor(
    private readonly runId: string,
    private readonly runsDir: string,
  ) {}

  /**
   * Store an envelope and return a new handle.
   *
   * Handle format: vs-{yyyyMMddTHHmmss}-{sanitizedNode}-{sanitizedPort}-{sha256[:8]}
   *
   * The timestamp and hash together guarantee uniqueness even if two ports in the
   * same node produce the same bytes at the same millisecond (hash covers _data).
   *
   * Phase 2 note: scope-local and run-level are the same tier. Phase 3 will
   * introduce a scope-local store that the tool-calling loop writes to; run-level
   * handles persist across scope boundaries within a run.
   */
  store(
    envelope: ValueEnvelope,
    summary: ValueSummary | null,
    nodeName: string,
    portName: string,
  ): string {
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', 'T').slice(0, 15);
    const sanNode = sanitize(nodeName);
    const sanPort = sanitize(portName);
    const hash = crypto.createHash('sha256').update(envelope._data).digest('hex').slice(0, 8);
    const handle = `vs-${ts}-${sanNode}-${sanPort}-${hash}`;

    const stored: StoredValue = {
      handle,
      envelope,
      summary,
      schema: envelope._schema,
      createdAt: new Date().toISOString(),
      nodeName,
      portName,
    };
    this.map.set(handle, stored);
    return handle;
  }

  /** Resolve a handle to its stored value, or null if not found. */
  resolve(handle: string): StoredValue | null {
    return this.map.get(handle) ?? null;
  }

  /** True if the handle exists in this store. */
  has(handle: string): boolean {
    return this.map.has(handle);
  }

  /** Return all handles currently held in memory. */
  handles(): string[] {
    return [...this.map.keys()];
  }

  /**
   * Persist all in-memory envelopes to disk.
   * Each stored value becomes two files in {runsDir}/runs/{runId}/values/:
   *   {handle}.pkl.b64      — JSON with envelope + provenance fields
   *   {handle}.summary.json — JSON ValueSummary (only if summary is non-null)
   *
   * Idempotent: re-flushing an already-persisted handle overwrites the files.
   */
  async flush(): Promise<void> {
    const valuesDir = this.valuesDir();
    await fs.mkdir(valuesDir, { recursive: true });

    const writes: Promise<void>[] = [];
    for (const [handle, stored] of this.map) {
      const envelopeFile: Record<string, unknown> = {
        handle: stored.handle,
        schema: stored.schema,
        nodeName: stored.nodeName,
        portName: stored.portName,
        createdAt: stored.createdAt,
        envelope: stored.envelope,
      };
      writes.push(
        fs.writeFile(
          path.join(valuesDir, `${handle}.pkl.b64`),
          JSON.stringify(envelopeFile),
          'utf-8',
        ),
      );
      if (stored.summary !== null) {
        writes.push(
          fs.writeFile(
            path.join(valuesDir, `${handle}.summary.json`),
            JSON.stringify(stored.summary),
            'utf-8',
          ),
        );
      }
    }
    await Promise.all(writes);
  }

  /**
   * Load previously-flushed envelopes from disk into the in-memory map.
   * Files with malformed JSON are skipped with a console.warn; they do not
   * abort loading. Call this once at workflow resume / cold-start.
   */
  async loadRunLevel(): Promise<void> {
    const valuesDir = this.valuesDir();
    let entries: import('node:fs').Dirent[];
    try {
      const { readdir } = await import('node:fs/promises');
      entries = await readdir(valuesDir, { withFileTypes: true });
    } catch {
      // Directory doesn't exist — first run, nothing to load.
      return;
    }

    for (const entry of entries) {
      if (!entry.name.endsWith('.pkl.b64')) continue;
      const handle = entry.name.slice(0, -'.pkl.b64'.length);
      const filePath = path.join(valuesDir, entry.name);

      let parsed: Record<string, unknown>;
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        console.warn(`[ValueStore] Skipping malformed file: ${filePath}`);
        continue;
      }

      const envelope = parsed.envelope as ValueEnvelope | undefined;
      if (!envelope || envelope._encoding !== 'pickle_b64') {
        console.warn(`[ValueStore] Skipping invalid envelope in: ${filePath}`);
        continue;
      }

      // Load optional summary sidecar
      let summary: ValueSummary | null = null;
      const summaryPath = path.join(valuesDir, `${handle}.summary.json`);
      try {
        const raw = await fs.readFile(summaryPath, 'utf-8');
        summary = JSON.parse(raw) as ValueSummary;
      } catch {
        // No sidecar — summary stays null
      }

      const stored: StoredValue = {
        handle,
        envelope,
        summary,
        schema: (parsed.schema as string) ?? envelope._schema,
        createdAt: (parsed.createdAt as string) ?? new Date().toISOString(),
        nodeName: (parsed.nodeName as string) ?? '',
        portName: (parsed.portName as string) ?? '',
      };
      this.map.set(handle, stored);
    }
  }

  private valuesDir(): string {
    return path.join(this.runsDir, 'runs', this.runId, 'values');
  }
}

/** Sanitize a name for embedding in a handle: replace non-alphanumeric with _, truncate to 20. */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
}
