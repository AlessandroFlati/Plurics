import type { NodeState, SignalFile } from './types.js';

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
   * Called when the entire workflow completes.
   */
  onWorkflowComplete?(
    workspacePath: string,
    summary: WorkflowSummary,
  ): Promise<void>;
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
