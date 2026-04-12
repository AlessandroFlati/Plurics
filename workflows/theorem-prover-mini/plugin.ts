/**
 * Theorem Prover Mini Plugin
 *
 * Responsibilities:
 * 1. Lean project initialization (lakefile, Mathlib dependency)
 * 2. Tiered purpose injection (theorem JSON, Lean file content, previous errors)
 * 3. Extract proof from Prover LLM output and write to Lean file
 * 4. Interpret lean_check signal and prepare retry context
 * 5. Fan-out on conjecturer's selected theorems
 */

import type {
  WorkflowPlugin,
  WorkflowStartContext,
  WorkflowResumeContext,
  WorkflowCompleteContext,
  SignalContext,
  SignalDecision,
  PurposeContext,
  PurposeEnrichment,
  RoutingContext,
  RoutingDecision,
} from '../../packages/server/src/modules/workflow/sdk.js';
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

async function writeFileAtomic(p: string, content: string): Promise<void> {
  const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, p);
}

async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  await writeFileAtomic(p, JSON.stringify(data, null, 2));
}

function scopeToSnake(scope: string): string {
  return scope.toLowerCase().replace(/-/g, '_');
}

/**
 * Extract the best Lean code block from LLM output.
 */
function extractLeanCode(output: string): string | null {
  const blocks: string[] = [];
  const regex = /```lean\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(output)) !== null) {
    blocks.push(m[1].trim());
  }

  if (blocks.length === 0) {
    if (output.includes('theorem') && output.includes(':= by')) {
      return ensureImports(output.trim());
    }
    return null;
  }

  const cleanBlocks = blocks.filter(b => !b.includes('sorry'));
  const chosen = cleanBlocks.length > 0 ? cleanBlocks[cleanBlocks.length - 1] : blocks[blocks.length - 1];
  return ensureImports(chosen);
}

/** Ensure the Lean code has Mathlib imports. Prepends them if missing. */
function ensureImports(code: string): string {
  const hasImport = /^import\s+Mathlib/m.test(code);
  const hasNamespace = /^namespace\s+TheoremProverMini/m.test(code);
  const lines: string[] = [];
  if (!hasImport) {
    lines.push('import Mathlib.Data.Nat.Basic');
    lines.push('import Mathlib.Algebra.BigOperators.Basic');
    lines.push('import Mathlib.Tactic');
    lines.push('');
  }
  if (!hasNamespace) {
    lines.push('namespace TheoremProverMini.Theorems');
    lines.push('');
    lines.push(code);
    lines.push('');
    lines.push('end TheoremProverMini.Theorems');
    return lines.join('\n');
  }
  lines.push(code);
  return lines.join('\n');
}

// ========== LEAN PROJECT SETUP ==========

const LAKEFILE = `import Lake
open Lake DSL

package «theorem-prover-mini» where
  version := v!"0.1.0"

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git" @ "v4.29.0"

@[default_target]
lean_lib «TheoremProverMini» where
`;

const TOOLCHAIN = `leanprover/lean4:v4.29.0\n`;

const NAMESPACE_INIT = `import Mathlib.Data.Nat.Basic
import Mathlib.Tactic

namespace TheoremProverMini.Theorems

end TheoremProverMini.Theorems
`;

async function ensureLeanProject(projectDir: string): Promise<void> {
  await fs.mkdir(path.join(projectDir, 'TheoremProverMini', 'Theorems'), { recursive: true });

  const lakefile = path.join(projectDir, 'lakefile.lean');
  if (!await readFileSafe(lakefile)) await writeFileAtomic(lakefile, LAKEFILE);

  const toolchain = path.join(projectDir, 'lean-toolchain');
  if (!await readFileSafe(toolchain)) await writeFileAtomic(toolchain, TOOLCHAIN);

  const libRoot = path.join(projectDir, 'TheoremProverMini.lean');
  if (!await readFileSafe(libRoot)) {
    await writeFileAtomic(libRoot, 'import TheoremProverMini.Theorems\n');
  }

  const placeholder = path.join(projectDir, 'TheoremProverMini', 'Theorems.lean');
  if (!await readFileSafe(placeholder)) await writeFileAtomic(placeholder, NAMESPACE_INIT);
}

async function rebuildTheoremsIndex(projectDir: string): Promise<void> {
  const theoremsDir = path.join(projectDir, 'TheoremProverMini', 'Theorems');
  let files: string[];
  try {
    files = await fs.readdir(theoremsDir);
  } catch { return; }

  const theoremFiles = files
    .filter(f => f.endsWith('.lean') && f !== 'Theorems.lean')
    .map(f => f.replace(/\.lean$/, ''))
    .sort();

  const imports = theoremFiles.map(name => `import TheoremProverMini.Theorems.${name}`).join('\n');
  const content = `${imports}\n\nnamespace TheoremProverMini.Theorems\n\nend TheoremProverMini.Theorems\n`;
  await writeFileAtomic(path.join(projectDir, 'TheoremProverMini', 'Theorems.lean'), content);
}

// ========== PLUGIN ==========

const plugin: WorkflowPlugin = {

  async onWorkflowStart(ctx: WorkflowStartContext): Promise<void> {
    const sharedDir = path.join(ctx.runDirectory, '..', '..', 'shared');
    for (const dir of ['theorems', 'formalized', 'findings']) {
      await fs.mkdir(path.join(sharedDir, dir), { recursive: true });
    }
    const leanDir = (ctx.workflowConfig.lean_project_dir as string)?.replace('{{WORKSPACE}}', path.join(ctx.runDirectory, '..', '..', '..'))
      ?? path.join(path.join(ctx.runDirectory, '..', '..', '..'), 'lean-project');
    await ensureLeanProject(leanDir);
  },

  async onWorkflowResume(ctx: WorkflowResumeContext): Promise<void> {
    const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
    await ensureLeanProject(path.join(workspacePath, 'lean-project'));
  },

  async onSignalReceived(ctx: SignalContext): Promise<SignalDecision> {
    const { signal, nodeName } = ctx;
    const agentBase = nodeName.split('.')[0];
    const scope = signal.scope;
    const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');

    // Formalizer: copy the .lean file from .plurics/shared/formalized/ to the lean project
    if (agentBase === 'formalizer' && scope) {
      const snakeScope = scopeToSnake(scope);
      const src = path.join(sharedDir, 'formalized', `${scope}.lean`);
      const dst = path.join(workspacePath, 'lean-project', 'TheoremProverMini', 'Theorems', `${snakeScope}.lean`);
      const content = await readFileSafe(src);
      if (content) {
        await writeFileAtomic(dst, content);
        await rebuildTheoremsIndex(path.join(workspacePath, 'lean-project'));
      }
    }

    // Prover (claude-code): copy proof into lean-project
    if (agentBase === 'prover' && scope) {
      const snakeScope = scopeToSnake(scope);
      const src = path.join(sharedDir, 'formalized', `${scope}.lean`);
      const dst = path.join(workspacePath, 'lean-project', 'TheoremProverMini', 'Theorems', `${snakeScope}.lean`);
      const content = await readFileSafe(src);
      if (content && !content.includes('sorry')) {
        await writeFileAtomic(dst, content);
        await rebuildTheoremsIndex(path.join(workspacePath, 'lean-project'));
      } else if (content?.includes('sorry')) {
        return {
          action: 'reject_and_retry',
          retryReason: 'Proof still contains sorry',
        };
      }
    }

    // Lean check: inspect output to determine success/failure
    if (agentBase === 'lean_check' && scope) {
      const runsDir = path.join(workspacePath, '.plurics', 'runs');
      try {
        const runDirs = (await fs.readdir(runsDir))
          .filter(d => d.startsWith('run-'))
          .sort()
          .reverse();
        if (runDirs.length > 0) {
          const latestRun = runDirs[0];
          const logPath = path.join(runsDir, latestRun, 'logs', `lean_check-${scope}.log`);
          const log = await readFileSafe(logPath);
          if (log) {
            const hasError = /error:/i.test(log);
            const hasSorry = /declaration uses 'sorry'|sorry/i.test(log);
            const isValid = !hasError && !hasSorry && signal.status === 'success';

            if (!isValid) {
              const errPath = path.join(sharedDir, 'theorems', `${scope}-last-error.txt`);
              await writeFileAtomic(errPath, log);
              return {
                action: 'reject_and_retry',
                retryReason: 'Lean rejected proof',
              };
            }
          }
        }
      } catch { /* best effort */ }
    }

    return { action: 'accept' };
  },

  async onPurposeGenerate(ctx: PurposeContext): Promise<PurposeEnrichment> {
    const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
    const sharedDir = path.join(workspacePath, '.plurics', 'shared');
    const sections: string[] = [];
    const agentBase = ctx.nodeName.split('.')[0];
    const scope = ctx.scope;

    switch (agentBase) {

      case 'conjecturer': {
        sections.push(`## Task\n\nGenerate 3 elementary theorems per the schema above.`);
        break;
      }

      case 'formalizer': {
        if (scope) {
          const theorem = await readJsonSafe(path.join(sharedDir, 'theorems', `${scope}.json`));
          if (theorem) {
            sections.push(`## Theorem to Formalize\n\n\`\`\`json\n${JSON.stringify(theorem, null, 2)}\n\`\`\``);
            sections.push(`## Scope Identifier\n\nReplace \`{{SCOPE_SNAKE}}\` in the template with: \`${scopeToSnake(scope)}\``);
          }
        }
        break;
      }

      case 'prover': {
        if (scope) {
          const theorem = await readJsonSafe(path.join(sharedDir, 'theorems', `${scope}.json`));
          if (theorem) {
            sections.push(`## Theorem Metadata\n\n\`\`\`json\n${JSON.stringify(theorem, null, 2)}\n\`\`\``);
          }

          const leanPath = path.join(workspacePath, 'lean-project', 'TheoremProverMini', 'Theorems', `${scopeToSnake(scope)}.lean`);
          const leanContent = await readFileSafe(leanPath);
          if (leanContent) {
            sections.push(`## Current Lean File (has sorry — replace with proof)\n\n\`\`\`lean\n${leanContent}\n\`\`\``);
          }

          if (ctx.attemptNumber > 1) {
            const errorPath = path.join(sharedDir, 'theorems', `${scope}-last-error.txt`);
            const error = await readFileSafe(errorPath);
            if (error) {
              sections.push(`## Previous Compiler Error (Attempt ${ctx.attemptNumber - 1})\n\n\`\`\`\n${error.slice(0, 2000)}\n\`\`\``);
              sections.push(`This is your retry. Fix the proof based on the error above.`);
            }
          }

          sections.push(`## Write Your Proof To\n\n\`.plurics/shared/formalized/${scope}.lean\` (overwrite the existing file atomically with the proof filled in)`);
        }
        break;
      }

      case 'lean_check': {
        // Process backend — no purpose needed
        break;
      }

      case 'reporter': {
        if (scope) {
          const theorem = await readJsonSafe(path.join(sharedDir, 'theorems', `${scope}.json`));
          const leanPath = path.join(workspacePath, 'lean-project', 'TheoremProverMini', 'Theorems', `${scopeToSnake(scope)}.lean`);
          const leanContent = await readFileSafe(leanPath);
          if (theorem) sections.push(`## Theorem\n\n\`\`\`json\n${JSON.stringify(theorem, null, 2)}\n\`\`\``);
          if (leanContent) sections.push(`## Verified Lean Proof\n\n\`\`\`lean\n${leanContent}\n\`\`\``);
        }
        break;
      }
    }

    return { append: sections.join('\n\n---\n\n') };
  },

  async onResolveRouting(ctx: RoutingContext): Promise<RoutingDecision | null> {
    const agentBase = ctx.sourceNode.split('.')[0];

    // Conjecturer: fan-out on theorem_ids
    if (agentBase === 'conjecturer') {
      const decision = ctx.decision as any;
      if (decision?.theorem_ids?.length) {
        return { selectedBranch: 'formalizer', foreach: 'theorem_ids', payload: decision.theorem_ids };
      }
    }

    // Lean check: route based on signal status
    if (agentBase === 'lean_check') {
      // The signal status was set by onSignalReceived
      // We need to check what the routing context tells us
      const signal = ctx.decision as any;
      if (signal?.status === 'failure' || (ctx.candidateBranches.includes('prover') && !ctx.candidateBranches.includes('reporter'))) {
        return { selectedBranch: 'prover' };
      } else {
        return { selectedBranch: 'reporter' };
      }
    }

    return null;
  },

  async onWorkflowComplete(_ctx: WorkflowCompleteContext): Promise<void> {
    // Reporter writes individual findings.
  },
};

export default plugin;
