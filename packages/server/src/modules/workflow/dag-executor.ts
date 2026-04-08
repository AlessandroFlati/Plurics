import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  WorkflowConfig,
  DagNode,
  NodeState,
  SignalFile,
  EventLogEntry,
} from './types.js';
import { TRANSITIONS } from './types.js';
import { SignalWatcher } from './signal-watcher.js';
import { validateSignalOutputs } from './signal-validator.js';
import { Registrar } from './registrar.js';
import { generatePurpose } from './purpose-templates.js';
import { randomHex, writeJsonAtomic } from './utils.js';
import type { TerminalRegistry } from '../terminal/terminal-registry.js';
import type { AgentBootstrap } from '../knowledge/agent-bootstrap.js';
import type { PresetRepository } from '../../db/preset-repository.js';

type StateChangeCallback = (
  runId: string, node: string, fromState: NodeState, toState: NodeState, event: string, terminalId?: string
) => void;
type WorkflowCompleteCallback = (runId: string, summary: WorkflowSummary) => void;

export interface WorkflowSummary {
  total_nodes: number;
  completed: number;
  failed: number;
  skipped: number;
  duration_seconds: number;
}

export class DagExecutor {
  private nodes = new Map<string, DagNode>();
  private readonly signalWatcher: SignalWatcher;
  private readonly registry: TerminalRegistry;
  private readonly bootstrap: AgentBootstrap;
  private readonly presetRepo: PresetRepository;
  private readonly registrar: Registrar;
  private readonly workspacePath: string;
  private readonly workflowConfig: WorkflowConfig;
  readonly runId: string;
  private readonly eventLog: EventLogEntry[] = [];
  private startedAt: number = 0;
  private onStateChange: StateChangeCallback | null = null;
  private onComplete: WorkflowCompleteCallback | null = null;
  private activeSubDags: number = 0;

  constructor(
    workflowConfig: WorkflowConfig,
    workspacePath: string,
    registry: TerminalRegistry,
    bootstrap: AgentBootstrap,
    presetRepo: PresetRepository,
  ) {
    this.workflowConfig = workflowConfig;
    this.workspacePath = workspacePath;
    this.registry = registry;
    this.bootstrap = bootstrap;
    this.presetRepo = presetRepo;
    this.signalWatcher = new SignalWatcher();
    this.registrar = new Registrar(workspacePath);
    this.runId = `run-${Date.now()}-${randomHex(4)}`;
  }

  setStateChangeHandler(handler: StateChangeCallback): void {
    this.onStateChange = handler;
  }

  setCompleteHandler(handler: WorkflowCompleteCallback): void {
    this.onComplete = handler;
  }

  getNodes(): Map<string, DagNode> {
    return this.nodes;
  }

  getEventLog(): EventLogEntry[] {
    return this.eventLog;
  }

  async start(): Promise<void> {
    this.startedAt = Date.now();
    this.bootstrap.setCwd(this.workspacePath);

    await this.initializeSharedDirectory();
    await this.registrar.initialize(
      this.workflowConfig.config.max_total_tests,
      this.workflowConfig.config.base_significance ?? 0.05,
    );
    this.buildNodeGraph();

    this.signalWatcher.start(this.workspacePath, (signal, filename) => {
      this.handleSignal(signal, filename);
    });

    this.evaluateReadyNodes();
    await this.scheduleReadyNodes();
  }

  async abort(): Promise<void> {
    this.signalWatcher.stop();
    for (const [, node] of this.nodes) {
      if (node.timeoutTimer) {
        clearTimeout(node.timeoutTimer);
        node.timeoutTimer = null;
      }
      if (node.terminalId && ['running', 'spawning'].includes(node.state)) {
        try { await this.registry.kill(node.terminalId); } catch { /* may already be dead */ }
      }
      if (['pending', 'ready', 'spawning', 'running', 'validating', 'retrying'].includes(node.state)) {
        node.state = 'skipped';
      }
    }
    this.emitWorkflowComplete();
  }

