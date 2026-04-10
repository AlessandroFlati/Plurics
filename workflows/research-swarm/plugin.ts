import type { WorkflowPlugin, SignalOverride, PurposeContext, DagNodeState, WorkflowSummary, RoutingResult } from '../../packages/server/src/modules/workflow/sdk.js';
import type { SignalFile } from '../../packages/server/src/modules/workflow/types.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';

async function readJson(filePath: string): Promise<any> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function readJsonSafe(filePath: string): Promise<any | null> {
  try { return await readJson(filePath); } catch { return null; }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

// ========== DIGEST FUNCTIONS (Tier 2) ==========

function digestManifestForHypothesist(manifest: any): string {
  const lines: string[] = ['## Available Data\n'];

  // Column overview (compact: name + type + missing)
  if (manifest.column_profiles) {
    lines.push('### Columns');
    lines.push('| Name | Type | Missing% | Unique |');
    lines.push('|------|------|----------|--------|');
    for (const c of manifest.column_profiles) {
      lines.push(`| ${c.name} | ${c.semantic_type} | ${(c.null_pct ?? 0).toFixed(1)} | ${c.n_unique ?? '-'} |`);
    }
    lines.push('');
  }

  // Dataset stats
  if (manifest.dataset) {
    lines.push(`Rows: ${manifest.dataset.rows}, Columns: ${manifest.dataset.columns}`);
  }

  // Top correlations
  if (manifest.correlations?.length) {
    lines.push('\n### Strongest Correlations\n');
    for (const corr of manifest.correlations.slice(0, 10)) {
      const varA = corr.variable_a ?? corr.x;
      const varB = corr.variable_b ?? corr.y;
      const r = corr.pearson_r ?? corr.value ?? corr.abs_value;
      lines.push(`- ${varA} <-> ${varB} (r=${typeof r === 'number' ? r.toFixed(3) : r})`);
    }
  }

  // Analysis leads
  if (manifest.analysis_leads?.length) {
    lines.push('\n### Analysis Leads\n');
    for (const lead of manifest.analysis_leads) {
      lines.push(`**${lead.id ?? ''}** [${lead.priority}] ${lead.description}`);
      if (lead.evidence) lines.push(`  Evidence: ${lead.evidence}`);
      if (lead.suggested_hypothesis_type) lines.push(`  Type: ${lead.suggested_hypothesis_type}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function digestRelevantColumns(manifest: any, hypothesis: any): string {
  const varNames = extractVariableNames(hypothesis);
  if (varNames.length === 0) return '';

  const lines: string[] = ['## Relevant Column Profiles\n'];
  const profiles = manifest.column_profiles ?? manifest.columns ?? [];

  for (const col of profiles) {
    if (!varNames.includes(col.name)) continue;
    lines.push(`**${col.name}** (${col.semantic_type ?? col.dtype})`);
    lines.push(`  N=${col.total_count ?? col.count ?? '-'}, missing=${(col.null_pct ?? col.missing_pct ?? 0).toFixed(1)}%, unique=${col.n_unique ?? '-'}`);
    const stats = col.stats ?? col;
    if (stats.mean !== undefined && stats.mean !== null) {
      lines.push(`  mean=${Number(stats.mean).toFixed(3)}, std=${Number(stats.std ?? 0).toFixed(3)}, median=${Number(stats.median ?? stats.p50 ?? 0).toFixed(3)}`);
      lines.push(`  range: [${stats.min}, ${stats.max}]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function digestAllHypotheses(hypotheses: Record<string, any>, results: Record<string, any>, falsifications: Record<string, any>): string {
  const lines: string[] = ['## Hypothesis Summary\n'];
  lines.push('| ID | Type | Statement | Status | p-value | Effect |');
  lines.push('|----|------|-----------|--------|---------|--------|');

  for (const [id, h] of Object.entries(hypotheses).sort()) {
    const r = results[id];
    const f = falsifications[id];

    const status = f?.survived === false ? 'falsified'
      : r?.passes_acceptance ? 'validated'
      : r ? 'not_significant'
      : 'pending';

    const pVal = r?.p_value != null ? Number(r.p_value).toExponential(2) : '-';
    const effect = r?.effect_size != null ? Number(r.effect_size).toFixed(3) : '-';
    const stmt = (h.statement ?? h.title ?? '').slice(0, 60);

    lines.push(`| ${id} | ${h.type ?? '-'} | ${stmt} | ${status} | ${pVal} | ${effect} |`);
  }

  return lines.join('\n');
}

// ========== HANDOFF COMPUTATION ==========

async function computeExecutorHandoff(sharedDir: string, signal: SignalFile): Promise<void> {
  const scope = signal.scope;
  if (!scope) return;

  const resultPath = path.join(sharedDir, 'data', 'results', `${scope}-result.json`);
  const result = await readJsonSafe(resultPath);
  if (!result) return;

  const hypPath = path.join(sharedDir, 'data', 'hypotheses', `${scope}.json`);
  const hypothesis = await readJsonSafe(hypPath);

  const handoff = {
    hypothesis_id: scope,
    test: result.test_performed,
    effect: {
      metric: result.effect_size_metric,
      value: result.effect_size,
      ci: result.confidence_interval,
    },
    p: result.p_value,
    n: result.n_observations ?? result.sample_size,
    passes: result.passes_acceptance,
    variables: hypothesis ? extractVariableNames(hypothesis) : [],
  };

  const handoffDir = path.join(sharedDir, 'data', 'results');
  await fs.mkdir(handoffDir, { recursive: true });
  await writeJsonAtomic(path.join(handoffDir, `${scope}-result.handoff`), handoff);
}

async function computeFalsifierHandoff(sharedDir: string, signal: SignalFile): Promise<void> {
  const scope = signal.scope;
  if (!scope) return;

  const falsPath = path.join(sharedDir, 'data', 'audit', `${scope}-falsification.json`);
  const fals = await readJsonSafe(falsPath);
  if (!fals) return;

  const handoff = {
    hypothesis_id: scope,
    survived: fals.survived,
    routing: fals.routing,
    checks_run: fals.checks_run,
    checks_falsified: fals.checks_falsified,
    robustness_score: fals.checks_run > 0
      ? ((fals.checks_run - fals.checks_falsified) / fals.checks_run).toFixed(2)
      : null,
  };

  await writeJsonAtomic(path.join(sharedDir, 'data', 'audit', `${scope}-falsification.handoff`), handoff);
}

// ========== PLUGIN ==========

const plugin: WorkflowPlugin = {

  async onWorkflowStart(workspacePath: string, config: Record<string, unknown>): Promise<void> {
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');

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

    await writeJsonAtomic(
      path.join(sharedDir, 'hypothesis-counter.json'),
      { next_id: 1 },
    );

    for (const dir of ['data/hypotheses', 'data/test-plans', 'data/scripts', 'data/results', 'data/audit', 'findings']) {
      await fs.mkdir(path.join(sharedDir, dir), { recursive: true });
    }
  },

  async onWorkflowResume(workspacePath: string, config: Record<string, unknown>, completedNodes: Array<{ name: string; scope: string | null; signal: SignalFile | null }>): Promise<void> {
    // Reconstruct test registry from completed executor signals
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    const registryPath = path.join(sharedDir, 'test-registry.json');

    // If registry already exists on disk, use it (it was persisted during the original run)
    const existing = await readJsonSafe(registryPath);
    if (existing && existing.entries?.length > 0) return;

    // Otherwise reconstruct from completed executor nodes
    const registry = {
      budget: (config.max_total_tests as number) ?? 50,
      tests_executed: 0,
      tests_remaining: (config.max_total_tests as number) ?? 50,
      significance_threshold_current: (config.base_significance as number) ?? 0.05,
      entries: [] as any[],
    };

    for (const node of completedNodes) {
      if (node.name.startsWith('executor') && node.signal?.status === 'success') {
        await updateTestRegistry(workspacePath, node.signal);
      }
    }
  },

  async onSignalReceived(nodeName: string, signal: SignalFile, workspacePath: string): Promise<SignalOverride | null> {
    const agentBase = nodeName.split('.')[0];
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');

    // Compute handoffs for downstream agents
    if (agentBase === 'executor' && signal.status === 'success') {
      await updateTestRegistry(workspacePath, signal);
      await computeExecutorHandoff(sharedDir, signal);
    }

    if (agentBase === 'falsifier' && signal.status === 'success') {
      await computeFalsifierHandoff(sharedDir, signal);
    }

    // Check budget exhaustion
    if (['architect', 'executor', 'falsifier'].includes(agentBase)) {
      try {
        const registry = await readJson(path.join(sharedDir, 'test-registry.json'));
        if (registry.tests_remaining <= 0 && signal.status !== 'budget_exhausted') {
          return { status: 'budget_exhausted' };
        }
      } catch { /* not yet written */ }
    }

    return null;
  },

  async onPurposeGenerate(nodeName: string, basePurpose: string, context: PurposeContext): Promise<string> {
    const sharedDir = path.join(context.workspacePath, '.plurics', 'shared');
    const dataDir = path.join(sharedDir, 'data');
    const sections: string[] = [basePurpose];
    const agentBase = nodeName.split('.')[0];
    const scope = context.scope;

    try {
      switch (agentBase) {

        case 'hypothesist': {
          // Tier 2: manifest digest (not full manifest)
          const manifest = await readJsonSafe(path.join(sharedDir, 'profiling-report.json'));
          if (manifest) sections.push(digestManifestForHypothesist(manifest));
          // Tier 1: hypothesis counter (tiny)
          const counter = await readJsonSafe(path.join(sharedDir, 'hypothesis-counter.json'));
          if (counter) sections.push(`## ID Counter\nNext ID: ${counter.next_id}`);
          break;
        }

        case 'adversary': {
          // Tier 1: batch JSON (inline, it's what they review)
          if (scope) {
            // Scoped: reviewing a single hypothesis
          } else {
            const batchNum = context.retryCount > 0 ? context.retryCount : 1;
            const batch = await readJsonSafe(path.join(dataDir, 'hypotheses', `batch-${batchNum}.json`));
            if (batch) sections.push(`## Batch to Review\n\n\`\`\`json\n${JSON.stringify(batch, null, 2)}\n\`\`\``);
          }
          // Tier 2: manifest digest
          const manifest = await readJsonSafe(path.join(sharedDir, 'profiling-report.json'));
          if (manifest) sections.push(digestManifestForHypothesist(manifest));
          break;
        }

        case 'judge': {
          // Tier 1: reviewed batch (inline)
          const reviewed = await readJsonSafe(path.join(dataDir, 'hypotheses', 'batch-1-reviewed.json'));
          if (reviewed) sections.push(`## Reviewed Batch\n\n\`\`\`json\n${JSON.stringify(reviewed, null, 2)}\n\`\`\``);
          // Tier 2: brief manifest summary
          const manifest = await readJsonSafe(path.join(sharedDir, 'profiling-report.json'));
          if (manifest) {
            sections.push(`## Data Summary\n${summarizeManifest(manifest)}`);
          }
          break;
        }

        case 'architect': {
          // Tier 1: hypothesis (small)
          if (scope) {
            const hyp = await readJsonSafe(path.join(dataDir, 'hypotheses', `${scope}.json`));
            if (hyp) sections.push(`## Hypothesis\n\n\`\`\`json\n${JSON.stringify(hyp, null, 2)}\n\`\`\``);
            // Tier 2: relevant columns only
            const manifest = await readJsonSafe(path.join(sharedDir, 'profiling-report.json'));
            if (manifest && hyp) sections.push(digestRelevantColumns(manifest, hyp));
          }
          break;
        }

        case 'coder': {
          if (scope) {
            // Tier 1: hypothesis + test plan (both small, central to task)
            const hyp = await readJsonSafe(path.join(dataDir, 'hypotheses', `${scope}.json`));
            const plan = await readJsonSafe(path.join(dataDir, 'test-plans', `${scope}-plan.json`));
            if (hyp) sections.push(`## Hypothesis\n\n\`\`\`json\n${JSON.stringify(hyp, null, 2)}\n\`\`\``);
            if (plan) sections.push(`## Test Plan\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``);
            // Tier 2: relevant column profiles
            const manifest = await readJsonSafe(path.join(sharedDir, 'profiling-report.json'));
            if (manifest && hyp) sections.push(digestRelevantColumns(manifest, hyp));
          }
          break;
        }

        case 'auditor': {
          if (scope) {
            // Tier 1: test plan + hypothesis (for context)
            const plan = await readJsonSafe(path.join(dataDir, 'test-plans', `${scope}-plan.json`));
            const hyp = await readJsonSafe(path.join(dataDir, 'hypotheses', `${scope}.json`));
            if (plan) sections.push(`## Test Plan\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``);
            if (hyp) sections.push(`## Hypothesis\n\n\`\`\`json\n${JSON.stringify(hyp, null, 2)}\n\`\`\``);
            // Tier 3: script path (auditor reads it itself)
            sections.push(`\nScript to audit: .plurics/shared/data/scripts/${scope}.py`);
          }
          break;
        }

        case 'fixer': {
          if (scope) {
            // Tier 1: audit report (what to fix)
            const audit = await readJsonSafe(path.join(dataDir, 'audit', `${scope}-audit.json`));
            if (audit) sections.push(`## Audit Report\n\n\`\`\`json\n${JSON.stringify(audit, null, 2)}\n\`\`\``);
            // Tier 1: test plan (for context)
            const plan = await readJsonSafe(path.join(dataDir, 'test-plans', `${scope}-plan.json`));
            if (plan) sections.push(`## Test Plan\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``);
            // Tier 3: script path
            sections.push(`\nScript to fix: .plurics/shared/data/scripts/${scope}.py`);
          }
          break;
        }

        case 'executor': {
          if (scope) {
            // Tier 1: minimal hypothesis context (just what's needed to run)
            const hyp = await readJsonSafe(path.join(dataDir, 'hypotheses', `${scope}.json`));
            if (hyp) {
              sections.push(`## Hypothesis: ${hyp.title ?? scope}\nVariables: ${extractVariableNames(hyp).join(', ')}`);
            }
            // Tier 3: script path (executor runs it)
            sections.push(`\nScript to execute: .plurics/shared/data/scripts/${scope}.py`);
          }
          break;
        }

        case 'falsifier': {
          if (scope) {
            // Tier 1: hypothesis (small)
            const hyp = await readJsonSafe(path.join(dataDir, 'hypotheses', `${scope}.json`));
            if (hyp) sections.push(`## Hypothesis\n\n\`\`\`json\n${JSON.stringify(hyp, null, 2)}\n\`\`\``);
            // Tier 1: executor handoff (compact) or full result as fallback
            const handoff = await readJsonSafe(path.join(dataDir, 'results', `${scope}-result.handoff`));
            const result = handoff ?? await readJsonSafe(path.join(dataDir, 'results', `${scope}-result.json`));
            if (result) sections.push(`## Test Result\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
            // Tier 2: relevant column profiles
            const manifest = await readJsonSafe(path.join(sharedDir, 'profiling-report.json'));
            if (manifest && hyp) sections.push(digestRelevantColumns(manifest, hyp));
            // Tier 3: data reference
            sections.push(`\nDataset: .plurics/shared/data/dataset.parquet`);
          }
          break;
        }

        case 'generalizer': {
          if (scope) {
            // Tier 1: hypothesis + result + falsification handoff
            const hyp = await readJsonSafe(path.join(dataDir, 'hypotheses', `${scope}.json`));
            const result = await readJsonSafe(path.join(dataDir, 'results', `${scope}-result.json`));
            const falsHandoff = await readJsonSafe(path.join(dataDir, 'audit', `${scope}-falsification.handoff`));
            const fals = falsHandoff ?? await readJsonSafe(path.join(dataDir, 'audit', `${scope}-falsification.json`));
            if (hyp) sections.push(`## Hypothesis\n\n\`\`\`json\n${JSON.stringify(hyp, null, 2)}\n\`\`\``);
            if (result) sections.push(`## Result\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
            if (fals) sections.push(`## Falsification\n\n\`\`\`json\n${JSON.stringify(fals, null, 2)}\n\`\`\``);
            // Tier 2: relevant columns
            const manifest = await readJsonSafe(path.join(sharedDir, 'profiling-report.json'));
            if (manifest && hyp) sections.push(digestRelevantColumns(manifest, hyp));
            sections.push(`\nDataset: .plurics/shared/data/dataset.parquet`);
          }
          break;
        }

        case 'reporter': {
          if (scope) {
            // Tier 1: all artifacts for this hypothesis (reporter synthesizes them)
            const hyp = await readJsonSafe(path.join(dataDir, 'hypotheses', `${scope}.json`));
            const result = await readJsonSafe(path.join(dataDir, 'results', `${scope}-result.json`));
            const fals = await readJsonSafe(path.join(dataDir, 'audit', `${scope}-falsification.json`));
            const gen = await readJsonSafe(path.join(dataDir, 'audit', `${scope}-generalized.json`));
            if (hyp) sections.push(`## Hypothesis\n\n\`\`\`json\n${JSON.stringify(hyp, null, 2)}\n\`\`\``);
            if (result) sections.push(`## Result\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
            if (fals) sections.push(`## Falsification\n\n\`\`\`json\n${JSON.stringify(fals, null, 2)}\n\`\`\``);
            if (gen) sections.push(`## Generalization\n\n\`\`\`json\n${JSON.stringify(gen, null, 2)}\n\`\`\``);
          }
          break;
        }

        case 'meta_analyst': {
          // Tier 2: compact digest of all hypotheses
          const hypDir = path.join(dataDir, 'hypotheses');
          const resDir = path.join(dataDir, 'results');
          const auditDir = path.join(dataDir, 'audit');
          const hypotheses: Record<string, any> = {};
          const results: Record<string, any> = {};
          const falsifications: Record<string, any> = {};

          try {
            for (const f of await fs.readdir(hypDir)) {
              if (f.match(/^H-\d+\.json$/)) {
                hypotheses[f.replace('.json', '')] = await readJson(path.join(hypDir, f));
              }
            }
          } catch { /* dir may not exist */ }
          try {
            for (const f of await fs.readdir(resDir)) {
              if (f.match(/^H-\d+-result\.json$/)) {
                const id = f.replace('-result.json', '');
                results[id] = await readJson(path.join(resDir, f));
              }
            }
          } catch { /* dir may not exist */ }
          try {
            for (const f of await fs.readdir(auditDir)) {
              if (f.match(/^H-\d+-falsification\.json$/)) {
                const id = f.replace('-falsification.json', '');
                falsifications[id] = await readJson(path.join(auditDir, f));
              }
            }
          } catch { /* dir may not exist */ }

          sections.push(digestAllHypotheses(hypotheses, results, falsifications));

          // Tier 1: test registry (small)
          const registry = await readJsonSafe(path.join(sharedDir, 'test-registry.json'));
          if (registry) sections.push(`## Test Registry\n\nBudget: ${registry.budget}, Executed: ${registry.tests_executed}, Threshold: ${registry.significance_threshold_current}`);

          // Tier 3: full files as reference
          sections.push(`\nFull hypotheses: .plurics/shared/data/hypotheses/`);
          sections.push(`Full results: .plurics/shared/data/results/`);
          sections.push(`Findings: .plurics/shared/findings/`);
          break;
        }
      }
    } catch { /* digest failures are not fatal */ }

    // Test budget for budget-aware agents (compact)
    if (['executor', 'architect', 'falsifier'].includes(agentBase)) {
      const registry = await readJsonSafe(path.join(sharedDir, 'test-registry.json'));
      if (registry) {
        sections.push(`## Test Budget\nExecuted: ${registry.tests_executed}, Remaining: ${registry.tests_remaining}, Threshold: ${registry.significance_threshold_current}`);
      }
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

// ========== RESEARCH-DOMAIN HELPERS ==========

async function updateTestRegistry(workspacePath: string, signal: SignalFile): Promise<void> {
  const registryPath = path.join(workspacePath, '.plurics', 'shared', 'test-registry.json');
  const registry = await readJson(registryPath);

  const resultOutput = signal.outputs.find(o => o.path.includes('result'));
  if (!resultOutput) return;

  let resultPath = resultOutput.path;
  if (!resultPath.startsWith('.plurics/')) resultPath = path.join('.plurics', resultPath);
  const result = await readJsonSafe(path.join(workspacePath, resultPath));
  if (!result) return;

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
  const cols = manifest.column_profiles ?? manifest.columns ?? [];
  return [
    `Rows: ${manifest.dataset?.rows ?? manifest.metadata?.row_count ?? '?'}`,
    `Columns: ${cols.map((c: any) => `${c.name}(${c.semantic_type})`).join(', ')}`,
  ].join('\n');
}

function extractVariableNames(hypothesis: any): string[] {
  const vars: string[] = [];
  // New-style: variables.primary / variables.secondary
  if (hypothesis.variables) {
    if (hypothesis.variables.primary) vars.push(hypothesis.variables.primary);
    if (hypothesis.variables.secondary) vars.push(hypothesis.variables.secondary);
    if (hypothesis.variables.covariates) vars.push(...hypothesis.variables.covariates);
    if (hypothesis.variables.grouping) vars.push(hypothesis.variables.grouping);
  }
  // Old-style: payload.x / payload.y
  const payload = hypothesis.payload;
  if (payload?.x) vars.push(payload.x.name ?? payload.x);
  if (payload?.y) vars.push(payload.y.name ?? payload.y);
  if (payload?.variable) vars.push(payload.variable.name ?? payload.variable);
  if (payload?.treatment) vars.push(payload.treatment.name ?? payload.treatment);
  if (payload?.outcome) vars.push(payload.outcome.name ?? payload.outcome);
  if (payload?.variables) vars.push(...payload.variables.map((v: any) => v.name ?? v));
  if (hypothesis.confounders) vars.push(...hypothesis.confounders);
  return [...new Set(vars.filter(Boolean))];
}
