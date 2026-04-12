/**
 * Sequence Explorer plugin
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
import type { PoolCandidate, PoolSnapshot } from '../../packages/server/src/modules/workflow/evolutionary-pool.js';
import { EvolutionaryPool, computeCompositeFitness } from '../../packages/server/src/modules/workflow/evolutionary-pool.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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

async function writeFileAtomic(p: string, content: string): Promise<void> {
  const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, p);
}

const FITNESS_WEIGHTS = {
  empirical: 0.4,
  novelty: 0.3,
  elegance: 0.2,
  provability: 0.1,
};

// Plugin directory (resolved at module load)
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_TOOLS_SRC = path.join(PLUGIN_DIR, 'python');

// ========== PYTHON TOOL INSTALLATION ==========

async function installPythonTools(workspacePath: string): Promise<void> {
  const toolsDir = path.join(workspacePath, '.plurics', 'tools');
  await fs.mkdir(toolsDir, { recursive: true });

  const scripts = ['sequence_fetcher.py', 'verifier.py', 'cross_checker.py'];
  for (const name of scripts) {
    const src = path.join(PYTHON_TOOLS_SRC, name);
    const dst = path.join(toolsDir, name);
    try {
      const content = await fs.readFile(src, 'utf-8');
      await writeFileAtomic(dst, content);
    } catch (err) {
      console.error(`[sequence-explorer] Failed to install ${name}:`, err);
    }
  }
}

// ========== FITNESS COMPUTATION ==========

interface DimensionScores {
  empirical: number;
  novelty: number;
  elegance: number;
  provability: number;
}

function eleganceFromPython(pythonBody: string): number {
  const lines = pythonBody.split('\n').filter(l => l.trim().length > 0).length;
  const conditionals = (pythonBody.match(/\bif\b|\belif\b|\belse\b/g) ?? []).length;
  const imports = (pythonBody.match(/\bimport\b/g) ?? []).length;
  const score = Math.max(0, 1 - (lines / 40) - (conditionals / 20) - (imports / 10));
  return Math.min(1, score);
}

function noveltyFromCrossCheck(crossCheck: any): number {
  if (!crossCheck) return 0.5;
  switch (crossCheck.verdict) {
    case 'novel': return 1.0;
    case 'related': return 0.6;
    case 'rediscovery': return 0.1;
    case 'inconclusive':
    default:
      return 0.5;
  }
}

function provabilityFromType(conjecture: any): number {
  if (!conjecture?.type) return 0.5;
  const scores: Record<string, number> = {
    closed_form: 0.9,
    linear_recurrence: 0.8,
    combinatorial_identity: 0.6,
    generating_function: 0.4,
    asymptotic_bound: 0.3,
  };
  return scores[conjecture.type] ?? 0.5;
}

// ========== POOL HELPERS ==========

function poolFromSnapshot(snapshot: PoolSnapshot): EvolutionaryPool {
  const pool = new EvolutionaryPool();
  pool.restore(snapshot);
  return pool;
}

function formatPositiveExample(c: PoolCandidate): string {
  const title = (c.metadata?.title as string) ?? 'untitled';
  const formula = (c.metadata?.formula as string) ?? '';
  const fitness = c.fitness.composite.toFixed(2);
  return `**${c.id}** (fitness=${fitness}) — ${title}\n  Formula: ${formula}`;
}

function formatNegativeExample(c: PoolCandidate): string {
  const title = (c.metadata?.title as string) ?? 'untitled';
  const formula = (c.metadata?.formula as string) ?? '';
  const reason = (c.metadata?.rejection_reason as string) ?? 'unknown';
  return `**${c.id}** — ${title}\n  Formula: ${formula}\n  Rejected because: ${reason}`;
}

// ========== PLUGIN ==========

const plugin: WorkflowPlugin = {

  async onWorkflowStart(ctx: WorkflowStartContext): Promise<void> {
    const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    for (const dir of ['conjectures', 'formalized', 'verification', 'reviews', 'findings']) {
      await fs.mkdir(path.join(sharedDir, dir), { recursive: true });
    }
    await installPythonTools(workspacePath);
    console.log('[sequence-explorer] workspace initialized');
  },

  async onWorkflowResume(ctx: WorkflowResumeContext): Promise<void> {
    const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
    await installPythonTools(workspacePath);
  },

  async onSignalReceived(ctx: SignalContext): Promise<SignalDecision> {
    return { action: 'accept' };
  },

  async onEvaluationResult(ctx: EvaluationContext): Promise<void> {
    const agentBase = ctx.evaluatorNode.split('.')[0];
    const scope = ctx.scope;
    const runDir = ctx.platform.runDirectory;
    const workspacePath = path.join(runDir, '..', '..', '..');
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');

    const poolPath = path.join(runDir, 'pool-state.json');
    const poolSnapshotData = await readJsonSafe<PoolSnapshot>(poolPath);
    if (!poolSnapshotData) return;

    const pool = poolFromSnapshot(poolSnapshotData);
    const evidence = ctx.evidence as any;

    // Conjecturer: seed the pool with new candidates
    if (agentBase === 'conjecturer' && !scope) {
      const decision = evidence?.decision;
      const ids: string[] = decision?.conjecture_ids ?? [];
      for (const id of ids) {
        const conjFile = path.join(sharedDir, 'conjectures', `${id}.json`);
        const conj = await readJsonSafe<any>(conjFile);
        if (!conj) continue;
        if (pool.get(id)) continue;
        pool.add({
          id,
          content: conj.natural_language ?? '',
          fitness: { composite: 0, dimensions: {} },
          generation: conj.generation ?? 1,
          parentIds: conj.parent_ids ?? [],
          status: 'pending',
          metadata: {
            title: conj.title,
            formula: conj.formula,
            type: conj.type,
            target_sequence: conj.target_sequence,
          },
        });
      }
    }

    // Critic: compute final fitness
    if (agentBase === 'critic' && scope) {
      const verification = await readJsonSafe<any>(path.join(sharedDir, 'verification', `${scope}-verification.json`));
      const crosscheck = await readJsonSafe<any>(path.join(sharedDir, 'verification', `${scope}-crosscheck.json`));
      const conjecture = await readJsonSafe<any>(path.join(sharedDir, 'conjectures', `${scope}.json`));
      const formalized = await readFileSafe(path.join(sharedDir, 'formalized', `${scope}.py`));

      const dims: DimensionScores = {
        empirical: verification?.empirical_score ?? 0,
        novelty: noveltyFromCrossCheck(crosscheck),
        elegance: formalized ? eleganceFromPython(formalized) : 0,
        provability: provabilityFromType(conjecture),
      };

      const composite = computeCompositeFitness(dims, FITNESS_WEIGHTS);

      let status: PoolCandidate['status'] = 'pending';
      if (dims.empirical === 1.0 && crosscheck?.verdict === 'novel') status = 'confirmed';
      else if (dims.empirical === 1.0 && crosscheck?.verdict === 'rediscovery') status = 'confirmed';
      else if (dims.empirical >= 0.95) status = 'confirmed';
      else if (dims.empirical >= 0.5) status = 'inconclusive';
      else status = 'falsified';

      const existing = pool.get(scope);
      if (existing) {
        pool.update(scope, {
          fitness: { composite, dimensions: dims as unknown as Record<string, number> },
          status,
          metadata: {
            ...existing.metadata,
            verification_summary: {
              empirical_score: dims.empirical,
              first_mismatch: verification?.first_mismatch_index ?? null,
            },
            crosscheck_verdict: crosscheck?.verdict ?? 'inconclusive',
            rejection_reason: status === 'falsified'
              ? `Empirical score only ${dims.empirical.toFixed(2)}; first mismatch at index ${verification?.first_mismatch_index}`
              : undefined,
          },
        });
      }
    }

    // Quick filter: if rejected, mark as filtered_out
    if (agentBase === 'quick_filter' && scope) {
      const decision = evidence?.decision;
      if (decision?.verdict === 'reject') {
        const existing = pool.get(scope);
        if (existing) {
          pool.update(scope, {
            status: 'falsified',
            metadata: {
              ...existing.metadata,
              rejection_reason: `Quick filter rejected: ${decision?.reason ?? 'sanity check failed'}`,
            },
          });
        }
      }
    }

    // Save updated pool back to disk
    const writeJsonAtomicLocal = async (p: string, data: unknown) => {
      const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tmp, p);
    };
    await writeJsonAtomicLocal(poolPath, pool.snapshot());
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
    const sections: string[] = [];
    const agentBase = ctx.nodeName.split('.')[0];
    const scope = ctx.scope;

    const evoResult = ctx.upstreamHandoffs['__evolutionary'] as EvolutionaryContextResult | undefined;

    try {
      switch (agentBase) {

        case 'sequence_fetch': {
          const targetId = (ctx.upstreamHandoffs['target_oeis_id'] as string) ?? 'A000045';
          sections.push(`## Configuration\n\ntarget_oeis_id: ${targetId}`);
          break;
        }

        case 'profiler': {
          const manifest = await readJsonSafe(path.join(sharedDir, 'oeis-manifest.json'));
          if (manifest) {
            sections.push(`## OEIS Manifest\n\n\`\`\`json\n${JSON.stringify(manifest, null, 2).slice(0, 4000)}\n\`\`\``);
          }
          break;
        }

        case 'conjecturer': {
          const manifest = await readJsonSafe(path.join(sharedDir, 'oeis-manifest.json'));
          const profile = await readJsonSafe(path.join(sharedDir, 'data-profile.json'));
          if (manifest) {
            const m = manifest as any;
            sections.push(
              `## Target Sequence\n\n` +
              `- **OEIS ID**: ${m.oeis_id}\n` +
              `- **Name**: ${m.name}\n` +
              `- **Known terms** (${m.known_terms_count}): ${m.known_terms.slice(0, 20).join(', ')}${m.known_terms_count > 20 ? ', ...' : ''}\n` +
              `- **Offset**: ${m.offset}`
            );
          }
          if (profile) {
            sections.push(`## Data Profile\n\n\`\`\`json\n${JSON.stringify(profile, null, 2).slice(0, 3000)}\n\`\`\``);
          }
          sections.push(`## Round\n\nThis is round ${ctx.attemptNumber} of discovery.`);

          if (evoResult && ctx.attemptNumber >= 2) {
            if (evoResult.positiveExamples.length > 0) {
              sections.push(
                `## Top conjectures from previous rounds (build on these)\n\n` +
                evoResult.positiveExamples.map(formatPositiveExample).join('\n\n')
              );
            }
            if (evoResult.negativeExamples.length > 0) {
              sections.push(
                `## Falsified conjectures (DO NOT repeat these mistakes)\n\n` +
                evoResult.negativeExamples.map(formatNegativeExample).join('\n\n')
              );
            }
            if (evoResult.ancestors.length > 0) {
              sections.push(
                `## Confirmed findings so far\n\n` +
                evoResult.ancestors.map(c => `- **${c.id}**: ${(c.metadata?.title as string) ?? ''} — fitness ${c.fitness.composite.toFixed(2)}`).join('\n')
              );
            }
            const parentIds = evoResult.positiveExamples.map(c => c.id);
            if (parentIds.length > 0) {
              sections.push(
                `## Lineage instruction\n\n` +
                `When you generate a new conjecture that builds on one of the top examples above, set its \`parent_ids\` field to include the source conjecture IDs.`
              );
            }
          }
          break;
        }

        case 'formalizer': {
          if (scope) {
            const conjecture = await readJsonSafe(path.join(sharedDir, 'conjectures', `${scope}.json`));
            if (conjecture) {
              sections.push(`## Conjecture to Formalize\n\n\`\`\`json\n${JSON.stringify(conjecture, null, 2)}\n\`\`\``);
            }
          }
          break;
        }

        case 'quick_filter': {
          if (scope) {
            const formalized = await readFileSafe(path.join(sharedDir, 'formalized', `${scope}.py`));
            if (formalized) {
              sections.push(`## Python Code to Sanity-Check\n\n\`\`\`python\n${formalized}\n\`\`\``);
            }
          }
          break;
        }

        case 'verifier':
        case 'cross_checker': {
          if (scope) {
            sections.push(`## Scope\n\n${scope}`);
          }
          break;
        }

        case 'critic': {
          if (scope) {
            const conjecture = await readJsonSafe(path.join(sharedDir, 'conjectures', `${scope}.json`));
            const verification = await readJsonSafe(path.join(sharedDir, 'verification', `${scope}-verification.json`));
            const crosscheck = await readJsonSafe(path.join(sharedDir, 'verification', `${scope}-crosscheck.json`));
            const formalized = await readFileSafe(path.join(sharedDir, 'formalized', `${scope}.py`));
            if (conjecture) sections.push(`## Conjecture\n\n\`\`\`json\n${JSON.stringify(conjecture, null, 2)}\n\`\`\``);
            if (formalized) sections.push(`## Python Implementation\n\n\`\`\`python\n${formalized}\n\`\`\``);
            if (verification) sections.push(`## Verification Result\n\n\`\`\`json\n${JSON.stringify(verification, null, 2)}\n\`\`\``);
            if (crosscheck) sections.push(`## OEIS Cross-Check\n\n\`\`\`json\n${JSON.stringify(crosscheck, null, 2)}\n\`\`\``);
          }
          break;
        }

        case 'selector': {
          // Load pool from disk for summary
          const poolPath = path.join(ctx.platform.runDirectory, 'pool-state.json');
          const poolSnap = await readJsonSafe<PoolSnapshot>(poolPath);
          if (poolSnap) {
            const pool = poolFromSnapshot(poolSnap);
            const all = pool.getAll();
            const confirmed = pool.getConfirmed();
            const falsified = pool.getFalsified();
            const maxFitness = Math.max(0, ...all.map(c => c.fitness.composite));
            const threshold = (ctx.upstreamHandoffs['fitness_success_threshold'] as number) ?? 0.9;
            const maxRounds = (ctx.upstreamHandoffs['max_rounds'] as number) ?? 5;

            sections.push(
              `## Pool Summary (round ${ctx.attemptNumber})\n\n` +
              `- Total candidates: ${all.length}\n` +
              `- Confirmed: ${confirmed.length}\n` +
              `- Falsified: ${falsified.length}\n` +
              `- Max composite fitness: ${maxFitness.toFixed(3)}\n` +
              `- Success threshold: ${threshold}\n` +
              `- Rounds completed: ${ctx.attemptNumber} / ${maxRounds}`
            );

            if (confirmed.length > 0) {
              sections.push(
                `## Confirmed conjectures\n\n` +
                confirmed.slice(0, 5).map(c =>
                  `- **${c.id}** (fitness=${c.fitness.composite.toFixed(2)}): ${(c.metadata?.title as string) ?? ''}\n  Formula: ${(c.metadata?.formula as string) ?? ''}`
                ).join('\n\n')
              );
            }

            const shouldStop = maxFitness >= threshold || ctx.attemptNumber >= maxRounds;
            sections.push(
              `## Decision\n\n` +
              `Based on the pool state, ${shouldStop ? 'TERMINATE and route to reporter' : 'CONTINUE and route back to conjecturer for another round'}.\n` +
              `Return decision.status = "converged" to finish, or "continue" to loop back.`
            );
          }
          break;
        }

        case 'reporter': {
          const poolPath = path.join(ctx.platform.runDirectory, 'pool-state.json');
          const poolSnap = await readJsonSafe<PoolSnapshot>(poolPath);
          if (poolSnap) {
            const pool = poolFromSnapshot(poolSnap);
            const confirmed = pool.getConfirmed().sort((a, b) => b.fitness.composite - a.fitness.composite);
            if (confirmed.length > 0) {
              const winner = confirmed[0];
              sections.push(
                `## Winning Conjecture\n\n` +
                `**ID**: ${winner.id}\n` +
                `**Title**: ${(winner.metadata?.title as string) ?? ''}\n` +
                `**Fitness**: ${winner.fitness.composite.toFixed(3)}\n` +
                `**Dimensions**: ${JSON.stringify(winner.fitness.dimensions)}\n` +
                `**Formula**: ${(winner.metadata?.formula as string) ?? ''}\n` +
                `**Lineage**: ${winner.parentIds.join(' -> ') || '(none)'}\n`
              );
              const winnerScope = winner.id;
              const conjecture = await readJsonSafe(path.join(sharedDir, 'conjectures', `${winnerScope}.json`));
              const verification = await readJsonSafe(path.join(sharedDir, 'verification', `${winnerScope}-verification.json`));
              const crosscheck = await readJsonSafe(path.join(sharedDir, 'verification', `${winnerScope}-crosscheck.json`));
              if (conjecture) sections.push(`## Conjecture Details\n\n\`\`\`json\n${JSON.stringify(conjecture, null, 2)}\n\`\`\``);
              if (verification) sections.push(`## Verification\n\n\`\`\`json\n${JSON.stringify(verification, null, 2)}\n\`\`\``);
              if (crosscheck) sections.push(`## Cross-Check\n\n\`\`\`json\n${JSON.stringify(crosscheck, null, 2)}\n\`\`\``);
            } else {
              sections.push(`## No winning conjecture\n\nNo confirmed conjectures in the pool after ${ctx.attemptNumber} rounds.`);
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error('[sequence-explorer] onPurposeGenerate error:', err);
    }

    return { append: sections.join('\n\n---\n\n') };
  },

  async onEvaluateReadiness(ctx: ReadinessContext): Promise<ReadinessDecision> {
    // Platform handles scoped-node readiness via depends_on_all
    return { ready: false };
  },

  async onResolveRouting(ctx: RoutingContext): Promise<RoutingDecision | null> {
    const agentBase = ctx.sourceNode.split('.')[0];

    if (agentBase === 'conjecturer') {
      const decision = ctx.decision as any;
      const ids: string[] = decision?.conjecture_ids ?? [];
      if (ids.length > 0) {
        return { selectedBranch: 'formalizer', foreach: 'conjecture_ids', payload: ids };
      }
    }

    if (agentBase === 'selector') {
      const decision = ctx.decision as any;
      if (decision?.status === 'converged') {
        return { selectedBranch: 'reporter' };
      } else {
        return { selectedBranch: 'conjecturer' };
      }
    }

    return null;
  },

  async onWorkflowComplete(_ctx: WorkflowCompleteContext): Promise<void> {
    // Reporter produces the final finding.md as part of the pipeline.
  },
};

export default plugin;