  private async initializeSharedDirectory(): Promise<void> {
    const dirs = [
      '.caam/shared/signals',
      '.caam/shared/hypotheses',
      '.caam/shared/test-plans',
      '.caam/shared/scripts',
      '.caam/shared/results',
      '.caam/shared/audit',
    ];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.workspacePath, dir), { recursive: true });
    }

    if (this.workflowConfig.shared_context) {
      const contextPath = path.join(this.workspacePath, '.caam', 'shared', 'context.md');
      await fs.writeFile(contextPath, this.workflowConfig.shared_context, 'utf-8');
    }
  }

  private buildNodeGraph(): void {
    for (const [name, nodeDef] of Object.entries(this.workflowConfig.nodes)) {
      this.nodes.set(name, {
        name,
        preset: nodeDef.preset,
        state: 'pending',
        scope: null,
        dependsOn: nodeDef.depends_on ?? [],
        terminalId: null,
        retryCount: 0,
        maxRetries: nodeDef.max_retries ?? 2,
        invocationCount: 0,
        maxInvocations: nodeDef.max_invocations ?? Infinity,
        timeoutMs: (nodeDef.timeout_seconds ?? this.workflowConfig.config.agent_timeout_seconds) * 1000,
        timeoutTimer: null,
        signal: null,
        startedAt: null,
      });
    }
  }

  private evaluateReadyNodes(): void {
    for (const [name, node] of this.nodes) {
      if (node.state !== 'pending') continue;

      // Check depends_on_all: wait for all scoped instances of named nodes to terminate
      const nodeDef = this.workflowConfig.nodes[node.name] ?? this.workflowConfig.nodes[name];
      if (nodeDef?.depends_on_all) {
        if (this.evaluateDependsOnAll(name, nodeDef.depends_on_all)) {
          this.transition(name, 'deps_met');
        }
        continue;
      }

      const depsFailed = node.dependsOn.some(depName => {
        const dep = this.nodes.get(depName);
        return dep && (dep.state === 'failed' || dep.state === 'skipped');
      });

      if (depsFailed) {
        this.transition(name, 'upstream_failed');
        continue;
      }

      const depsReady = node.dependsOn.every(depName => {
        const dep = this.nodes.get(depName);
        return dep && dep.state === 'completed';
      });

      if (depsReady) {
        this.transition(name, 'deps_met');
      }
    }
  }

  private evaluateDependsOnAll(nodeName: string, depNames: string[]): boolean {
    // All scoped instances of the named nodes must be in a terminal state
    for (const depBase of depNames) {
      const scopedNodes = [...this.nodes.values()].filter(
        n => n.name === depBase || n.name.startsWith(depBase + '.'),
      );
      // If no scoped nodes exist yet, check if all upstream is terminal (graceful degradation)
      if (scopedNodes.length === 0) {
        const allScopedTerminal = [...this.nodes.values()]
          .filter(n => n.scope !== null)
          .every(n => ['completed', 'failed', 'skipped'].includes(n.state));
        const noScopedNodes = ![...this.nodes.values()].some(n => n.scope !== null);
        // Graceful degradation: if no scoped nodes were ever created, allow meta_analyst to run
        if (noScopedNodes) {
          const allNonPendingTerminal = [...this.nodes.values()]
            .filter(n => n.name !== nodeName && !['pending'].includes(n.state))
            .every(n => ['completed', 'failed', 'skipped'].includes(n.state));
          return allNonPendingTerminal;
        }
        return allScopedTerminal;
      }
      const allTerminal = scopedNodes.every(
        n => ['completed', 'failed', 'skipped'].includes(n.state),
      );
      if (!allTerminal) return false;
    }
    return true;
  }

  private async scheduleReadyNodes(): Promise<void> {
    const maxParallel = this.workflowConfig.config.max_parallel_hypotheses ?? Infinity;
    const readyNodes = [...this.nodes.entries()].filter(([, n]) => n.state === 'ready');
    for (const [name, node] of readyNodes) {
      // Enforce concurrency limit for scoped (fan-out) nodes
      if (node.scope !== null && this.activeSubDags >= maxParallel) {
        continue;
      }
      if (node.scope !== null) {
        this.activeSubDags++;
      }
      await this.spawnAgent(name);
    }
  }

  private async spawnAgent(nodeName: string): Promise<void> {
    const node = this.nodes.get(nodeName)!;
    this.transition(nodeName, 'spawn');

    // Load preset content
    const presetRecord = this.presetRepo.list().find(p => p.name === node.preset);
    const presetContent = presetRecord?.purpose ?? `You are the ${node.preset} agent.`;

    // Get test budget if relevant
    let testBudgetInfo: { tests_executed: number; tests_remaining: number; significance_threshold_current: number } | undefined;
    if (['executor', 'architect', 'falsifier'].includes(node.name)) {
      try {
        const reg = await this.registrar.readRegistry();
        testBudgetInfo = {
          tests_executed: reg.tests_executed,
          tests_remaining: reg.tests_remaining,
          significance_threshold_current: reg.significance_threshold_current,
        };
      } catch { /* registry not yet initialized */ }
    }

    const purpose = generatePurpose(node, this.workflowConfig, presetContent, testBudgetInfo);

    const agentName = node.scope ? `${node.name}-${node.scope}` : node.name;
    const info = await this.registry.spawn({
      name: agentName,
      cwd: this.workspacePath,
      purpose,
    });

    node.terminalId = info.id;
    node.startedAt = Date.now();
    this.transition(nodeName, 'terminal_created');

    // Timeout
    node.timeoutTimer = setTimeout(() => {
      if (node.state === 'running') {
        this.handleTimeout(nodeName);
      }
    }, node.timeoutMs);

    // Crash detection
    this.registry.onTerminalExitById(info.id, () => {
      if (node.state === 'running') {
        this.handleCrash(nodeName);
      }
    });

    node.invocationCount++;
  }

  private async handleSignal(signal: SignalFile, filename: string): Promise<void> {
    const node = this.findNodeForSignal(signal);
    if (!node || node.state !== 'running') return;

    if (node.timeoutTimer) {
      clearTimeout(node.timeoutTimer);
      node.timeoutTimer = null;
    }

    node.signal = signal;
    this.transition(node.name, 'signal_received');

    const validation = await validateSignalOutputs(this.workspacePath, signal);
    if (!validation.valid) {
      this.handleRetryOrFail(node.name, {
        category: 'output_integrity_failed',
        message: validation.errors.map(e => `${e.path}: ${e.issue}`).join('; '),
        recoverable: true,
      });
      return;
    }

    switch (signal.status) {
      case 'success':
      case 'branch':
        this.transition(node.name, 'outputs_valid');
        break;

      case 'failure':
        if (signal.error?.recoverable) {
          this.handleRetryOrFail(node.name, signal.error);
        } else {
          node.retryCount = node.maxRetries;
          this.transition(node.name, 'max_retries');
        }
        this.postUpdate();
        return;

      case 'budget_exhausted':
        this.transition(node.name, 'outputs_valid');
        this.triggerBudgetExhaustion();
        this.postUpdate();
        return;
    }

    await this.postCompletion(node);
  }

  private async postCompletion(node: DagNode): Promise<void> {
    if (node.signal?.status === 'branch' && node.signal.decision) {
      await this.handleBranchDecision(node);
    }

    // Decrement sub-DAG counter when scoped terminal nodes complete
    if (node.scope !== null) {
      // Check if this is the last node in the sub-DAG for this scope
      const scopeNodes = [...this.nodes.values()].filter(n => n.scope === node.scope);
      const allTerminal = scopeNodes.every(n => ['completed', 'failed', 'skipped'].includes(n.state));
      if (allTerminal) {
        this.activeSubDags = Math.max(0, this.activeSubDags - 1);
      }
    }

    this.postUpdate();
  }

  private postUpdate(): void {
    this.evaluateReadyNodes();
    this.scheduleReadyNodes();
    this.checkWorkflowCompletion();
  }

  private async handleBranchDecision(node: DagNode): Promise<void> {
    const decision = node.signal!.decision!;
    const targetNodeDef = this.workflowConfig.nodes[decision.goto];
    if (!targetNodeDef) return;

    if (Array.isArray(decision.payload) && targetNodeDef.depends_on_all) {
      for (const scopeId of decision.payload as string[]) {
        await this.spawnScopedSubDag(decision.goto, String(scopeId));
      }
    } else {
      const targetNode = this.nodes.get(decision.goto);
      if (targetNode && targetNode.invocationCount < targetNode.maxInvocations) {
        targetNode.state = 'pending';
        targetNode.signal = null;
        targetNode.retryCount = 0;
      } else if (targetNode) {
        targetNode.state = 'completed';
      }
    }
  }

  private async spawnScopedSubDag(startNode: string, scope: string): Promise<void> {
    const subDagNodes = this.getSubDagFrom(startNode);

    for (const nodeName of subDagNodes) {
      const originalDef = this.workflowConfig.nodes[nodeName];
      const scopedName = `${nodeName}.${scope}`;

      this.nodes.set(scopedName, {
        name: scopedName,
        preset: originalDef.preset,
        state: 'pending',
        scope,
        dependsOn: (originalDef.depends_on ?? []).map(dep =>
          subDagNodes.includes(dep) ? `${dep}.${scope}` : dep,
        ),
        terminalId: null,
        retryCount: 0,
        maxRetries: originalDef.max_retries ?? 2,
        invocationCount: 0,
        maxInvocations: originalDef.max_invocations ?? Infinity,
        timeoutMs: (originalDef.timeout_seconds ?? this.workflowConfig.config.agent_timeout_seconds) * 1000,
        timeoutTimer: null,
        signal: null,
        startedAt: null,
      });
    }
  }

  private getSubDagFrom(startNode: string): string[] {
    const visited = new Set<string>();
    const queue = [startNode];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      // Find downstream nodes
      for (const [name, nodeDef] of Object.entries(this.workflowConfig.nodes)) {
        if (nodeDef.depends_on?.includes(current) && !visited.has(name)) {
          queue.push(name);
        }
      }
    }
    return [...visited];
  }

  private handleRetryOrFail(nodeName: string, error: SignalFile['error']): void {
    const node = this.nodes.get(nodeName)!;
    node.retryCount++;

    if (node.retryCount < node.maxRetries) {
      this.transition(nodeName, 'retry_available');
      node.state = 'ready';
      this.scheduleReadyNodes();
    } else {
      this.transition(nodeName, 'max_retries');
      this.evaluateReadyNodes();
    }
  }

  private handleTimeout(nodeName: string): void {
    const node = this.nodes.get(nodeName)!;

    if (node.terminalId) {
      this.registry.kill(node.terminalId).catch(() => {});
    }

    this.handleRetryOrFail(nodeName, {
      category: 'timeout',
      message: `Agent did not produce signal within ${node.timeoutMs / 1000}s`,
      recoverable: true,
    });
  }

  private handleCrash(nodeName: string): void {
    this.handleRetryOrFail(nodeName, {
      category: 'agent_crash',
      message: 'Terminal exited without producing a signal',
      recoverable: true,
    });
  }

  private triggerBudgetExhaustion(): void {
    for (const [name, node] of this.nodes) {
      if (['pending', 'ready'].includes(node.state) && name !== 'meta_analyst') {
        node.state = 'skipped';
      }
    }
  }

  private findNodeForSignal(signal: SignalFile): DagNode | undefined {
    // Try exact match first (scoped name)
    const scopedName = signal.scope ? `${signal.agent}.${signal.scope}` : signal.agent;
    const exact = this.nodes.get(scopedName);
    if (exact) return exact;

    // Fall back to base agent name
    return this.nodes.get(signal.agent);
  }

  private transition(nodeName: string, event: string): void {
    const node = this.nodes.get(nodeName)!;
    const validTransitions = TRANSITIONS[node.state];
    const newState = validTransitions?.[event];

    if (!newState) return;

    const oldState = node.state;
    node.state = newState;

    this.eventLog.push({
      timestamp: Date.now(),
      runId: this.runId,
      node: nodeName,
      fromState: oldState,
      toState: newState,
      event,
    });

    if (this.onStateChange) {
      this.onStateChange(this.runId, nodeName, oldState, newState, event, node.terminalId ?? undefined);
    }
  }

  private checkWorkflowCompletion(): void {
    const allTerminal = [...this.nodes.values()].every(
      n => ['completed', 'failed', 'skipped'].includes(n.state),
    );
    if (allTerminal) {
      this.signalWatcher.stop();
      this.emitWorkflowComplete();
    }
  }

  private emitWorkflowComplete(): void {
    const nodes = [...this.nodes.values()];
    const summary: WorkflowSummary = {
      total_nodes: nodes.length,
      completed: nodes.filter(n => n.state === 'completed').length,
      failed: nodes.filter(n => n.state === 'failed').length,
      skipped: nodes.filter(n => n.state === 'skipped').length,
      duration_seconds: (Date.now() - this.startedAt) / 1000,
    };
    if (this.onComplete) {
      this.onComplete(this.runId, summary);
    }
  }
}
