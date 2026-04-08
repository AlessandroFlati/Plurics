import type { WorkflowPlugin, SignalOverride, PurposeContext, DagNodeState, WorkflowSummary } from '../../packages/server/src/modules/workflow/sdk.js';
import type { SignalFile } from '../../packages/server/src/modules/workflow/types.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';

async function readJson(filePath: string): Promise<any> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

const plugin: WorkflowPlugin = {

  async onWorkflowStart(workspacePath: string, config: Record<string, unknown>): Promise<void> {
    const sharedDir = path.join(workspacePath, '.caam', 'shared');

    // Initialize test registry
    await writeJsonAtomic(
      path.join(sharedDir, 'test-registry.json'),
      {
        budget: (config.max_total_tests as number) ?? 50,
        tests_executed: 0,
        tests_remaining: (config.max_total_tests as number) ?? 50,
        significance_threshold_current: (config.base_significance as number) ?? 0.05,
        entries: [],
      },
    );

    // Initialize hypothesis counter
    await writeJsonAtomic(
      path.join(sharedDir, 'hypothesis-counter.json'),
      { next_id: 1 },
    );

    // Create domain-specific directories
    for (const dir of ['hypotheses', 'test-plans', 'scripts', 'results', 'audit']) {
      await fs.mkdir(path.join(sharedDir, dir), { recursive: true });
    }
  },

  async onSignalReceived(nodeName: string, signal: SignalFile, workspacePath: string): Promise<SignalOverride | null> {
    // After executor completes: update test registry with BH correction
    if (nodeName.startsWith('executor') && signal.status === 'success') {
      await updateTestRegistry(workspacePath, signal);
    }

    // Check budget exhaustion
    if (['architect', 'executor', 'falsifier'].some(n => nodeName.startsWith(n))) {
      try {
        const registry = await readJson(
          path.join(workspacePath, '.caam', 'shared', 'test-registry.json'),
        );
        if (registry.tests_remaining <= 0 && signal.status !== 'budget_exhausted') {
          return { status: 'budget_exhausted' };
        }
      } catch { /* registry not yet written */ }
    }

    return null;
  },

  async onPurposeGenerate(nodeName: string, basePurpose: string, context: PurposeContext): Promise<string> {
    const sharedDir = path.join(context.workspacePath, '.caam', 'shared');
    const sections: string[] = [basePurpose];
    const agentBase = nodeName.split('.')[0];

    // Inject manifest slice based on agent type
    try {
      const manifest = await readJson(path.join(sharedDir, 'profiling-report.json'));

      switch (agentBase) {
        case 'hypothesist':
        case 'adversary':
        case 'generalizer':
        case 'meta_analyst':
          sections.push(`## Data Manifest\n\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\``);
          break;

        case 'judge':
          sections.push(`## Data Summary\n\n${summarizeManifest(manifest)}`);
          break;

        case 'architect':
        case 'coder':
        case 'auditor':
        case 'fixer':
        case 'falsifier':
          if (context.scope) {
            try {
              const hypothesis = await readJson(path.join(sharedDir, 'hypotheses', `${context.scope}.json`));
              const vars = extractVariableNames(hypothesis);
              const filtered = filterManifestColumns(manifest, vars);
              sections.push(`## Relevant Column Profiles\n\n\`\`\`json\n${JSON.stringify(filtered, null, 2)}\n\`\`\``);
            } catch { /* hypothesis not found */ }
          }
          break;
      }
    } catch { /* manifest not yet written */ }

    // Inject test budget for budget-aware agents
    if (['executor', 'architect', 'falsifier'].includes(agentBase)) {
      try {
        const registry = await readJson(path.join(sharedDir, 'test-registry.json'));
        sections.push([
          `## Test Budget`,
          `Tests executed: ${registry.tests_executed}`,
          `Tests remaining: ${registry.tests_remaining}`,
          `Current significance threshold (BH-adjusted): ${registry.significance_threshold_current}`,
          `If tests_remaining is 0, write a signal with status "budget_exhausted".`,
        ].join('\n'));
      } catch { /* not yet written */ }
    }

    // Retry context
    if (context.retryCount > 0 && context.previousError) {
      sections.push([
        `## Previous Attempt (FAILED)`,
        `Attempt: ${context.retryCount + 1}`,
        `Error: ${context.previousError.category} -- ${context.previousError.message}`,
        `Analyze what went wrong and take a different approach.`,
      ].join('\n'));
    }

    return sections.join('\n\n---\n\n');
  },

  onEvaluateReadiness(nodeName: string, allNodes: Map<string, DagNodeState>): boolean | null {
    if (nodeName === 'meta_analyst') {
      const scopedNodes = [...allNodes.values()].filter(n => n.scope !== null);
      const judgeNodes = [...allNodes.values()].filter(n => n.name.startsWith('judge'));

      const allScopedDone = scopedNodes.length > 0
        && scopedNodes.every(n => ['completed', 'failed', 'skipped'].includes(n.state));

      const judgeExhaustedNoFanout = judgeNodes.length > 0
        && judgeNodes.every(n => n.state === 'completed')
        && scopedNodes.length === 0;

      if (allScopedDone || judgeExhaustedNoFanout) return true;
    }
    return null;
  },

  async onWorkflowComplete(_workspacePath: string, _summary: WorkflowSummary): Promise<void> {
    // Meta-analyst writes the final report as part of the pipeline.
  },
};

