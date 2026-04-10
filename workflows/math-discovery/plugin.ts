/**
 * Math Discovery Plugin
 *
 * Responsibilities:
 * 1. Evolutionary pool management (add/update conjectures, fitness scoring)
 * 2. Tiered purpose injection (data profile digest, pool context, relevant data)
 * 3. Prover self-correction loop (compound node: prover <-> lean_check internally)
 * 4. Lean project management (file placement, incremental theorem migration)
 * 5. Phase C gate (only run backtester if enough confirmed findings)
 * 6. Routing decisions for conjecturer, selector, synthesizer, prover
 */

import type {
  WorkflowPlugin, SignalOverride, PurposeContext, DagNodeState,
  WorkflowSummary, RoutingResult, EvolutionaryContext,
} from '../../packages/server/src/modules/workflow/sdk.js';
import type { SignalFile } from '../../packages/server/src/modules/workflow/types.js';
import type { EvolutionaryPool, PoolCandidate } from '../../packages/server/src/modules/workflow/evolutionary-pool.js';
import { computeCompositeFitness } from '../../packages/server/src/modules/workflow/evolutionary-pool.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';

// ========== HELPERS ==========

async function readJson<T = any>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, 'utf-8'));
}

async function readJsonSafe<T = any>(p: string): Promise<T | null> {
  try { return await readJson<T>(p); } catch { return null; }
}

async function readFileSafe(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf-8'); } catch { return null; }
}

async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, p);
}

async function writeFileAtomic(p: string, content: string): Promise<void> {
  const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, p);
}

const DEFAULT_WEIGHTS = {
  novelty: 0.25,
  plausibility: 0.30,
  formalizability: 0.20,
  relevance: 0.25,
};

// ========== DIGEST FUNCTIONS ==========

function digestDataProfile(profile: any): string {
  const lines: string[] = ['## Data Profile Summary\n'];

  if (profile.series_profiles?.length) {
    lines.push('### Series Overview');
    lines.push('| Symbol | TF | n | Mean | Std | Skew | Kurt | Fat Tails | Stationary |');
    lines.push('|--------|----|---|------|-----|------|------|-----------|------------|');
    for (const s of profile.series_profiles) {
      const r = s.returns;
      lines.push(`| ${s.symbol} | ${s.timeframe} | ${r.n} | ${r.mean.toExponential(2)} | ${r.std.toFixed(4)} | ${r.skewness.toFixed(2)} | ${r.kurtosis.toFixed(2)} | ${r.has_fat_tails ? 'Y' : 'N'} | ${s.stationarity.is_stationary ? 'Y' : 'N'} |`);
    }
    lines.push('');
  }

  if (profile.correlations?.length) {
    lines.push('### Cross-Series Correlations (|r| > 0.3)');
    const strong = profile.correlations.filter((c: any) => Math.abs(c.pearson ?? 0) > 0.3).slice(0, 15);
    for (const c of strong) {
      lines.push(`- ${c.series_a} <-> ${c.series_b}: pearson=${c.pearson.toFixed(3)}, spearman=${c.spearman.toFixed(3)}`);
    }
    lines.push('');
  }

  if (profile.regimes?.length) {
    lines.push('### Regime Changes Detected');
    for (const r of profile.regimes) {
      lines.push(`- ${r.series}: ${r.n_regimes} regimes (${r.method}), ${r.changepoints.length} changepoints`);
    }
    lines.push('');
  }

  if (profile.analysis_leads?.length) {
    lines.push('### Analysis Leads');
    for (const lead of profile.analysis_leads) {
      lines.push(`**${lead.id}** [${lead.priority}] ${lead.description}`);
      lines.push(`  Evidence: ${lead.evidence}`);
      lines.push(`  Domain: ${lead.suggested_domain}\n`);
    }
  }

  return lines.join('\n');
}

