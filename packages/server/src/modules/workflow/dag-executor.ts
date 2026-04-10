import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  WorkflowConfig,
  DagNode,
  NodeState,
  SignalFile,
  EventLogEntry,
  NodeSnapshot,
  RunSnapshot,
} from './types.js';
import { TRANSITIONS } from './types.js';
import { SignalWatcher } from './signal-watcher.js';
import { validateSignalOutputs } from './signal-validator.js';
import { generatePurpose } from './purpose-templates.js';
import { randomHex, writeJsonAtomic, waitForOutput, normalizeAgentPath } from './utils.js';
import { resolvePresetContent, resolvePlaceholders } from './preset-resolver.js';
import type { WorkflowPlugin } from './sdk.js';
import { EvolutionaryPool } from './evolutionary-pool.js';
import type { AgentRegistry } from '../terminal/agent-registry.js';
import type { AgentBackend, AgentConfig } from '../terminal/agent-backend.js';
import type { AgentBootstrap } from '../knowledge/agent-bootstrap.js';
import type { PresetRepository } from '../../db/preset-repository.js';

type StateChangeCallback = (
  runId: string, node: string, fromState: NodeState, toState: NodeState, event: string, terminalId?: string
) => void;
type WorkflowCompleteCallback = (runId: string, summary: WorkflowSummary) => void;
type FindingCallback = (runId: string, hypothesisId: string, content: string) => void;

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
  private readonly registry: AgentRegistry;
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
  private onFinding: FindingCallback | null = null;
  private activeSubDags: number = 0;
  private paused: boolean = false;
  private readonly pool = new EvolutionaryPool();

  constructor(
    workflowConfig: WorkflowConfig,
    workspacePath: string,
    projectRoot: string,
    registry: AgentRegistry,
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

  setFindingHandler(handler: FindingCallback): void {
    this.onFinding = handler;
  }

  getNodes(): Map<string, DagNode> {
    return this.nodes;
  }

  getEventLog(): EventLogEntry[] {
    return this.eventLog;
  }

  /** Expose the evolutionary pool for plugin use. */
  getPool(): EvolutionaryPool {
    return this.pool;
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

  /**
   * Resume a previously interrupted run from disk state.
   * 1. Load plugin
   * 2. Load snapshot (node graph with scoped nodes)
   * 3. Recover signals for completed nodes
   * 4. Demote orphaned running/spawning nodes to ready
   * 5. Re-scan for signals written after snapshot
   * 6. Call plugin.onWorkflowResume
   * 7. Re-evaluate and reschedule
   */
  async resumeFrom(existingRunId: string): Promise<void> {
    // Override the auto-generated runId with the existing one
    (this as { runId: string }).runId = existingRunId;
    this.startedAt = Date.now();
    this.bootstrap.setCwd(this.workspacePath);

    const runDir = path.join(this.workspacePath, '.caam', 'runs', this.runId);

    // Ensure shared symlink points to this run
    const sharedLink = path.join(this.workspacePath, '.caam', 'shared');
    try { await fs.unlink(sharedLink); } catch { /* may not exist */ }
    try {
      await fs.symlink(runDir, sharedLink, 'junction');
    } catch {
      // Non-admin Windows — shared may already be a real dir from original run
    }

    // Load plugin
    if (this.workflowConfig.plugin) {
      try {
        const pluginPath = path.resolve(
          path.dirname(this.workflowConfig._yamlPath ?? ''),
          this.workflowConfig.plugin,
        );
        const pluginModule = await import(pluginPath);
        this.plugin = pluginModule.default as WorkflowPlugin;
      } catch { /* proceed without plugin */ }
    }

    // Load snapshot
    const snapshotPath = path.join(runDir, 'node-states.json');
    let snapshot: RunSnapshot;
    try {
      snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8')) as RunSnapshot;
    } catch {
      throw new Error(`Cannot resume run ${existingRunId}: node-states.json not found`);
    }

    // Load evolutionary pool snapshot if present
    try {
      const poolPath = path.join(runDir, 'pool-state.json');
      const poolSnapshot = JSON.parse(await fs.readFile(poolPath, 'utf-8'));
      this.pool.restore(poolSnapshot);
    } catch { /* no pool snapshot — fresh pool is fine */ }

    // Rebuild node graph from snapshot (includes scoped nodes)
    for (const ns of snapshot.nodes) {
      this.nodes.set(ns.key, {
        name: ns.name,
        preset: ns.preset,
        state: ns.state,
        scope: ns.scope,
        dependsOn: [...ns.dependsOn],
        terminalId: null, // Terminals are gone
        retryCount: ns.retryCount,
        maxRetries: ns.maxRetries,
        invocationCount: ns.invocationCount,
        maxInvocations: ns.maxInvocations,
        timeoutMs: ns.timeoutMs,
        timeoutTimer: null,
        signal: null, // Will be recovered from signal files
        startedAt: ns.startedAt,
      });
    }

    // Recover signals from disk for completed/failed nodes
    const signalIds = new Set<string>();
    try {
      await this.recoverSignalsFromDisk(runDir, signalIds);
    } catch { /* best effort */ }

    // Demote orphaned nodes: running/spawning/validating -> ready (terminals are dead)
    for (const [, node] of this.nodes) {
      if (['running', 'spawning', 'validating'].includes(node.state)) {
        if (node.signal && ['completed', 'failed'].includes(this.inferStateFromSignal(node.signal))) {
          // Signal exists but state wasn't updated — fix it
          node.state = node.signal.status === 'failure' ? 'failed' : 'completed';
        } else if (node.retryCount < node.maxRetries) {
          node.state = 'ready';
        } else {
          node.state = 'failed';
        }
      }
      if (node.state === 'retrying') {
        node.state = node.retryCount < node.maxRetries ? 'ready' : 'failed';
      }
    }

    // Re-scan for signals written AFTER the snapshot (race condition recovery)
    try {
      await this.recoverSignalsFromDisk(runDir, signalIds);
    } catch { /* best effort */ }

    // Plugin resume hook
    const completedNodes = [...this.nodes.values()]
      .filter(n => n.state === 'completed')
      .map(n => ({ name: n.name, scope: n.scope, signal: n.signal }));

    if (this.plugin?.onWorkflowResume) {
      await this.plugin.onWorkflowResume(this.workspacePath, this.workflowConfig.config, completedNodes);
    } else if (this.plugin?.onWorkflowStart) {
      // Fallback: re-run onWorkflowStart (plugin may create directories that already exist)
      await this.plugin.onWorkflowStart(this.workspacePath, this.workflowConfig.config);
    }

    // Start signal watcher, pre-populated with known signal IDs
    this.signalWatcher.prePopulate(signalIds);
    this.signalWatcher.startRecursive(runDir, (signal, filename) => {
      this.handleSignal(signal, filename);
    });

    this.paused = snapshot.paused;
    this.evaluateReadyNodes();
    await this.scheduleReadyNodes();
  }

  private async recoverSignalsFromDisk(runDir: string, signalIds: Set<string>): Promise<void> {
    const scanDir = async (dir: string) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.name.endsWith('.done.json')) {
          try {
            const raw = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
            const normalized = (await import('./utils.js')).normalizeAgentSignal(raw);
            const { validateSignalSchema } = await import('./signal-validator.js');
            if (!validateSignalSchema(normalized)) continue;
            const signal = normalized as unknown as SignalFile;
            signalIds.add(signal.signal_id);

            // Find the node this signal belongs to
            const node = this.findNodeForSignal(signal);
            if (node) {
              node.signal = signal;
              // Update state if node is in a non-terminal state
              if (!['completed', 'failed', 'skipped'].includes(node.state)) {
                if (signal.status === 'success' || signal.status === 'branch') {
                  node.state = 'completed';
                } else if (signal.status === 'failure' && !signal.error?.recoverable) {
                  node.state = 'failed';
                }
              }
            }
          } catch { /* skip unparseable signals */ }
        }
      }
    };
    await scanDir(runDir);
  }

  /**
   * For process/local-llm backends: convert AgentResult to a signal file on disk,
   * then let the signal watcher pick it up naturally.
   */
  private async generateSignalFromResult(nodeName: string, agentName: string, result: import('../terminal/agent-backend.js').AgentResult): Promise<void> {
    const node = this.nodes.get(nodeName);
    if (!node) return;

    const signal: SignalFile = {
      schema_version: 1,
      signal_id: `sig-${Date.now()}-${agentName}-${randomHex(2)}`,
      agent: node.name.split('.')[0], // base agent name
      scope: node.scope,
      status: result.success ? 'success' : 'failure',
      decision: null,
      outputs: result.artifacts.map(a => ({
        path: a.path,
        sha256: 'generated-by-platform',
        size_bytes: 0,
      })),
      metrics: {
        duration_seconds: result.durationMs / 1000,
        retries_used: node.retryCount,
      },
      error: result.success ? null : {
        category: result.exitCode !== null ? 'process_exit' : 'backend_error',
        message: result.error ?? 'Unknown error',
        recoverable: true,
      },
    };

    // Write signal file so the watcher picks it up
    const runDir = path.join(this.workspacePath, '.caam', 'runs', this.runId);
    const signalDir = path.join(runDir, 'signals');
    await fs.mkdir(signalDir, { recursive: true });
    const filename = `${agentName}.done.json`;
    await writeJsonAtomic(path.join(signalDir, filename), signal);
  }

  private inferStateFromSignal(signal: SignalFile): string {
    if (signal.status === 'success' || signal.status === 'branch') return 'completed';
    if (signal.status === 'failure') return 'failed';
    if (signal.status === 'budget_exhausted') return 'completed';
    return 'failed';
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
      const allMatchingNodes = [...this.nodes.values()].filter(
        n => n.name === depBase || n.name.startsWith(depBase + '.'),
      );
      // Separate scoped instances from the base template node
      const scopedOnly = allMatchingNodes.filter(n => n.scope !== null);
      const hasScoped = scopedOnly.length > 0;

      // If scoped instances exist, check ONLY those (ignore the base template node)
      if (hasScoped) {
        const allTerminal = scopedOnly.every(
          n => ['completed', 'failed', 'skipped'].includes(n.state),
        );
        if (!allTerminal) return false;
        continue;
      }

      // No scoped nodes: graceful degradation
      if (allMatchingNodes.length === 0) {
        const anyScopedNodes = [...this.nodes.values()].some(n => n.scope !== null);
        if (!anyScopedNodes) {
          // No scoped nodes ever created — allow if all non-pending are terminal
          const allNonPendingTerminal = [...this.nodes.values()]
            .filter(n => n.name !== nodeName && !['pending'].includes(n.state))
            .every(n => ['completed', 'failed', 'skipped'].includes(n.state));
          return allNonPendingTerminal;
        }
        // Scoped nodes exist elsewhere but not for this dep — check all scoped terminal
        const allScopedTerminal = [...this.nodes.values()]
          .filter(n => n.scope !== null)
          .every(n => ['completed', 'failed', 'skipped'].includes(n.state));
        return allScopedTerminal;
      }

      // Only base node exists, no scoped — check it directly
      const allTerminal = allMatchingNodes.every(
        n => ['completed', 'failed', 'skipped'].includes(n.state),
      );
      if (!allTerminal) return false;
    }
    return true;
  }

  private async scheduleReadyNodes(): Promise<void> {
    if (this.paused) return;
    const maxParallel = this.workflowConfig.config.max_parallel_hypotheses ?? Infinity;
    const maxConcurrent = this.workflowConfig.config.max_concurrent_agents ?? Infinity;
    const readyNodes = [...this.nodes.entries()].filter(([, n]) => n.state === 'ready');

    // Count active scopes (distinct sub-DAGs), not individual scoped nodes
    const activeScopes = new Set(
      [...this.nodes.values()]
        .filter(n => n.scope !== null && ['spawning', 'running', 'validating'].includes(n.state))
        .map(n => n.scope)
    );

    // Count total active agents (global hard cap)
    let activeAgents = [...this.nodes.values()]
      .filter(n => ['spawning', 'running', 'validating'].includes(n.state))
      .length;

    for (const [name, node] of readyNodes) {
      // Hard cap: never exceed max_concurrent_agents total terminals
      if (activeAgents >= maxConcurrent) break;

      // Skip base template nodes if scoped versions exist (they'd run with no real task)
      if (node.scope === null) {
        const hasScopedVersions = [...this.nodes.values()].some(
          n => n.scope !== null && n.name.startsWith(node.name + '.'),
        );
        if (hasScopedVersions) {
          node.state = 'completed'; // Mark as completed (no work to do)
          continue;
        }
      }

      // Scope concurrency: only block NEW scopes, not nodes within active scopes
      if (node.scope !== null && !activeScopes.has(node.scope) && activeScopes.size >= maxParallel) {
        continue;
      }

      await this.spawnAgent(name);
      activeAgents++;
      if (node.scope !== null) activeScopes.add(node.scope);
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
        pool: this.pool,
        round: node.invocationCount + 1,
      });
    }

    const agentName = node.scope ? `${node.name}-${node.scope}` : node.name;

    // Token estimate (~4 chars per token heuristic)
    const purposeTokens = Math.round(purpose.length / 4);
    this.eventLog.push({
      timestamp: Date.now(),
      runId: this.runId,
      node: agentName,
      fromState: 'spawning',
      toState: 'spawning',
      event: `purpose_tokens:${purposeTokens}`,
    });

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

    const nodeDef = this.workflowConfig.nodes[node.name] ?? this.workflowConfig.nodes[nodeName];
    const backendType = nodeDef?.backend ?? 'claude-code';

    // Build AgentConfig based on backend type
    const agentConfig: AgentConfig = {
      name: agentName,
      cwd: this.workspacePath,
      purpose,
      backend: backendType,
    };

    if (backendType === 'claude-code') {
      const modelMap: Record<string, string> = {
        opus: 'claude-opus-4-6',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5-20251001',
      };
      let command = 'claude --dangerously-skip-permissions';
      if (nodeDef?.model && modelMap[nodeDef.model]) {
        command += ` --model ${modelMap[nodeDef.model]}`;
      }
      agentConfig.command = command;
      agentConfig.effort = nodeDef?.effort;
    } else if (backendType === 'process') {
      agentConfig.processCommand = nodeDef?.command;
      agentConfig.workingDir = nodeDef?.working_dir
        ? resolvePlaceholders(nodeDef.working_dir, { WORKSPACE: this.workspacePath })
        : undefined;
    } else if (backendType === 'local-llm') {
      agentConfig.endpoint = nodeDef?.endpoint;
      agentConfig.model = nodeDef?.model;
      agentConfig.maxTokens = nodeDef?.max_tokens;
    }

    const info = await this.registry.spawn(agentConfig);
    const session = this.registry.get(info.id);

    // Backend-specific initialization
    if (backendType === 'claude-code' && session) {
      // PTY: trigger deferred command via resize, then wait for readiness
      await session.resize(120, 30);

      // Inject purpose prompt once Claude Code's input is ready.
      // Note: /compact removed — Claude Code v2.1.100+ has slash autocomplete
      // that interferes with programmatic injection. Effort level is a no-op now.
      const injectPurpose = () => {
        session.write(this.bootstrap.getInjectionPrompt(agentName));
      };

      waitForOutput(session, /bypass permissions|>\s*$/i, { timeout: 30000 })
        .then(() => setTimeout(() => injectPurpose(), 2000))
        .catch(() => injectPurpose());

      // Agent bootstrap files
      this.bootstrap.setCwd(this.workspacePath);
      this.bootstrap.createAgentFiles(agentName, purpose);
      this.bootstrap.regenerateAgentsList(this.registry.listWithPurpose());

    } else if ((backendType === 'process' || backendType === 'local-llm') && session) {
      // Non-PTY backends: inject purpose directly
      // For process: purpose is available via CAAM_PURPOSE_FILE env var
      // For local-llm: purpose is the prompt
      if (backendType === 'local-llm') {
        session.inject(purpose);
      }

      // Generate signal from result when process/llm exits
      session.onExit(() => {
        const result = session.getResult();
        if (result && node.state === 'running') {
          this.generateSignalFromResult(nodeName, agentName, result);
        }
      });
    }

    // Attach log capture
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

    // Crash/exit detection (for claude-code; process/llm exit is handled above)
    if (backendType === 'claude-code') {
      this.registry.onTerminalExitById(info.id, () => {
        if (node.state === 'running') {
          this.handleCrash(nodeName);
        }
      });
    }

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

    // Plugin hook: evolutionary pool update
    if (this.plugin?.onEvaluationResult) {
      try {
        await this.plugin.onEvaluationResult(node.name, signal, this.pool, this.workspacePath);
      } catch { /* pool updates are best-effort */ }
    }

    // Output integrity check — best-effort, does not block pipeline
    try {
      const validation = await validateSignalOutputs(this.workspacePath, signal);
      if (!validation.valid) {
        // Log but continue — agents may write slightly different sizes/paths
      }
    } catch { /* validation itself may fail if files not found via symlink */ }

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
    const decision = node.signal?.decision;
    const nodeDef = this.workflowConfig.nodes[node.name] ?? this.workflowConfig.nodes[node.name.split('.')[0]];

    // Routing chain: decision.goto -> plugin.onResolveRouting -> branch rules fallback
    if (decision && typeof decision === 'object' && 'goto' in decision) {
      // 1. Explicit decision.goto from agent
      await this.handleBranchDecision(node);
    } else if (nodeDef?.branch && nodeDef.branch.length > 0) {
      // 2. No decision.goto — ask plugin for routing
      let resolved = false;
      if (this.plugin?.onResolveRouting && node.signal) {
        const routing = await this.plugin.onResolveRouting(node.name, node.signal, nodeDef.branch);
        if (routing) {
          if (routing.foreach) {
            const ids = Array.isArray(routing.payload) ? routing.payload as string[] : [];
            if (ids.length > 0) {
              for (const id of ids) await this.spawnScopedSubDag(routing.goto, String(id));
              resolved = true;
            } else {
              await this.autoFanOut(node, routing.goto, routing.foreach);
              resolved = true;
            }
          } else {
            // Plugin gave us a concrete goto target
            node.signal!.decision = { goto: routing.goto, reason: 'plugin-resolved', payload: routing.payload ?? null };
            await this.handleBranchDecision(node);
            resolved = true;
          }
        }
      }

      // 3. Fallback: use branch rules directly
      if (!resolved) {
        const firstBranch = nodeDef.branch[0];
        if (firstBranch.foreach) {
          await this.autoFanOut(node, firstBranch.goto, firstBranch.foreach);
        } else if (firstBranch.goto) {
          const target = this.nodes.get(firstBranch.goto);
          if (target && target.state === 'pending') {
            target.dependsOn = target.dependsOn.filter(d => d !== node.name);
          }
        }
      }
    }

    // Emit finding if this is a reporter node that just completed
    if (node.name.startsWith('reporter') && node.state === 'completed' && node.scope && this.onFinding) {
      this.emitFinding(node.scope);
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

  private async autoFanOut(node: DagNode, targetNode: string, _foreachField: string): Promise<void> {
    // Try to find approved IDs from signal outputs or filesystem
    let approvedIds: string[] = [];

    // Check signal outputs for an approved file
    if (node.signal?.outputs) {
      for (const output of node.signal.outputs) {
        const outputPath = normalizeAgentPath(output.path);
        if (outputPath.includes('approved')) {
          try {
            const fullPath = path.join(this.workspacePath, '.caam', outputPath);
            const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
            if (content.approved_ids) approvedIds = content.approved_ids;
            else if (Array.isArray(content)) approvedIds = content;
          } catch { /* couldn't read */ }
        }
      }
    }

    // Fallback: scan filesystem for approved-*.json
    if (approvedIds.length === 0) {
      try {
        const sharedDir = path.join(this.workspacePath, '.caam', 'shared');
        const hypothesesDirs = ['data/hypotheses', 'hypotheses'];
        for (const dir of hypothesesDirs) {
          const fullDir = path.join(sharedDir, dir);
          try {
            const files = await fs.readdir(fullDir);
            for (const file of files) {
              if (file.startsWith('approved') && file.endsWith('.json')) {
                const content = JSON.parse(await fs.readFile(path.join(fullDir, file), 'utf-8'));
                if (content.approved_ids) { approvedIds = content.approved_ids; break; }
              }
            }
          } catch { /* dir doesn't exist */ }
          if (approvedIds.length > 0) break;
        }
      } catch { /* ignore */ }
    }

    if (approvedIds.length === 0) return;

    // Create scoped sub-DAGs for each approved ID
    for (const id of approvedIds) {
      await this.spawnScopedSubDag(targetNode, id);
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

    // Persist snapshot (fire-and-forget, don't block the pipeline)
    this.persistSnapshot();
  }

  private snapshotPending = false;

  private persistSnapshot(): void {
    // Debounce: multiple transitions may happen in the same tick
    if (this.snapshotPending) return;
    this.snapshotPending = true;
    queueMicrotask(() => {
      this.snapshotPending = false;
      this.writeSnapshot().catch(() => {});
    });
  }

  private async writeSnapshot(): Promise<void> {
    const runDir = path.join(this.workspacePath, '.caam', 'runs', this.runId);
    const snapshot: NodeSnapshot[] = [];
    for (const [key, node] of this.nodes) {
      snapshot.push({
        key,
        name: node.name,
        preset: node.preset,
        state: node.state,
        scope: node.scope,
        dependsOn: node.dependsOn,
        retryCount: node.retryCount,
        maxRetries: node.maxRetries,
        invocationCount: node.invocationCount,
        maxInvocations: node.maxInvocations,
        timeoutMs: node.timeoutMs,
        signalId: node.signal?.signal_id ?? null,
        startedAt: node.startedAt,
      });
    }
    await writeJsonAtomic(path.join(runDir, 'node-states.json'), {
      runId: this.runId,
      timestamp: Date.now(),
      paused: this.paused,
      nodes: snapshot,
    });

    // Persist evolutionary pool if it has content
    if (this.pool.count() > 0) {
      await writeJsonAtomic(path.join(runDir, 'pool-state.json'), this.pool.snapshot());
    }
  }

  private async emitFinding(scope: string): Promise<void> {
    if (!this.onFinding) return;
    try {
      const findingPath = path.join(this.workspacePath, '.caam', 'shared', 'findings', `${scope}-finding.md`);
      const content = await fs.readFile(findingPath, 'utf-8');
      this.onFinding(this.runId, scope, content);
    } catch {
      // Finding file may not exist yet or have a different name pattern
      try {
        const findingsDir = path.join(this.workspacePath, '.caam', 'shared', 'findings');
        const files = await fs.readdir(findingsDir);
        const match = files.find(f => f.includes(scope) && f.endsWith('.md'));
        if (match) {
          const content = await fs.readFile(path.join(findingsDir, match), 'utf-8');
          this.onFinding(this.runId, scope, content);
        }
      } catch { /* findings dir may not exist */ }
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