export default plugin;

// -- Research-domain helpers --

async function updateTestRegistry(workspacePath: string, signal: SignalFile): Promise<void> {
  const registryPath = path.join(workspacePath, '.caam', 'shared', 'test-registry.json');
  const registry = await readJson(registryPath);

  const resultOutput = signal.outputs.find(o => o.path.includes('result'));
  if (!resultOutput) return;

  const result = await readJson(path.join(workspacePath, '.caam', resultOutput.path));

  registry.entries.push({
    hypothesis_id: signal.scope,
    test_type: result.test_performed,
    raw_p_value: result.p_value,
    adjusted_p_value: null,
    effect_size: result.effect_size,
    significant_after_correction: false,
    timestamp: new Date().toISOString(),
  });

  registry.tests_executed = registry.entries.length;
  registry.tests_remaining = registry.budget - registry.tests_executed;

  applyBenjaminiHochberg(registry);
  await writeJsonAtomic(registryPath, registry);
}

function applyBenjaminiHochberg(registry: any): void {
  const n = registry.entries.length;
  if (n === 0) return;

  const sorted = registry.entries
    .map((e: any, i: number) => ({ entry: e, index: i }))
    .sort((a: any, b: any) => a.entry.raw_p_value - b.entry.raw_p_value);

  for (let rank = 0; rank < sorted.length; rank++) {
    sorted[rank].entry.adjusted_p_value = Math.min(
      1.0,
      sorted[rank].entry.raw_p_value * n / (rank + 1),
    );
  }

  for (let i = sorted.length - 2; i >= 0; i--) {
    sorted[i].entry.adjusted_p_value = Math.min(
      sorted[i].entry.adjusted_p_value,
      sorted[i + 1].entry.adjusted_p_value,
    );
  }

  const alpha = 0.05;
  for (const { entry } of sorted) {
    entry.significant_after_correction = entry.adjusted_p_value <= alpha;
  }

  const lastSignificant = sorted.filter((s: any) => s.entry.significant_after_correction).pop();
  registry.significance_threshold_current = lastSignificant
    ? lastSignificant.entry.raw_p_value
    : alpha / n;
}

function summarizeManifest(manifest: any): string {
  return [
    `Dataset: ${manifest.metadata.source_file}`,
    `Rows: ${manifest.metadata.row_count}, Columns: ${manifest.metadata.column_count}`,
    `Time series: ${manifest.metadata.is_time_series ? 'Yes (' + manifest.metadata.time_frequency + ')' : 'No'}`,
    `Columns: ${manifest.columns.map((c: any) => c.name + ' (' + c.semantic_type + ')').join(', ')}`,
    `Quality score: ${manifest.quality.overall_score}/100`,
  ].join('\n');
}

function extractVariableNames(hypothesis: any): string[] {
  const vars: string[] = [];
  const payload = hypothesis.payload;
  if (payload?.x) vars.push(payload.x.name);
  if (payload?.y) vars.push(payload.y.name);
  if (payload?.variable) vars.push(payload.variable.name);
  if (payload?.treatment) vars.push(payload.treatment.name);
  if (payload?.outcome) vars.push(payload.outcome.name);
  if (payload?.variables) vars.push(...payload.variables.map((v: any) => v.name));
  vars.push(...(hypothesis.confounders || []));
  return [...new Set(vars)];
}

function filterManifestColumns(manifest: any, vars: string[]): any {
  return {
    metadata: manifest.metadata,
    columns: manifest.columns.filter((c: any) => vars.includes(c.name)),
    correlations: manifest.correlations?.filter(
      (c: any) => vars.includes(c.x) && vars.includes(c.y),
    ) ?? [],
  };
}
