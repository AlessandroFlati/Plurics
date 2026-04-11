import type { NodeState, SignalFile } from './types.js';
import type { EvolutionaryPool, PoolCandidate } from './evolutionary-pool.js';

/**
 * Workflow plugin interface. Implement to inject domain-specific behavior
 * into the DAG executor at well-defined hook points.
 */
export interface WorkflowPlugin {
  /**
   * Called once when the workflow starts, before any agent spawns.
   * Use for domain-specific initialization (registries, counters, directories).
   */
  onWorkflowStart?(
    workspacePath: string,
    config: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Called after a node's signal is validated and BEFORE the DAG executor
   * dispatches the next step. Can override signal status or decision.
   */
  onSignalReceived?(
    nodeName: string,
    signal: SignalFile,
    workspacePath: string,
  ): Promise<SignalOverride | null>;

  /**
   * Called when generating a purpose.md for an agent.
   * Receives base purpose content; return enriched version with domain context.
   */
  onPurposeGenerate?(
    nodeName: string,
    basePurpose: string,
    context: PurposeContext,
  ): Promise<string>;

  /**
   * Called to evaluate if a special node (aggregator) is ready to run.
   * Return true to mark ready, false to keep pending, null for default logic.
   */
  onEvaluateReadiness?(
    nodeName: string,
    allNodes: Map<string, DagNodeState>,
  ): boolean | null;

  /**
   * Called when resuming a previously interrupted workflow run.
   * The plugin should reconstruct any internal state (registries, counters, budgets)
   * from the artifacts on disk. Called AFTER node states are restored from snapshot,
   * BEFORE evaluateReadyNodes.
   */
  onWorkflowResume?(
    workspacePath: string,
    config: Record<string, unknown>,
    completedNodes: Array<{ name: string; scope: string | null; signal: SignalFile | null }>,
  ): Promise<void>;

  /**
   * Called when the platform cannot determine routing from a signal's decision field.
   * The platform first tries decision.goto; if absent, it calls this hook.
   * Return a routing instruction or null to fall back to default branch rules.
   */
  onResolveRouting?(
    nodeName: string,
    signal: SignalFile,
    branchRules: Array<{ condition: string; goto: string; foreach?: string }>,
    workspacePath: string,
  ): Promise<RoutingResult | null>;

  /**
   * Called after a signal from an evaluation node (e.g. Lean check, Falsifier).
   * The plugin interprets the signal as an evaluation result and updates the
   * evolutionary pool accordingly.
   */
  onEvaluationResult?(
    nodeName: string,
    signal: SignalFile,
    pool: EvolutionaryPool,
    workspacePath: string,
  ): Promise<void>;

  /**
   * Called before generating the purpose of a generator node (e.g. Conjecturer)
   * in rounds 2+. The plugin returns context from the pool (positive examples,
   * negative examples, confirmed findings) to inject into the purpose.
   */
  onEvolutionaryContext?(
    nodeName: string,
    round: number,
    pool: EvolutionaryPool,
  ): EvolutionaryContext | null;

  /**
   * Called when the entire workflow completes.
   */
  onWorkflowComplete?(
    workspacePath: string,
    summary: WorkflowSummary,
  ): Promise<void>;
}

export interface EvolutionaryContext {
  /** Top-k candidates for positive context. */
  positiveExamples: PoolCandidate[];
  /** Falsified candidates for negative context. */
  negativeExamples: PoolCandidate[];
  /** Confirmed findings from previous rounds. */
  confirmedFindings: PoolCandidate[];
  /** Optional free-form narrative injected into the purpose. */
  narrative?: string;
}

export interface RoutingResult {
  goto: string;
  foreach?: string;
  payload?: unknown;
}

export interface SignalOverride {
  status?: SignalFile['status'];
  decision?: SignalFile['decision'];
}

export interface PurposeContext {
  scope: string | null;
  retryCount: number;
  previousError: SignalFile['error'] | null;
  workspacePath: string;
  config: Record<string, unknown>;
  /** Evolutionary pool (empty unless the plugin uses it). */
  pool: EvolutionaryPool;
  /** Current round (invocation count of the calling node). */
  round: number;
}

export interface DagNodeState {
  name: string;
  state: NodeState;
  scope: string | null;
}

export interface WorkflowSummary {
  runId: string;
  totalNodes: number;
  completed: number;
  failed: number;
  skipped: number;
  durationSeconds: number;
}