function digestPoolContext(ctx: EvolutionaryContext): string {
  const sections: string[] = [];

  if (ctx.positiveExamples.length > 0) {
    sections.push('## Successful Conjectures (build on these)\n');
    for (const c of ctx.positiveExamples) {
      sections.push(`**${c.id}** (fitness=${c.fitness.composite.toFixed(2)}) — ${(c.metadata.title as string) ?? 'untitled'}`);
      sections.push(`  ${c.content.slice(0, 300)}${c.content.length > 300 ? '...' : ''}\n`);
    }
  }

  if (ctx.negativeExamples.length > 0) {
    sections.push('## Falsified Conjectures (do NOT repeat)\n');
    for (const c of ctx.negativeExamples) {
      sections.push(`**${c.id}** — ${(c.metadata.title as string) ?? 'untitled'}`);
      const reason = c.metadata.rejection_reason as string | undefined;
      if (reason) sections.push(`  Reason: ${reason.slice(0, 300)}`);
      sections.push('');
    }
  }

  if (ctx.confirmedFindings.length > 0) {
    sections.push('## Confirmed Findings (previously proved)\n');
    for (const c of ctx.confirmedFindings) {
      sections.push(`- **${c.id}**: ${(c.metadata.title as string) ?? 'untitled'} — fitness ${c.fitness.composite.toFixed(2)}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

function digestConjectureForFormalizer(conjecture: any): string {
  return [
    `## Conjecture to Formalize`,
    ``,
    `**ID:** ${conjecture.id}`,
    `**Type:** ${conjecture.type}`,
    `**Domain:** ${conjecture.domain}`,
    ``,
    `### Natural Language Statement`,
    conjecture.natural_language,
    ``,
    `### Formal Sketch (pseudo-Lean)`,
    '```',
    conjecture.formal_sketch,
    '```',
    ``,
    `### Variables`,
    ...conjecture.variables.map((v: any) => `- \`${v.name}\`: ${v.type} from ${v.source}`),
  ].join('\n');
}

// ========== LEAN PROJECT MANAGEMENT ==========

const LEAN_LAKEFILE = `import Lake
open Lake DSL

package "math-discovery" where
  version := v!"0.1.0"

lean_lib "MathDiscovery" where

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git" @ "v4.29.0"

@[default_target]
lean_lib "MathDiscovery"
`;

const LEAN_TOOLCHAIN = `leanprover/lean4:v4.29.0\n`;

const LEAN_BASIC_LEAN = `/-
MathDiscovery/Basic.lean — Core definitions for time series analysis.

This file provides the foundational types that all conjectures about
financial time series build upon. Import it from any Conjectures/*.lean
or Theorems/*.lean file.
-/

import Mathlib.Data.Real.Basic
import Mathlib.Analysis.SpecialFunctions.Log.Basic
import Mathlib.Topology.MetricSpace.Basic

namespace MathDiscovery

/-- A time series is a function from natural numbers (time indices) to reals. -/
def TimeSeries := ℕ → ℝ

/-- Log returns of a time series. -/
noncomputable def logReturns (p : TimeSeries) : TimeSeries :=
  fun n => Real.log (p (n + 1) / p n)

/-- Simple returns of a time series. -/
def simpleReturns (p : TimeSeries) : TimeSeries :=
  fun n => (p (n + 1) - p n) / p n

/-- A time series is strictly positive. -/
def IsPositive (p : TimeSeries) : Prop := ∀ n, p n > 0

/-- Rolling window sum. -/
def rollingSum (s : TimeSeries) (window : ℕ) : TimeSeries :=
  fun n => (Finset.range window).sum (fun i => s (n + i))

/-- Rolling window mean. -/
noncomputable def rollingMean (s : TimeSeries) (window : ℕ) : TimeSeries :=
  fun n => rollingSum s window n / (window : ℝ)

end MathDiscovery
`;

async function ensureLeanProject(projectDir: string): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(path.join(projectDir, 'MathDiscovery'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'MathDiscovery', 'Conjectures'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'MathDiscovery', 'Theorems'), { recursive: true });

  const lakefile = path.join(projectDir, 'lakefile.lean');
  if (!await readFileSafe(lakefile)) await writeFileAtomic(lakefile, LEAN_LAKEFILE);

  const toolchain = path.join(projectDir, 'lean-toolchain');
  if (!await readFileSafe(toolchain)) await writeFileAtomic(toolchain, LEAN_TOOLCHAIN);

  const basic = path.join(projectDir, 'MathDiscovery', 'Basic.lean');
  if (!await readFileSafe(basic)) await writeFileAtomic(basic, LEAN_BASIC_LEAN);
}

async function copyTheoremFromProved(projectDir: string, conjectureId: string): Promise<boolean> {
  const src = path.join(projectDir, 'MathDiscovery', 'Conjectures', `${conjectureId}.lean`);
  const dst = path.join(projectDir, 'MathDiscovery', 'Theorems', `${conjectureId}.lean`);
  const content = await readFileSafe(src);
  if (!content) return false;
  // Verify no `sorry` in the proof
  if (content.includes('sorry')) return false;
  await writeFileAtomic(dst, content);
  return true;
}

// ========== PROVER SELF-CORRECTION LOOP ==========
// The prover node is a compound node: from the DAG's perspective it runs once,
// but internally the plugin manages the retry loop between the LLM prover and
// the Lean compiler. This avoids explicit cycles in the DAG.

async function runLeanCheck(projectDir: string, conjectureId: string, timeoutMs: number): Promise<{ success: boolean; output: string; errors: string[] }> {
  const { spawn } = await import('node:child_process');

  return new Promise((resolve) => {
    const proc = spawn('lake', ['build', `MathDiscovery.Conjectures.${conjectureId}`], {
      cwd: projectDir,
      env: process.env as Record<string, string>,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ success: false, output: stdout, errors: [`lake build timed out after ${timeoutMs}ms`] });
    }, timeoutMs);

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('exit', (code) => {
      clearTimeout(timer);
      const combined = stdout + '\n' + stderr;
      // Extract error lines
      const errors = combined.split('\n').filter(l =>
        /error:/i.test(l) || /failed/i.test(l),
      );
      resolve({
        success: code === 0 && !combined.includes('sorry'),
        output: combined,
        errors,
      });
    });
  });
}

