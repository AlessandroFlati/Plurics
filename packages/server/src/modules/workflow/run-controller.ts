import { DagExecutor } from './dag-executor.js';
import { parseWorkflow } from './yaml-parser.js';
import { validateInputManifest } from './input-validator.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { AgentBootstrap } from '../knowledge/agent-bootstrap.js';
import type { PresetRepository } from '../../db/preset-repository.js';
import type { WorkflowRepository } from '../../db/workflow-repository.js';
import type { RegistryClient } from '../registry/index.js';
import type { InputManifest } from './input-types.js';

export interface StartRunOptions {
  yamlContent: string;
  workspacePath: string;
  yamlPath?: string;
  inputManifest?: InputManifest;
}

export interface StartRunResult {
  runId: string;
  nodeCount: number;
  nodes: Array<{ name: string; state: string; scope: string | null }>;
}

export type BroadcastFn = (msg: object) => void;

export function createAndStartExecutor(
  opts: StartRunOptions,
  broadcast: BroadcastFn,
  registry: AgentRegistry,
  bootstrap: AgentBootstrap,
  presetRepo: PresetRepository,
  workflowRepo: WorkflowRepository,
  projectRoot: string,
  registryClient: RegistryClient | undefined,
  activeExecutors: Map<string, DagExecutor>,
): StartRunResult {
  if (opts.inputManifest) {
    const errs = validateInputManifest(opts.inputManifest, opts.workspacePath);
    if (errs.length > 0) throw new Error(`Input manifest errors: ${errs.map(e => e.message).join('; ')}`);
  }
  const config = parseWorkflow(opts.yamlContent);
  if (opts.yamlPath) config._yamlPath = opts.yamlPath;
  if (opts.inputManifest?.config_overrides) {
    config.config = { ...config.config, ...opts.inputManifest.config_overrides } as typeof config.config;
  }
  const executor = new DagExecutor(config, opts.workspacePath, projectRoot, registry, bootstrap, presetRepo, registryClient);

  executor.setStateChangeHandler((runId, node, fromState, toState, event, terminalId) => {
    broadcast({ type: 'workflow:node-update', runId, node, fromState, toState, event, terminalId });
    broadcast({ type: 'node:state_changed', timestamp: new Date().toISOString(), runId, payload: { nodeName: node, scope: null, previousState: fromState, newState: toState, attempt: 1, details: {} } });
  });

  executor.setCompleteHandler((runId, summary) => {
    workflowRepo.updateRunStatus(runId, summary.failed > 0 ? 'failed' : 'completed', summary.completed, summary.failed);
    broadcast({ type: 'workflow:completed', runId, summary });
    broadcast({ type: 'workflow:state_changed', timestamp: new Date().toISOString(), runId, payload: { status: summary.failed > 0 ? 'failed' : 'completed', previousStatus: 'running' } });
    activeExecutors.delete(runId);
  });

  executor.setFindingHandler((runId, hypothesisId, content) => {
    broadcast({ type: 'workflow:finding', runId, hypothesisId, content });
  });

  executor.setSignalReceivedHandler((runId, signalId, nodeName, scope, status, decisionSummary, outputCount) => {
    broadcast({ type: 'signal:received', timestamp: new Date().toISOString(), runId, payload: { signalId, nodeName, scope, status, decisionSummary, outputCount } });
  });

  executor.setToolInvokedHandler((runId, toolName, toolVersion, invokingNode, scope, success, durationMs) => {
    broadcast({ type: 'tool:invoked', timestamp: new Date().toISOString(), runId, payload: { toolName, toolVersion, invokingNode, scope, success, durationMs } });
  });

  activeExecutors.set(executor.runId, executor);
  const nodeCount = Object.keys(config.nodes).length;
  workflowRepo.createRun({
    id: executor.runId, workflow_name: config.name, workspace_path: opts.workspacePath,
    yaml_content: opts.yamlContent, status: 'running', node_count: nodeCount,
  });

  const initialNodes = Object.keys(config.nodes).map(name => ({ name, state: 'pending' as const, scope: null }));
  executor.start(opts.inputManifest ?? null).catch(err => {
    console.error(`[run-controller] executor failed: ${err}`);
  });

  return { runId: executor.runId, nodeCount, nodes: initialNodes };
}
