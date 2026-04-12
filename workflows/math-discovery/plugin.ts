/**
 * Math Discovery Plugin
 */

import type {
  WorkflowPlugin,
  WorkflowStartContext,
  WorkflowResumeContext,
  WorkflowCompleteContext,
  SignalContext,
  SignalDecision,
  EvaluationContext,
  PurposeContext,
  PurposeEnrichment,
  ReadinessContext,
  ReadinessDecision,
  RoutingContext,
  RoutingDecision,
  EvolutionaryContextRequest,
  EvolutionaryContextResult,
} from '../../packages/server/src/modules/workflow/sdk.js';
import type { EvolutionaryPool, PoolCandidate, PoolSnapshot } from '../../packages/server/src/modules/workflow/evolutionary-pool.js';
import { EvolutionaryPool as EvolutionaryPoolClass, computeCompositeFitness } from '../../packages/server/src/modules/workflow/evolutionary-pool.js';
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

function digestPoolContextFromResult(result: EvolutionaryContextResult): string {
  const sections: string[] = [];

  if (result.positiveExamples.length > 0) {
    sections.push('## Successful Conjectures (build on these)\n');
    for (const c of result.positiveExamples) {
      sections.push(`**${c.id}** (fitness=${c.fitness.composite.toFixed(2)}) — ${(c.metadata.title as string) ?? 'untitled'}`);
      sections.push(`  ${c.content.slice(0, 300)}${c.content.length > 300 ? '...' : ''}\n`);
    }
  }

  if (result.negativeExamples.length > 0) {
    sections.push('## Falsified Conjectures (do NOT repeat)\n');
    for (const c of result.negativeExamples) {
      sections.push(`**${c.id}** — ${(c.metadata.title as string) ?? 'untitled'}`);
      const reason = c.metadata.rejection_reason as string | undefined;
      if (reason) sections.push(`  Reason: ${reason.slice(0, 300)}`);
      sections.push('');
    }
  }

  if (result.ancestors.length > 0) {
    sections.push('## Confirmed Findings (previously proved)\n');
    for (const c of result.ancestors) {
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
-/

import Mathlib.Data.Real.Basic
import Mathlib.Analysis.SpecialFunctions.Log.Basic
import Mathlib.Topology.MetricSpace.Basic

namespace MathDiscovery

/-- A time series is a function from natural numbers (time indices) to reals. -/
def TimeSeries := N -> R

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
  if (content.includes('sorry')) return false;
  await writeFileAtomic(dst, content);
  return true;
}

// ========== PLUGIN: internal pool for cross-hook state ==========

// The plugin holds its own pool rebuilt from the platform's pool snapshot.
function poolFromSnapshot(snapshot: PoolSnapshot): EvolutionaryPool {
  const pool = new EvolutionaryPoolClass();
  pool.restore(snapshot);
  return pool;
}

// ========== PLUGIN ==========

const plugin: WorkflowPlugin = {

  async onWorkflowStart(ctx: WorkflowStartContext): Promise<void> {
    const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    const dataDir = path.join(sharedDir, 'data');

    for (const dir of ['tables', 'conjectures', 'batch', 'reviews']) {
      await fs.mkdir(path.join(dataDir, dir), { recursive: true });
    }
    await fs.mkdir(path.join(sharedDir, 'findings'), { recursive: true });

    const leanProjectDir = (ctx.workflowConfig.lean_project_dir as string)?.replace('{{WORKSPACE}}', workspacePath)
      ?? path.join(sharedDir, 'lean-project');
    await ensureLeanProject(leanProjectDir);
  },

  async onWorkflowResume(ctx: WorkflowResumeContext): Promise<void> {
    const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    const leanProjectDir = path.join(sharedDir, 'lean-project');
    await ensureLeanProject(leanProjectDir);
  },

  async onSignalReceived(ctx: SignalContext): Promise<SignalDecision> {
    const { signal, nodeName } = ctx;
    const agentBase = nodeName.split('.')[0];

    if (agentBase === 'prover' || agentBase === 'counterexample' || agentBase === 'abstractor') {
      return { action: 'accept' };
    }

    return { action: 'accept' };
  },

  async onEvaluationResult(ctx: EvaluationContext): Promise<void> {
    // Reconstruct pool from evidence (which contains raw signal outputs)
    // The platform's pool is updated via the pool snapshot mechanism.
    // We read the pool state from disk to get current state and update it.
    const workspacePath = path.join(ctx.platform.runDirectory, '..', '..', '..');
    const runDir = ctx.platform.runDirectory;
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    const agentBase = ctx.evaluatorNode.split('.')[0];
    const scope = ctx.scope;

    // Load pool from snapshot
    const poolPath = path.join(runDir, 'pool-state.json');
    const poolSnapshotData = await readJsonSafe<PoolSnapshot>(poolPath);
    if (!poolSnapshotData) return;

    const pool = poolFromSnapshot(poolSnapshotData);

    // Conjecturer: add new candidates to the pool
    if (agentBase === 'conjecturer') {
      const evidenceData = ctx.evidence as any;
      const round = parseInt(evidenceData?.decision?.round ?? '1', 10);
      const batchPath = path.join(sharedDir, 'data', 'batch', `round-${round}.json`);
      const batch = await readJsonSafe<{ conjectures: any[] }>(batchPath);
      if (batch?.conjectures) {
        for (const c of batch.conjectures) {
          if (!pool.get(c.id)) {
            pool.add({
              id: c.id,
              content: c.natural_language,
              fitness: { composite: 0, dimensions: {} },
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
    }

    // Selector: update pool with fitness + screened status
    if (agentBase === 'selector') {
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
      const evidenceData = ctx.evidence as any;
      const success = evidenceData?.status === 'success';
      pool.update(scope, {
        status: success ? 'confirmed' : 'inconclusive',
        metadata: {
          ...(pool.get(scope)?.metadata ?? {}),
          lean_file: `.plurics/shared/lean-project/MathDiscovery/Conjectures/${scope}.lean`,
        },
      });

      if (success) {
        const leanProjectDir = path.join(sharedDir, 'lean-project');
        await copyTheoremFromProved(leanProjectDir, scope);
      }
    }

    // Counterexample: mark as falsified
    if (agentBase === 'counterexample' && scope) {
      const evidenceData = ctx.evidence as any;
      if (evidenceData?.decision?.counterexample_found) {
        const rejectionPath = path.join(sharedDir, 'data', 'audit', `${scope}-rejection-reason.md`);
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
      const evidenceData = ctx.evidence as any;
      if (evidenceData?.decision?.generalized_id) {
        pool.update(scope, { status: 'confirmed' });
      }
    }

    // Save updated pool back to disk
    await writeJsonAtomic(poolPath, pool.snapshot());
  },

  async onEvolutionaryContext(ctx: EvolutionaryContextRequest): Promise<EvolutionaryContextResult> {
    if (ctx.nodeName !== 'conjecturer') {
      return { ancestors: [], positiveExamples: [], negativeExamples: [] };
    }

    const pool = poolFromSnapshot(ctx.poolSnapshot);
    const round = ctx.poolSnapshot.candidates.reduce((max, c) => Math.max(max, c.generation), 0);

    if (round < 2) {
      return { ancestors: [], positiveExamples: [], negativeExamples: [] };
    }

    return {
      ancestors: pool.getConfirmed(),
      positiveExamples: pool.selectForContext(3),
      negativeExamples: pool.selectAsNegativeExamples(2),
    };
  },

  async onPurposeGenerate(ctx: PurposeContext): Promise<PurposeEnrichment> {
    const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    const dataDir = path.join(sharedDir, 'data');
    const sections: string[] = [];
    const agentBase = ctx.nodeName.split('.')[0];
    const scope = ctx.scope;

    // Get pool from platform services if available via upstream handoffs
    const evoResult = ctx.upstreamHandoffs['__evolutionary'] as EvolutionaryContextResult | undefined;

    try {
      switch (agentBase) {

        case 'ohlc_fetch': {
          sections.push(`## Fetch Configuration\n`);
          sections.push(`**Symbols:** ${JSON.stringify(ctx.platform.logger ? ctx.upstreamHandoffs : [])}`);
          break;
        }

        case 'profiler': {
          sections.push(`## Data Location\n`);
          sections.push(`OHLC Parquet files: \`.plurics/shared/data/tables/\``);
          sections.push(`Manifest: \`.plurics/shared/data/ohlc-manifest.json\``);
          break;
        }

        case 'conjecturer': {
          const profile = await readJsonSafe(path.join(dataDir, 'profile.json'));
          if (profile) sections.push(digestDataProfile(profile));

          if (evoResult) {
            sections.push(digestPoolContextFromResult(evoResult));
          }

          const round = ctx.attemptNumber;
          const conjecturesPerRound = (ctx.upstreamHandoffs as any)?.conjectures_per_round ?? 3;
          sections.push(`## Your Task\n`);
          sections.push(`Generate exactly ${conjecturesPerRound} conjectures for round ${round}.`);
          break;
        }

        case 'critic': {
          const round2 = ctx.attemptNumber;
          const batchPath = path.join(dataDir, 'batch', `round-${round2}.json`);
          const batch = await readJsonSafe(batchPath);
          if (batch) sections.push(`## Batch to Review\n\n\`\`\`json\n${JSON.stringify(batch, null, 2)}\n\`\`\``);
          break;
        }

        case 'selector': {
          const round3 = ctx.attemptNumber;
          const reviewsPath = path.join(dataDir, 'reviews', `round-${round3}-reviews.json`);
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
            const leanPath = path.join(sharedDir, 'lean-project', 'MathDiscovery', 'Conjectures', `${scope}.lean`);
            const statement = await readFileSafe(leanPath);
            if (statement) sections.push(`## Lean Statement\n\n\`\`\`lean\n${statement}\n\`\`\``);

            const blueprintPath = path.join(dataDir, 'conjectures', `${scope}-blueprint.md`);
            const blueprint = await readFileSafe(blueprintPath);
            if (blueprint) sections.push(`## Proof Strategy\n\n${blueprint}`);

            if (ctx.attemptNumber > 1) {
              const errorPath = path.join(dataDir, 'conjectures', `${scope}-last-error.txt`);
              const error = await readFileSafe(errorPath);
              if (error) {
                sections.push(`## Previous Compiler Errors\n\n\`\`\`\n${error}\n\`\`\``);
                sections.push(`This is attempt ${ctx.attemptNumber}. Fix the errors above.`);
              }
            }
          }
          break;
        }

        case 'synthesizer': {
          // No pool access directly — read from disk
          const poolPath = path.join(ctx.platform.runDirectory, 'pool-state.json');
          const poolSnap = await readJsonSafe<PoolSnapshot>(poolPath);
          if (poolSnap) {
            const pool = poolFromSnapshot(poolSnap);
            const confirmed = pool.getConfirmed();
            const falsified = pool.getFalsified();
            const total = pool.count();
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

            const minConfirmed = (ctx.upstreamHandoffs as any)?.min_confirmed ?? 3;
            const gateOpen = confirmed.length >= minConfirmed;
            sections.push(`\n## Phase C Gate`);
            sections.push(`Minimum confirmed findings required: ${minConfirmed}`);
            sections.push(`Currently confirmed: ${confirmed.length}`);
            sections.push(`Gate status: ${gateOpen ? 'OPEN (proceed to backtest)' : 'CLOSED (continue exploration)'}`);
          }
          break;
        }

        case 'backtest_designer': {
          const poolPath2 = path.join(ctx.platform.runDirectory, 'pool-state.json');
          const poolSnap2 = await readJsonSafe<PoolSnapshot>(poolPath2);
          if (poolSnap2) {
            const pool2 = poolFromSnapshot(poolSnap2);
            const confirmed2 = pool2.getConfirmed();
            sections.push(`## Confirmed Findings to Derive Rules From\n`);
            for (const c of confirmed2) {
              sections.push(`### ${c.id}: ${(c.metadata.title as string) ?? 'untitled'}`);
              sections.push(c.content);
              sections.push(`Lean theorem: ${(c.metadata.lean_file as string) ?? 'not available'}\n`);
            }
          }
          break;
        }

        case 'backtester': {
          sections.push(`## Spec Location\n`);
          sections.push(`Backtest spec: \`.plurics/shared/data/backtest-spec.json\``);
          break;
        }
      }
    } catch { /* digest failures are not fatal */ }

    return { append: sections.join('\n\n---\n\n') };
  },

  async onEvaluateReadiness(ctx: ReadinessContext): Promise<ReadinessDecision> {
    // Synthesizer waits for all scoped nodes to complete
    // (handled by depends_on_all in workflow config — return false to let platform decide)
    return { ready: false };
  },

  async onResolveRouting(ctx: RoutingContext): Promise<RoutingDecision | null> {
    const agentBase = ctx.sourceNode.split('.')[0];

    if (agentBase === 'selector') {
      const decision = ctx.decision as any;
      if (decision?.selected_ids?.length) {
        return { selectedBranch: 'formalizer', foreach: 'selected_conjectures', payload: decision.selected_ids };
      }
    }

    if (agentBase === 'synthesizer') {
      const decision = ctx.decision as any;
      if (decision?.gate_open) {
        return { selectedBranch: 'backtest_designer' };
      } else {
        return { selectedBranch: 'conjecturer' };
      }
    }

    return null;
  },

  async onWorkflowComplete(_ctx: WorkflowCompleteContext): Promise<void> {
    // The backtester writes the final report in Phase C.
  },
};

export default plugin;
