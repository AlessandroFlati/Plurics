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
import { generatePurpose } from './purpose-templates.js';
import { randomHex, writeJsonAtomic } from './utils.js';
import { resolvePresetContent, resolvePlaceholders } from './preset-resolver.js';
import type { WorkflowPlugin } from './sdk.js';
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
  private plugin: WorkflowPlugin | null = null;
  private readonly workspacePath: string;
  private readonly projectRoot: string;
  private readonly workflowConfig: WorkflowConfig;
  readonly runId: string;
  private readonly eventLog: EventLogEntry[] = [];
  private startedAt: number = 0;
  private onStateChange: StateChangeCallback | null = null;
  private onComplete: WorkflowCompleteCallback | null = null;
  private activeSubDags: number = 0;
  private paused: boolean = false;

  constructor(
    workflowConfig: WorkflowConfig,
    workspacePath: string,
    projectRoot: string,
    registry: TerminalRegistry,
    bootstrap: AgentBootstrap,
    presetRepo: PresetRepository,
  ) {
    this.workflowConfig = workflowConfig;
    this.workspacePath = workspacePath;
    this.projectRoot = projectRoot;
    this.registry = registry;
    this.bootstrap = bootstrap;
    this.presetRepo = presetRepo;
    this.signalWatcher = new SignalWatcher();
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

  async start(inputManifest?: import('./input-types.js').InputManifest | null): Promise<void> {
    this.startedAt = Date.now();
    this.bootstrap.setCwd(this.workspacePath);

    await this.initializeRunDirectory(inputManifest);

    // Load plugin if specified in workflow YAML
    if (this.workflowConfig.plugin) {
      try {
        const pluginPath = path.resolve(
          path.dirname(this.workflowConfig._yamlPath ?? ''),
          this.workflowConfig.plugin,
        );
        const pluginModule = await import(pluginPath);
        this.plugin = pluginModule.default as WorkflowPlugin;
      } catch (err) {
        // Plugin load failure is not fatal — proceed without plugin
      }
    }

    // Plugin hook: domain-specific initialization
    await this.plugin?.onWorkflowStart?.(this.workspacePath, this.workflowConfig.config);

    this.buildNodeGraph();

    // Watch the entire run directory recursively for signal files
    // (agents may write to signals/, data/signals/, or other subdirectories)
    const runDir = path.join(this.workspacePath, '.caam', 'runs', this.runId);
    this.signalWatcher.startRecursive(runDir, (signal, filename) => {
      this.handleSignal(signal, filename);
    });

    this.evaluateReadyNodes();
    await this.scheduleReadyNodes();
  }

  async abort(): Promise<void> {
    this.paused = false;
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

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.evaluateReadyNodes();
    this.scheduleReadyNodes();
  }

  isPaused(): boolean {
    return this.paused;
  }

  private async initializeRunDirectory(inputManifest: import('./input-types.js').InputManifest | null | undefined): Promise<void> {
    // Create run-isolated directory
    const runDir = path.join(this.workspacePath, '.caam', 'runs', this.runId);
    for (const dir of ['purposes', 'logs', 'signals']) {
      await fs.mkdir(path.join(runDir, dir), { recursive: true });
    }

    // Shared data directory (persists across runs)
    const dataDir = path.join(this.workspacePath, '.caam', 'data');
    await fs.mkdir(dataDir, { recursive: true });

    // Point .caam/shared symlink to this run
    const sharedLink = path.join(this.workspacePath, '.caam', 'shared');
    try { await fs.unlink(sharedLink); } catch { /* may not exist */ }
    try {
      await fs.symlink(runDir, sharedLink, 'junction');
    } catch {
      // Symlinks may fail on Windows without admin. Fall back to using runDir directly.
      // Create shared as a real directory mirroring runDir
      await fs.mkdir(sharedLink, { recursive: true });
      for (const dir of ['purposes', 'logs', 'signals']) {
        await fs.mkdir(path.join(sharedLink, dir), { recursive: true });
      }
    }

    // Create signals dir in shared (agents write here)
    await fs.mkdir(path.join(sharedLink, 'signals'), { recursive: true });

    // Save input manifest
    if (inputManifest) {
      await writeJsonAtomic(path.join(runDir, 'input-manifest.json'), inputManifest);
    }

    // Write shared context
    if (this.workflowConfig.shared_context) {
      await fs.writeFile(path.join(sharedLink, 'context.md'), this.workflowConfig.shared_context, 'utf-8');
    }

    // Write run metadata (initial)
    await writeJsonAtomic(path.join(runDir, 'run-metadata.json'), {
      run_id: this.runId,
      workflow_name: this.workflowConfig.name,
      started_at: new Date().toISOString(),
      completed_at: null,
      status: 'running',
      config: this.workflowConfig.config,
      summary: null,
      artifacts: [],
    });
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

      // Plugin hook: custom readiness evaluation
      if (this.plugin?.onEvaluateReadiness) {
        const nodeStates = new Map<string, { name: string; state: NodeState; scope: string | null }>();
        for (const [n, nd] of this.nodes) nodeStates.set(n, { name: nd.name, state: nd.state, scope: nd.scope });
        const pluginResult = this.plugin.onEvaluateReadiness(name, nodeStates);
        if (pluginResult === true) { this.transition(name, 'deps_met'); continue; }
        if (pluginResult === false) continue;
      }

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
    if (this.paused) return;
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

    // Load and resolve preset content
    const rawPreset = resolvePresetContent(node.preset, this.projectRoot, this.presetRepo);
    const placeholders: Record<string, string | number> = {
      ROUND: node.invocationCount + 1,
      SCOPE: node.scope ?? '',
    };
    // Pass all config values as placeholders
    for (const [key, value] of Object.entries(this.workflowConfig.config)) {
      placeholders[key.toUpperCase()] = value as string | number;
    }
    const presetContent = resolvePlaceholders(rawPreset, placeholders);

    // Generate base purpose (generic: preset + shared context + signal protocol)
    let purpose = generatePurpose(node, this.workflowConfig, presetContent);

    // Plugin hook: domain-specific purpose enrichment
    if (this.plugin?.onPurposeGenerate) {
      purpose = await this.plugin.onPurposeGenerate(node.name, purpose, {
        scope: node.scope,
        retryCount: node.retryCount,
        previousError: node.signal?.error ?? null,
        workspacePath: this.workspacePath,
        config: this.workflowConfig.config,
      });
    }

    const agentName = node.scope ? `${node.name}-${node.scope}` : node.name;

    // Persist purpose for audit trail
    const runDir = path.join(this.workspacePath, '.caam', 'runs', this.runId);
    const purposeFilename = node.retryCount > 0
      ? `${agentName}.retry-${node.retryCount}.md`
      : `${agentName}.md`;
    await fs.mkdir(path.join(runDir, 'purposes'), { recursive: true });
    await fs.writeFile(path.join(runDir, 'purposes', purposeFilename), purpose, 'utf-8');

    // Create agent files (.caam/agents/<name>/purpose.md + inbox.md)
    this.bootstrap.setCwd(this.workspacePath);
    this.bootstrap.createAgentFiles(agentName, purpose);
    this.bootstrap.regenerateAgentsList(this.registry.listWithPurpose());

    // Build command with model and effort flags from node definition
    const nodeDef = this.workflowConfig.nodes[node.name] ?? this.workflowConfig.nodes[nodeName];
    const modelMap: Record<string, string> = {
      opus: 'claude-opus-4-6',
      sonnet: 'claude-sonnet-4-6',
      haiku: 'claude-haiku-4-5-20251001',
    };
    let command = 'claude --dangerously-skip-permissions';
    if (nodeDef?.model && modelMap[nodeDef.model]) {
      command += ` --model ${modelMap[nodeDef.model]}`;
    }

    const info = await this.registry.spawn({
      name: agentName,
      cwd: this.workspacePath,
      purpose,
      command,
    });

    // Trigger deferred command by sending initial resize
    // (normally xterm.js does this, but workflow agents may have no UI client)
    const session = this.registry.get(info.id);
    if (session) {
      await session.resize(120, 30);

      // Subscribe to output so the session stays alive
      session.onData(() => {});

      // Inject purpose prompt after Claude Code has time to start
      setTimeout(() => {
        // Set effort level if specified
        const effort = nodeDef?.effort ?? 'low';
        if (effort === 'low') {
          session.write('/compact\r');
          // Wait a beat for the command to register
          setTimeout(() => {
            session.write(this.bootstrap.getInjectionPrompt(agentName));
          }, 500);
        } else {
          session.write(this.bootstrap.getInjectionPrompt(agentName));
        }
      }, 5000);
    }

    // Attach log capture for terminal output
    const logDir = path.join(runDir, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, `${agentName}.log`);
    const { createWriteStream } = await import('node:fs');
    const logStream = createWriteStream(logPath, { flags: 'a' });
    this.registry.onOutput(info.id, (data: string) => { logStream.write(data); });
    this.registry.onTerminalExitById(info.id, () => { logStream.end(); });

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

    // Plugin hook: domain-specific signal processing
    if (this.plugin?.onSignalReceived) {
      const override = await this.plugin.onSignalReceived(node.name, signal, this.workspacePath);
      if (override) {
        if (override.status) signal.status = override.status;
        if (override.decision) signal.decision = override.decision;
      }
    }

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

  private async emitWorkflowComplete(): Promise<void> {
    const nodes = [...this.nodes.values()];
    const summary: WorkflowSummary = {
      total_nodes: nodes.length,
      completed: nodes.filter(n => n.state === 'completed').length,
      failed: nodes.filter(n => n.state === 'failed').length,
      skipped: nodes.filter(n => n.state === 'skipped').length,
      duration_seconds: (Date.now() - this.startedAt) / 1000,
    };

    // Plugin hook: workflow completion
    await this.plugin?.onWorkflowComplete?.(this.workspacePath, {
      runId: this.runId,
      totalNodes: summary.total_nodes,
      completed: summary.completed,
      failed: summary.failed,
      skipped: summary.skipped,
      durationSeconds: summary.duration_seconds,
    });

    // Update run metadata with final summary
    try {
      const runDir = path.join(this.workspacePath, '.caam', 'runs', this.runId);
      const metaPath = path.join(runDir, 'run-metadata.json');
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      meta.completed_at = new Date().toISOString();
      meta.status = summary.failed > 0 ? 'failed' : 'completed';
      meta.summary = summary;
      await writeJsonAtomic(metaPath, meta);
    } catch { /* best effort */ }

    if (this.onComplete) {
      this.onComplete(this.runId, summary);
    }
  }
}