// ========== PLUGIN ==========

const plugin: WorkflowPlugin = {

  async onWorkflowStart(workspacePath: string, config: Record<string, unknown>): Promise<void> {
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    const dataDir = path.join(sharedDir, 'data');

    for (const dir of ['tables', 'conjectures', 'batch', 'reviews']) {
      await fs.mkdir(path.join(dataDir, dir), { recursive: true });
    }
    await fs.mkdir(path.join(sharedDir, 'findings'), { recursive: true });

    // Initialize Lean project
    const leanProjectDir = (config.lean_project_dir as string)?.replace('{{WORKSPACE}}', workspacePath)
      ?? path.join(sharedDir, 'lean-project');
    await ensureLeanProject(leanProjectDir);
  },

  async onWorkflowResume(
    workspacePath: string,
    _config: Record<string, unknown>,
    _completedNodes: Array<{ name: string; scope: string | null; signal: SignalFile | null }>,
  ): Promise<void> {
    // Pool is restored by the platform. Ensure Lean project still exists.
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    const leanProjectDir = path.join(sharedDir, 'lean-project');
    await ensureLeanProject(leanProjectDir);
  },

  async onSignalReceived(
    nodeName: string,
    signal: SignalFile,
    _workspacePath: string,
  ): Promise<SignalOverride | null> {
    const agentBase = nodeName.split('.')[0];

    // Compact handoffs could go here for cross-node efficiency, but for
    // math-discovery the pool already serves that purpose.
    if (agentBase === 'prover' || agentBase === 'counterexample' || agentBase === 'abstractor') {
      // These feed onEvaluationResult
      return null;
    }

    return null;
  },

  async onEvaluationResult(
    nodeName: string,
    signal: SignalFile,
    pool: EvolutionaryPool,
    workspacePath: string,
  ): Promise<void> {
    const agentBase = nodeName.split('.')[0];
    const scope = signal.scope;

    // Conjecturer: add new candidates to the pool
    if (agentBase === 'conjecturer') {
      const round = parseInt((signal.decision as any)?.round ?? '1', 10);
      const sharedDir = path.join(workspacePath, '.plurics', 'shared');
      const batchPath = path.join(sharedDir, 'data', 'batch', `round-${round}.json`);
      const batch = await readJsonSafe<{ conjectures: any[] }>(batchPath);
      if (batch?.conjectures) {
        for (const c of batch.conjectures) {
          pool.add({
            id: c.id,
            content: c.natural_language,
            fitness: {
              composite: 0, // Will be computed after Critic + Selector
              dimensions: {},
            },
            generation: round,
            parentIds: c.parentIds ?? [],
            status: 'pending',
            metadata: {
              title: c.title,
              domain: c.domain,
              type: c.type,
              formal_sketch: c.formal_sketch,
            },
          });
        }
      }
    }

    // Selector: update pool with fitness + screened status
    if (agentBase === 'selector') {
      const sharedDir = path.join(workspacePath, '.plurics', 'shared');
      const decisionsPath = path.join(sharedDir, 'data', 'reviews', 'selector-decisions.json');
      const decisions = await readJsonSafe<{ decisions: any[] }>(decisionsPath);
      if (decisions?.decisions) {
        for (const d of decisions.decisions) {
          const existing = pool.get(d.conjecture_id);
          if (!existing) continue;
          pool.update(d.conjecture_id, {
            fitness: {
              composite: computeCompositeFitness(d.fitness, DEFAULT_WEIGHTS),
              dimensions: d.fitness,
            },
            status: d.verdict === 'selected' ? 'pending' : 'superseded',
          });
        }
      }
    }

    // Prover: update status based on success/failure
    if (agentBase === 'prover' && scope) {
      const success = signal.status === 'success';
      pool.update(scope, {
        status: success ? 'confirmed' : 'inconclusive',
        metadata: {
          ...(pool.get(scope)?.metadata ?? {}),
          proof_attempts: (signal.metrics as any)?.retries_used ?? 1,
          lean_file: `.plurics/shared/lean-project/MathDiscovery/Conjectures/${scope}.lean`,
        },
      });

      // If proved, migrate to Theorems/
      if (success) {
        const leanProjectDir = path.join(workspacePath, '.plurics', 'shared', 'lean-project');
        await copyTheoremFromProved(leanProjectDir, scope);
      }
    }

    // Counterexample: mark as falsified
    if (agentBase === 'counterexample' && scope) {
      const decision = signal.decision as any;
      if (decision?.counterexample_found) {
        const rejectionPath = path.join(workspacePath, '.plurics', 'shared', 'data', 'audit', `${scope}-rejection-reason.md`);
        const reason = await readFileSafe(rejectionPath);
        pool.update(scope, {
          status: 'falsified',
          metadata: {
            ...(pool.get(scope)?.metadata ?? {}),
            rejection_reason: reason ?? 'Counterexample found but reason unavailable',
          },
        });
      }
    }

    // Abstractor: generalizes confirmed conjectures
    if (agentBase === 'abstractor' && scope) {
      const decision = signal.decision as any;
      if (decision?.generalized_id) {
        pool.update(scope, { status: 'generalized' });
      }
    }
  },

  onEvolutionaryContext(
    nodeName: string,
    round: number,
    pool: EvolutionaryPool,
  ): EvolutionaryContext | null {
    if (nodeName !== 'conjecturer' || round < 2) return null;

    return {
      positiveExamples: pool.selectForContext(3),
      negativeExamples: pool.selectAsNegativeExamples(2),
      confirmedFindings: pool.getConfirmed(),
    };
  },

  async onPurposeGenerate(
    nodeName: string,
    basePurpose: string,
    context: PurposeContext,
  ): Promise<string> {
    const sharedDir = path.join(context.workspacePath, '.plurics', 'shared');
    const dataDir = path.join(sharedDir, 'data');
    const sections: string[] = [basePurpose];
    const agentBase = nodeName.split('.')[0];
    const scope = context.scope;

    try {
      switch (agentBase) {

        case 'ohlc_fetch': {
          // Tier 1: config for what to fetch
          sections.push(`## Fetch Configuration\n`);
          sections.push(`**Symbols:** ${JSON.stringify(context.config.ohlc_symbols)}`);
          sections.push(`**Timeframes:** ${JSON.stringify(context.config.ohlc_timeframes)}`);
          sections.push(`**Months:** ${context.config.ohlc_months}`);
          break;
        }

        case 'profiler': {
          // Tier 3: OHLC tables are too large to inline — reference only
          sections.push(`## Data Location\n`);
          sections.push(`OHLC Parquet files: \`.plurics/shared/data/tables/\``);
          sections.push(`Manifest: \`.plurics/shared/data/ohlc-manifest.json\``);
          break;
        }

        case 'conjecturer': {
          // Tier 2: data profile digest
          const profile = await readJsonSafe(path.join(dataDir, 'profile.json'));
          if (profile) sections.push(digestDataProfile(profile));

          // Evolutionary context for rounds 2+
          if (context.round >= 2) {
            const evCtx = this.onEvolutionaryContext?.(nodeName, context.round, context.pool);
            if (evCtx) sections.push(digestPoolContext(evCtx));
          }

          sections.push(`## Your Task\n`);
          sections.push(`Generate exactly ${context.config.conjectures_per_round} conjectures for round ${context.round}.`);
          break;
        }

        case 'critic': {
          // Tier 1: batch of conjectures to review
          const batchPath = path.join(dataDir, 'batch', `round-${context.round}.json`);
          const batch = await readJsonSafe(batchPath);
          if (batch) sections.push(`## Batch to Review\n\n\`\`\`json\n${JSON.stringify(batch, null, 2)}\n\`\`\``);
          break;
        }

        case 'selector': {
          // Tier 1: reviewed batch from Critic
          const reviewsPath = path.join(dataDir, 'reviews', `round-${context.round}-reviews.json`);
          const reviews = await readJsonSafe(reviewsPath);
          if (reviews) sections.push(`## Critic Reviews\n\n\`\`\`json\n${JSON.stringify(reviews, null, 2)}\n\`\`\``);
          break;
        }

        case 'formalizer':
        case 'strategist':
        case 'counterexample':
        case 'abstractor': {
          if (scope) {
            const cPath = path.join(dataDir, 'conjectures', `${scope}.json`);
            const conjecture = await readJsonSafe(cPath);
            if (conjecture) sections.push(digestConjectureForFormalizer(conjecture));
          }
          break;
        }

        case 'prover': {
          if (scope) {
            // Tier 1: Lean statement + Strategist blueprint
            const leanPath = path.join(sharedDir, 'lean-project', 'MathDiscovery', 'Conjectures', `${scope}.lean`);
            const statement = await readFileSafe(leanPath);
            if (statement) sections.push(`## Lean Statement\n\n\`\`\`lean\n${statement}\n\`\`\``);

            const blueprintPath = path.join(dataDir, 'conjectures', `${scope}-blueprint.md`);
            const blueprint = await readFileSafe(blueprintPath);
            if (blueprint) sections.push(`## Proof Strategy\n\n${blueprint}`);

            // If this is a retry, include previous errors
            if (context.retryCount > 0) {
              const errorPath = path.join(dataDir, 'conjectures', `${scope}-last-error.txt`);
              const error = await readFileSafe(errorPath);
              if (error) {
                sections.push(`## Previous Compiler Errors\n\n\`\`\`\n${error}\n\`\`\``);
                sections.push(`This is attempt ${context.retryCount + 1}. Fix the errors above.`);
              }
            }
          }
          break;
        }

        case 'synthesizer': {
          // Tier 2: pool summary
          const confirmed = context.pool.getConfirmed();
          const falsified = context.pool.getFalsified();
          const total = context.pool.count();
          sections.push(`## Pool Summary`);
          sections.push(`Total candidates: ${total}`);
          sections.push(`Confirmed: ${confirmed.length}`);
          sections.push(`Falsified: ${falsified.length}`);

          if (confirmed.length > 0) {
            sections.push(`\n### Confirmed Findings\n`);
            for (const c of confirmed) {
              sections.push(`- **${c.id}**: ${(c.metadata.title as string) ?? 'untitled'} (fitness ${c.fitness.composite.toFixed(2)})`);
            }
          }

          const minConfirmed = (context.config.min_confirmed_findings_for_backtest as number) ?? 3;
          const gateOpen = confirmed.length >= minConfirmed;
          sections.push(`\n## Phase C Gate`);
          sections.push(`Minimum confirmed findings required: ${minConfirmed}`);
          sections.push(`Currently confirmed: ${confirmed.length}`);
          sections.push(`Gate status: ${gateOpen ? 'OPEN (proceed to backtest)' : 'CLOSED (continue exploration)'}`);
          break;
        }

        case 'backtest_designer': {
          // Tier 1: confirmed findings with Lean theorem names
          const confirmed = context.pool.getConfirmed();
          sections.push(`## Confirmed Findings to Derive Rules From\n`);
          for (const c of confirmed) {
            sections.push(`### ${c.id}: ${(c.metadata.title as string) ?? 'untitled'}`);
            sections.push(c.content);
            sections.push(`Lean theorem: ${(c.metadata.lean_file as string) ?? 'not available'}\n`);
          }
          break;
        }

        case 'backtester': {
          // Tier 3: spec path only (process backend reads it directly)
          sections.push(`## Spec Location\n`);
          sections.push(`Backtest spec: \`.plurics/shared/data/backtest-spec.json\``);
          break;
        }
      }
    } catch { /* digest failures are not fatal */ }

    return sections.join('\n\n---\n\n');
  },

  onEvaluateReadiness(nodeName: string, allNodes: Map<string, DagNodeState>): boolean | null {
    if (nodeName === 'synthesizer') {
      const scopedNodes = [...allNodes.values()].filter(n => n.scope !== null);
      const allScopedDone = scopedNodes.length > 0
        && scopedNodes.every(n => ['completed', 'failed', 'skipped'].includes(n.state));
      if (allScopedDone) return true;
    }
    return null;
  },

  async onResolveRouting(
    nodeName: string,
    signal: SignalFile,
    _branchRules: Array<{ condition: string; goto: string; foreach?: string }>,
  ): Promise<RoutingResult | null> {
    const agentBase = nodeName.split('.')[0];

    // Selector: route approved conjectures into the formalizer fan-out
    if (agentBase === 'selector') {
      const decision = signal.decision as any;
      if (decision?.selected_ids?.length) {
        return { goto: 'formalizer', foreach: 'selected_conjectures', payload: decision.selected_ids };
      }
    }

    // Synthesizer: gate Phase C based on confirmed count
    if (agentBase === 'synthesizer') {
      const decision = signal.decision as any;
      if (decision?.gate_open) {
        return { goto: 'backtest_designer' };
      } else {
        // Loop back to conjecturer for another round
        return { goto: 'conjecturer' };
      }
    }

    return null;
  },

  async onWorkflowComplete(_workspacePath: string, _summary: WorkflowSummary): Promise<void> {
    // The backtester writes the final report in Phase C.
  },
};

export default plugin;
