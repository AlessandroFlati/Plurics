import type { SignalFile } from './types.js';
import type { PoolSnapshot } from './evolutionary-pool.js';

// ========== Platform Services ==========

export interface PlatformLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface PlatformServices {
  registryClient: import('../registry/index.js').RegistryClient | null;
  valueStore: import('../registry/execution/value-store.js').ValueStore | null;
  logger: PlatformLogger;
  runDirectory: string;
}

// ========== Context Types ==========

export interface WorkflowStartContext {
  runId: string;
  workflowName: string;
  workflowVersion: string;
  workflowConfig: Record<string, unknown>;
  runDirectory: string;
  platform: PlatformServices;
}

export interface WorkflowResumeContext {
  runId: string;
  workflowName: string;
  workflowVersion: string;
  workflowConfig: Record<string, unknown>;
  runDirectory: string;
  platform: PlatformServices;
  snapshotTimestamp: string;
  pendingNodes: string[];
  completedNodes: string[];
}

export interface WorkflowCompleteContext {
  runId: string;
  workflowName: string;
  workflowVersion: string;
  workflowConfig: Record<string, unknown>;
  runDirectory: string;
  platform: PlatformServices;
  status: 'success' | 'failure' | 'aborted';
  duration_seconds: number;
  nodesCompleted: number;
  nodesFailed: number;
  finalFindings: Finding[];
}

export interface Finding {
  id: string;
  content: string;
  nodeSource: string;
  timestamp: string;
}

export interface HandoffFile {
  path: string;
  content: string;
}

export interface SignalContext {
  runId: string;
  signal: SignalFile;
  nodeName: string;
  scope: string | null;
  upstreamHandoffs: Record<string, unknown>;
  platform: PlatformServices;
}

export interface SignalDecision {
  action: 'accept' | 'accept_with_handoff' | 'reject_and_retry' | 'reject_and_branch';
  handoffs?: HandoffFile[];
  retryReason?: string;
  branch?: { target: string; state: Record<string, unknown> };
}

export interface EvaluationContext {
  runId: string;
  evaluatorNode: string;
  scope: string | null;
  candidateId: string;
  fitness: number;
  verdict: 'pass' | 'fail' | 'inconclusive';
  evidence: Record<string, unknown>;
  platform: PlatformServices;
}

export interface ReadinessContext {
  runId: string;
  nodeName: string;
  scope: string | null;
  dependenciesCompleted: string[];
  platform: PlatformServices;
}

export interface ReadinessDecision {
  ready: boolean;
  retryAfter?: number;
}

export interface RoutingContext {
  runId: string;
  sourceNode: string;
  scope: string | null;
  decision: SignalFile['decision'];
  candidateBranches: string[];
  platform: PlatformServices;
}

export interface RoutingDecision {
  selectedBranch: string;
  foreach?: string;
  payload?: unknown;
  state?: Record<string, unknown>;
}

export interface PurposeContext {
  runId: string;
  nodeName: string;
  scope: string | null;
  basePreset: string;
  upstreamHandoffs: Record<string, unknown>;
  attemptNumber: number;
  platform: PlatformServices;
}

export interface PurposeEnrichment {
  replace?: string;
  prepend?: string;
  append?: string;
  variables?: Record<string, string>;
}

export interface EvolutionaryContextRequest {
  runId: string;
  nodeName: string;
  role: 'generator' | 'evaluator' | 'selector';
  scope: string | null;
  poolSnapshot: PoolSnapshot;
  platform: PlatformServices;
}

export interface EvolutionaryContextResult {
  ancestors: import('./evolutionary-pool.js').PoolCandidate[];
  positiveExamples: import('./evolutionary-pool.js').PoolCandidate[];
  negativeExamples: import('./evolutionary-pool.js').PoolCandidate[];
  narrative?: string;
  customContext?: Record<string, unknown>;
}

export interface ToolDeclaration {
  name: string;
  version: string;
  required: boolean;
  reason?: string;
}

export interface ToolProposalContext {
  runId: string;
  nodeName: string;
  platform: PlatformServices;
  proposal: {
    name: string;
    description: string;
    manifest: Record<string, unknown>; // TODO: replace with ToolManifest
    implementationSource: string;
    testsSource: string;
    rationale: string;
  };
}

export interface ToolProposalResult {
  accept: boolean;
  reason?: string;
}

export interface ToolRegressionContext {
  runId: string;
  toolName: string;
  platform: PlatformServices;
}

export interface ToolRegressionResult {
  rollback: boolean;
  reason?: string;
}

// ========== Plugin Interface ==========

/**
 * Workflow plugin interface. Implement to inject domain-specific behavior
 * into the DAG executor at well-defined hook points.
 */
export interface WorkflowPlugin {
  /**
   * Called once when the workflow starts, before any agent spawns.
   * Use for domain-specific initialization (registries, counters, directories).
   */
  onWorkflowStart?(ctx: WorkflowStartContext): Promise<void>;

  /**
   * Called when resuming a previously interrupted workflow run.
   */
  onWorkflowResume?(ctx: WorkflowResumeContext): Promise<void>;

  /**
   * Called when the entire workflow completes.
   */
  onWorkflowComplete?(ctx: WorkflowCompleteContext): Promise<void>;

  /**
   * Called after a node's signal is validated and BEFORE the DAG executor
   * dispatches the next step.
   */
  onSignalReceived?(ctx: SignalContext): Promise<SignalDecision>;

  /**
   * Called when generating a purpose.md for an agent.
   */
  onPurposeGenerate?(ctx: PurposeContext): Promise<PurposeEnrichment>;

  /**
   * Called to evaluate if a special node (aggregator) is ready to run.
   */
  onEvaluateReadiness?(ctx: ReadinessContext): Promise<ReadinessDecision>;

  /**
   * Called when the platform cannot determine routing from a signal's decision field.
   */
  onResolveRouting?(ctx: RoutingContext): Promise<RoutingDecision | null>;

  /**
   * Called after a signal from an evaluation node.
   */
  onEvaluationResult?(ctx: EvaluationContext): Promise<void>;

  /**
   * Called before generating the purpose of a generator node in rounds 2+.
   */
  onEvolutionaryContext?(ctx: EvolutionaryContextRequest): Promise<EvolutionaryContextResult>;

  /**
   * Declare tools the workflow depends on.
   */
  declareTools?(ctx: WorkflowStartContext): Promise<ToolDeclaration[]>;

  /**
   * Called when a node proposes a new tool via its signal output.
   */
  onToolProposal?(ctx: ToolProposalContext): Promise<ToolProposalResult>;

  /**
   * Called when a tool regression is detected.
   */
  onToolRegression?(ctx: ToolRegressionContext): Promise<ToolRegressionResult>;
}
