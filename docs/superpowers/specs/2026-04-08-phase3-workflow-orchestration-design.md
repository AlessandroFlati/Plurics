# CAAM Phase 3: Workflow Orchestration — Architecture Changes

**Date:** 2026-04-08
**Scope:** Signal protocol, DAG executor engine, workflow YAML parser
**Builds on:** Phase 1 (Terminal Grid) + Phase 2 (Agent Communication)

---

## 1. Summary of Changes

Phase 3 adds three capabilities to CAAM:

1. **Signal protocol** — A filesystem-based contract for agents to report task completion, failure, and branching decisions. Replaces the current implicit "agent finished when terminal exits" model.
2. **DAG executor engine** — A server-side module that reads a workflow YAML, manages a directed acyclic graph of agent nodes, handles conditional branching, bounded loops, timeouts, retries, and lazy agent spawning.
3. **Workflow YAML format** — A declarative schema for defining multi-agent pipelines with dependencies, conditions, fan-out, and termination constraints.

### What changes in existing code

| File/Module | Change Type | Description |
|---|---|---|
| `packages/server/src/app.ts` | Modified | Wire new DagExecutor and SignalWatcher modules |
| `packages/server/src/modules/knowledge/agent-bootstrap.ts` | Modified | Support workflow-managed `.caam/` directory structures |
| `packages/server/src/modules/terminal/terminal-registry.ts` | Modified | Add `onOutput` hook for signal detection fallback |
| `packages/server/src/transport/protocol.ts` | Modified | Add workflow-related WebSocket message types |
| `packages/server/src/transport/websocket.ts` | Modified | Handle workflow start/stop/status messages |
| `packages/server/src/db/database.ts` | Modified | Add workflow run tables |
| `packages/web/src/App.tsx` | Modified | Add workflow controls panel |
| `packages/web/src/stores/terminal-store.ts` | Modified | Track workflow-managed terminals |

### What is new

| File/Module | Description |
|---|---|
| `packages/server/src/modules/workflow/types.ts` | All TypeScript types for workflow, signals, DAG nodes |
| `packages/server/src/modules/workflow/yaml-parser.ts` | Parses and validates workflow YAML into DAG structure |
| `packages/server/src/modules/workflow/dag-executor.ts` | Core DAG execution engine with state machine |
| `packages/server/src/modules/workflow/signal-watcher.ts` | Watches `.caam/shared/signals/` for agent completion signals |
| `packages/server/src/modules/workflow/signal-validator.ts` | Validates signal file schema, output integrity, deduplication |
| `packages/server/src/modules/workflow/registrar.ts` | Test budget tracking, Benjamini-Hochberg FDR correction |
| `packages/server/src/modules/workflow/purpose-templates.ts` | Generates agent purpose.md files from workflow config + context |
| `packages/server/src/db/workflow-repository.ts` | Workflow run persistence and history |
| `packages/web/src/components/workflow/WorkflowPanel.tsx` | Workflow status dashboard |
| `packages/web/src/components/workflow/DagVisualization.tsx` | Live DAG node status visualization |

---

## 2. Signal Protocol Specification

### 2.1 Signal File Format

Every agent, upon completing its task (successfully or not), writes a JSON signal file to `.caam/shared/signals/`. The signal file is the **sole mechanism** by which the DAG executor learns that an agent has finished.

```typescript
// packages/server/src/modules/workflow/types.ts

interface SignalFile {
  schema_version: 1;
  signal_id: string;          // Format: "sig-{ISO8601compact}-{agent}-{4hex}"
  agent: string;              // Agent name as defined in workflow YAML
  scope: string | null;       // null for singleton agents, "H-017" for hypothesis-scoped, "round-2" for round-scoped
  
  status: 'success' | 'failure' | 'branch' | 'budget_exhausted';
  
  decision: {                 // Only for branching agents (judge, auditor, falsifier)
    goto: string;             // Target node name in the DAG
    reason: string;           // Human-readable justification
    payload: unknown;         // Agent-specific data (e.g., list of approved hypothesis IDs)
  } | null;
  
  outputs: Array<{
    path: string;             // Relative to .caam/ (e.g., "shared/results/H-017-result.json")
    sha256: string;           // Hex-encoded SHA-256 of the file at write time
    size_bytes: number;
  }>;
  
  metrics: {
    duration_seconds: number;
    retries_used: number;     // How many times this agent was retried before this signal
  };
  
  error: {
    category: string;         // Machine-readable: "singular_matrix", "no_significant_results", etc.
    message: string;          // Human-readable description
    recoverable: boolean;     // Hint to DAG executor: should it retry?
  } | null;
}
```

### 2.2 Signal File Naming Convention

```
{agent}.done.json                          # Singleton agents (ingestor, profiler, meta_analyst)
{agent}.{scope}.done.json                  # Scoped agents (architect.H-017.done.json)
{agent}.{scope}.pass-{n}.done.json         # Loop iterations (auditor.H-017.pass-2.done.json)
{agent}.{scope}.retry-{n}.done.json        # Retries (coder.H-017.retry-1.done.json)
```

The DAG executor parses these filenames to extract agent name, scope, and iteration/retry counters. Use a regex parser:

```typescript
const SIGNAL_FILENAME_REGEX = /^(?<agent>[a-z_]+)(?:\.(?<scope>[A-Za-z0-9_-]+))?(?:\.(?<iteration>pass|retry)-(?<n>\d+))?\.done\.json$/;
```

### 2.3 Write Protocol (Agent Side)

Every agent's `purpose.md` must include the following protocol verbatim. The DAG executor's `purpose-templates.ts` module injects this automatically.

```markdown
## Output Protocol (MANDATORY — follow exactly)

When you complete your task, follow these steps IN ORDER:

### Step 1: Write output files via temp + rename
For every output file:
\`\`\`bash
cat > .caam/{output_path}.tmp << 'FILEEOF'
{content}
FILEEOF
mv .caam/{output_path}.tmp .caam/{output_path}
\`\`\`

### Step 2: Verify outputs are valid JSON (for .json files)
\`\`\`bash
python3 -c "import json; json.load(open('.caam/{output_path}'))"
\`\`\`

### Step 3: Compute SHA-256 for each output
\`\`\`bash
sha256sum .caam/{output_path} | cut -d' ' -f1
\`\`\`

### Step 4: Write signal file (ALWAYS LAST)
\`\`\`bash
cat > .caam/shared/signals/{signal_filename}.tmp << 'SIGEOF'
{
  "schema_version": 1,
  "signal_id": "sig-{timestamp}-{agent}-{hex4}",
  "agent": "{agent_name}",
  "scope": {scope_or_null},
  "status": "{status}",
  "decision": {decision_or_null},
  "outputs": [{output_entries_with_sha256}],
  "metrics": {"duration_seconds": {N}, "retries_used": {M}},
  "error": null
}
SIGEOF
mv .caam/shared/signals/{signal_filename}.tmp .caam/shared/signals/{signal_filename}
\`\`\`

CRITICAL RULES:
- NEVER write the signal file before all outputs are written and renamed
- ALWAYS use the .tmp + mv pattern (atomic rename)
- ALWAYS compute sha256 AFTER the mv of the output file
- If you encounter an unrecoverable error, still write a signal with status "failure"
```

### 2.4 Read Protocol (DAG Executor Side)

The `SignalWatcher` module watches `.caam/shared/signals/` using chokidar. When a `.done.json` file appears:

```typescript
// packages/server/src/modules/workflow/signal-watcher.ts

class SignalWatcher {
  private processedSignals: Set<string> = new Set();
  private watcher: FSWatcher | null = null;
  
  start(workspacePath: string, onSignal: (signal: SignalFile, filename: string) => void): void {
    const signalsDir = path.join(workspacePath, '.caam', 'shared', 'signals');
    
    this.watcher = chokidar.watch(path.join(signalsDir, '*.done.json'), {
      ignoreInitial: true,
      awaitWriteFinish: {       // Key: wait for file to be fully written
        stabilityThreshold: 300, // ms of no size change before firing
        pollInterval: 100
      }
    });
    
    this.watcher.on('add', async (filepath) => {
      await this.handleSignalFile(filepath, onSignal);
    });
  }
  
  private async handleSignalFile(
    filepath: string, 
    onSignal: (signal: SignalFile, filename: string) => void
  ): Promise<void> {
    const filename = path.basename(filepath);
    
    // Step 1: Ignore .tmp files
    if (filename.endsWith('.tmp')) return;
    
    // Step 2: Parse JSON with retry (filesystem may not have flushed)
    let raw: string;
    for (const delay of [0, 200, 500, 1000]) {
      if (delay > 0) await sleep(delay);
      try {
        raw = await fs.readFile(filepath, 'utf-8');
        break;
      } catch {
        if (delay === 1000) {
          this.emitError('signal_read_failed', filename);
          return;
        }
      }
    }
    
    // Step 3: Parse and validate schema
    let signal: SignalFile;
    try {
      signal = JSON.parse(raw!);
    } catch {
      this.emitError('signal_parse_failed', filename);
      return;
    }
    
    if (!this.validateSchema(signal)) {
      this.emitError('signal_schema_invalid', filename);
      return;
    }
    
    // Step 4: Deduplicate
    if (this.processedSignals.has(signal.signal_id)) return;
    this.processedSignals.add(signal.signal_id);
    
    // Step 5: Dispatch
    onSignal(signal, filename);
  }
}
```

### 2.5 Output Integrity Validation

After receiving a parsed signal, the DAG executor validates every declared output:

```typescript
// packages/server/src/modules/workflow/signal-validator.ts

interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    issue: 'missing' | 'size_mismatch' | 'sha256_mismatch' | 'json_parse_failed';
    expected: string | number;
    actual: string | number | null;
  }>;
}

async function validateSignalOutputs(
  workspacePath: string,
  signal: SignalFile
): Promise<ValidationResult> {
  const errors = [];
  
  for (const output of signal.outputs) {
    const fullPath = path.join(workspacePath, '.caam', output.path);
    
    // Check existence
    if (!await fileExists(fullPath)) {
      errors.push({ path: output.path, issue: 'missing', expected: 'exists', actual: null });
      continue;
    }
    
    // Check size
    const stat = await fs.stat(fullPath);
    if (stat.size !== output.size_bytes) {
      errors.push({ path: output.path, issue: 'size_mismatch', expected: output.size_bytes, actual: stat.size });
      continue;
    }
    
    // Check SHA-256
    const content = await fs.readFile(fullPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    if (hash !== output.sha256) {
      errors.push({ path: output.path, issue: 'sha256_mismatch', expected: output.sha256, actual: hash });
      continue;
    }
    
    // Check JSON parseability (for .json files)
    if (output.path.endsWith('.json')) {
      try {
        JSON.parse(content.toString('utf-8'));
      } catch {
        errors.push({ path: output.path, issue: 'json_parse_failed', expected: 'valid JSON', actual: 'parse error' });
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}
```

---

## 3. DAG Executor Engine

### 3.1 Node State Machine

Every node in the DAG tracks its execution state:

```typescript
type NodeState = 
  | 'pending'      // Waiting for upstream dependencies
  | 'ready'        // All dependencies satisfied, queued for spawning
  | 'spawning'     // Agent terminal being created
  | 'running'      // Agent is active, waiting for signal
  | 'validating'   // Signal received, checking output integrity
  | 'completed'    // Success, outputs verified
  | 'retrying'     // Failed, scheduling retry
  | 'failed'       // All retries exhausted
  | 'skipped';     // Upstream failure or budget exhaustion

interface DagNode {
  name: string;                    // From workflow YAML
  preset: string;                  // Agent preset reference
  state: NodeState;
  scope: string | null;            // Hypothesis ID or round number
  dependsOn: string[];             // Node names this depends on
  terminalId: string | null;       // CAAM terminal session ID when spawned
  retryCount: number;
  maxRetries: number;              // Default 2
  invocationCount: number;         // For max_invocations limit
  maxInvocations: number;          // From workflow YAML
  timeoutMs: number;               // From workflow config
  timeoutTimer: NodeJS.Timeout | null;
  signal: SignalFile | null;       // Last received signal
  startedAt: number | null;        // Timestamp
}
```

### 3.2 State Transitions

```typescript
// packages/server/src/modules/workflow/dag-executor.ts

const TRANSITIONS: Record<NodeState, Partial<Record<string, NodeState>>> = {
  pending:    { deps_met: 'ready', upstream_failed: 'skipped', budget_exhausted: 'skipped' },
  ready:      { spawn: 'spawning' },
  spawning:   { terminal_created: 'running' },
  running:    { signal_received: 'validating', timeout: 'retrying', crash: 'retrying' },
  validating: { outputs_valid: 'completed', integrity_failed: 'retrying' },
  retrying:   { retry_available: 'spawning', max_retries: 'failed' },
  completed:  {},  // Terminal state
  failed:     {},  // Terminal state
  skipped:    {},  // Terminal state
};
```

### 3.3 Core Executor Logic

```typescript
// packages/server/src/modules/workflow/dag-executor.ts

class DagExecutor {
  private nodes: Map<string, DagNode> = new Map();
  private signalWatcher: SignalWatcher;
  private registry: TerminalRegistry;
  private bootstrap: AgentBootstrap;
  private workspacePath: string;
  private workflowConfig: WorkflowConfig;
  private runId: string;
  private eventLog: EventLogEntry[] = [];
  
  constructor(
    workflowConfig: WorkflowConfig,
    workspacePath: string,
    registry: TerminalRegistry,
    bootstrap: AgentBootstrap,
    signalWatcher: SignalWatcher
  ) {
    this.workflowConfig = workflowConfig;
    this.workspacePath = workspacePath;
    this.registry = registry;
    this.bootstrap = bootstrap;
    this.signalWatcher = signalWatcher;
    this.runId = `run-${Date.now()}-${randomHex(4)}`;
  }
  
  async start(): Promise<void> {
    // 1. Initialize .caam/shared directory structure
    await this.initializeSharedDirectory();
    
    // 2. Build node graph from workflow config
    this.buildNodeGraph();
    
    // 3. Start signal watcher
    this.signalWatcher.start(this.workspacePath, (signal, filename) => {
      this.handleSignal(signal, filename);
    });
    
    // 4. Evaluate initial ready nodes (those with no dependencies)
    this.evaluateReadyNodes();
    
    // 5. Start the scheduler loop
    this.scheduleReadyNodes();
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
    
    // Write initial test registry
    const registryPath = path.join(this.workspacePath, '.caam/shared/test-registry.json');
    await writeJsonAtomic(registryPath, {
      budget: this.workflowConfig.config.max_total_tests,
      tests_executed: 0,
      tests_remaining: this.workflowConfig.config.max_total_tests,
      significance_threshold_current: this.workflowConfig.config.base_significance || 0.05,
      entries: []
    });
    
    // Write shared context
    const contextPath = path.join(this.workspacePath, '.caam/shared/context.md');
    await fs.writeFile(contextPath, this.workflowConfig.shared_context || '');
  }
  
  private buildNodeGraph(): void {
    for (const [name, nodeDef] of Object.entries(this.workflowConfig.nodes)) {
      this.nodes.set(name, {
        name,
        preset: nodeDef.preset,
        state: 'pending',
        scope: null,
        dependsOn: nodeDef.depends_on || [],
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
      
      const depsReady = node.dependsOn.every(depName => {
        const dep = this.nodes.get(depName);
        return dep && dep.state === 'completed';
      });
      
      const depsFailed = node.dependsOn.some(depName => {
        const dep = this.nodes.get(depName);
        return dep && (dep.state === 'failed' || dep.state === 'skipped');
      });
      
      if (depsFailed) {
        this.transition(name, 'upstream_failed');
      } else if (depsReady) {
        this.transition(name, 'deps_met');
      }
    }
  }
  
  private async scheduleReadyNodes(): Promise<void> {
    for (const [name, node] of this.nodes) {
      if (node.state !== 'ready') continue;
      await this.spawnAgent(name);
    }
  }
  
  private async spawnAgent(nodeName: string): Promise<void> {
    const node = this.nodes.get(nodeName)!;
    this.transition(nodeName, 'spawn');
    
    const purpose = await this.generatePurpose(node);
    
    const agentName = node.scope ? `${node.name}-${node.scope}` : node.name;
    const terminalId = await this.registry.spawn({
      name: agentName,
      cwd: this.workspacePath,
      command: 'claude --dangerously-skip-permissions',
      purpose,
    });
    
    node.terminalId = terminalId;
    node.startedAt = Date.now();
    this.transition(nodeName, 'terminal_created');
    
    // Start timeout timer
    node.timeoutTimer = setTimeout(() => {
      if (node.state === 'running') {
        this.handleTimeout(nodeName);
      }
    }, node.timeoutMs);
    
    // Listen for unexpected exit
    this.registry.onTerminalExit(terminalId, (exitCode) => {
      if (node.state === 'running') {
        this.handleCrash(nodeName, exitCode);
      }
    });
    
    node.invocationCount++;
  }
  
  private async handleSignal(signal: SignalFile, filename: string): Promise<void> {
    const node = this.findNodeForSignal(signal);
    if (!node || node.state !== 'running') {
      this.log('warn', `Unexpected signal ${filename} for node ${signal.agent} in state ${node?.state}`);
      return;
    }
    
    if (node.timeoutTimer) {
      clearTimeout(node.timeoutTimer);
      node.timeoutTimer = null;
    }
    
    node.signal = signal;
    this.transition(node.name, 'signal_received');
    
    const validation = await validateSignalOutputs(this.workspacePath, signal);
    
    if (!validation.valid) {
      this.log('error', `Output integrity check failed for ${node.name}`, validation.errors);
      this.handleRetryOrFail(node.name, {
        category: 'output_integrity_failed',
        message: validation.errors.map(e => `${e.path}: ${e.issue}`).join('; '),
        recoverable: true
      });
      return;
    }
    
    switch (signal.status) {
      case 'success':
        this.transition(node.name, 'outputs_valid');
        break;
        
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
        return;
        
      case 'budget_exhausted':
        this.transition(node.name, 'outputs_valid');
        this.triggerBudgetExhaustion();
        return;
    }
    
    await this.postCompletion(node);
  }
  
  private async postCompletion(node: DagNode): Promise<void> {
    if (node.signal?.status === 'branch' && node.signal.decision) {
      await this.handleBranchDecision(node);
    }
    
    if (node.name === 'executor') {
      await this.registrar.recordTestResult(node.signal!);
    }
    
    this.evaluateReadyNodes();
    await this.scheduleReadyNodes();
    
    this.checkWorkflowCompletion();
  }
  
  private async handleBranchDecision(node: DagNode): Promise<void> {
    const decision = node.signal!.decision!;
    const targetNodeDef = this.workflowConfig.nodes[decision.goto];
    
    if (!targetNodeDef) {
      this.log('error', `Branch target "${decision.goto}" not found in workflow`);
      return;
    }
    
    if (Array.isArray(decision.payload) && targetNodeDef.foreach) {
      for (const scopeId of decision.payload) {
        await this.spawnScopedSubDag(decision.goto, String(scopeId));
      }
    } else {
      const targetNode = this.nodes.get(decision.goto);
      if (targetNode && targetNode.invocationCount < targetNode.maxInvocations) {
        targetNode.state = 'pending';
        targetNode.signal = null;
        targetNode.retryCount = 0;
      } else if (targetNode) {
        this.log('warn', `Loop exhaustion: ${decision.goto} reached max_invocations (${targetNode.maxInvocations})`);
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
        dependsOn: originalDef.depends_on?.map(dep => 
          subDagNodes.includes(dep) ? `${dep}.${scope}` : dep
        ) || [],
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
    
    this.evaluateReadyNodes();
    await this.scheduleReadyNodes();
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
    this.log('warn', `Agent ${nodeName} timed out after ${node.timeoutMs}ms`);
    
    if (node.terminalId) {
      this.registry.kill(node.terminalId);
    }
    
    this.handleRetryOrFail(nodeName, {
      category: 'timeout',
      message: `Agent did not produce signal within ${node.timeoutMs / 1000}s`,
      recoverable: true
    });
  }
  
  private handleCrash(nodeName: string, exitCode: number | null): void {
    const node = this.nodes.get(nodeName)!;
    this.log('warn', `Agent ${nodeName} crashed with exit code ${exitCode}`);
    
    this.handleRetryOrFail(nodeName, {
      category: 'agent_crash',
      message: `Terminal exited with code ${exitCode} without producing a signal`,
      recoverable: true
    });
  }
  
  private triggerBudgetExhaustion(): void {
    for (const [name, node] of this.nodes) {
      if (['pending', 'ready'].includes(node.state) && name !== 'meta_analyst') {
        node.state = 'skipped';
        this.log('info', `Skipping ${name} due to budget exhaustion`);
      }
    }
    
    this.evaluateReadyNodes();
    this.scheduleReadyNodes();
  }
  
  private transition(nodeName: string, event: string): void {
    const node = this.nodes.get(nodeName)!;
    const validTransitions = TRANSITIONS[node.state];
    const newState = validTransitions?.[event];
    
    if (!newState) {
      this.log('warn', `Invalid transition: ${node.state} + ${event} for node ${nodeName}`);
      return;
    }
    
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
    
    this.emitStateChange(nodeName, oldState, newState, event);
  }
  
  private getSubDagFrom(startNode: string): string[] { /* BFS implementation */ }
  
  private checkWorkflowCompletion(): void {
    const allTerminal = [...this.nodes.values()].every(
      n => ['completed', 'failed', 'skipped'].includes(n.state)
    );
    if (allTerminal) {
      this.log('info', 'Workflow complete');
      this.signalWatcher.stop();
      this.emitWorkflowComplete();
    }
  }
}
```

### 3.4 Purpose Template Generation

When the DAG executor spawns an agent, it generates a `purpose.md` that combines:

1. The base preset content (from agent preset library)
2. The workflow shared context
3. The signal write protocol (section 2.3 of this document)
4. Scope-specific context (which hypothesis, which round)
5. Retry context (previous error, attempt number)
6. Current test budget from registrar

```typescript
// packages/server/src/modules/workflow/purpose-templates.ts

async function generatePurpose(
  node: DagNode,
  workflowConfig: WorkflowConfig,
  workspacePath: string
): Promise<string> {
  const sections: string[] = [];
  
  // 1. Role from preset
  const preset = await loadPreset(node.preset);
  sections.push(`# Role: ${node.name}\n\n${preset.content}`);
  
  // 2. Shared context
  if (workflowConfig.shared_context) {
    sections.push(`## Shared Context\n\n${workflowConfig.shared_context}`);
  }
  
  // 3. Scope context
  if (node.scope) {
    sections.push(`## Your Scope\n\nYou are working on: **${node.scope}**\nRead the relevant files from .caam/shared/ for this scope.`);
  }
  
  // 4. Signal protocol (always included, templated with actual values)
  const signalFilename = buildSignalFilename(node);
  sections.push(generateSignalProtocolSection(node, signalFilename));
  
  // 5. Retry context (if retrying)
  if (node.retryCount > 0 && node.signal?.error) {
    sections.push([
      `## Previous Attempt (FAILED)`,
      `Attempt: ${node.retryCount + 1} of ${node.maxRetries + 1}`,
      `Error category: ${node.signal.error.category}`,
      `Error message: ${node.signal.error.message}`,
      `\nAnalyze what went wrong and take a different approach.`
    ].join('\n'));
  }
  
  // 6. Test budget (for executor/architect/falsifier)
  if (['executor', 'architect', 'falsifier'].includes(node.name)) {
    const registry = await readTestRegistry(workspacePath);
    sections.push([
      `## Test Budget`,
      `Tests executed so far: ${registry.tests_executed}`,
      `Tests remaining: ${registry.tests_remaining}`,
      `Current significance threshold (BH-adjusted): ${registry.significance_threshold_current}`,
      `\nIf tests_remaining is 0, write a signal with status "budget_exhausted".`
    ].join('\n'));
  }
  
  return sections.join('\n\n---\n\n');
}
```

---

## 4. Workflow YAML Schema

### 4.1 Full Schema

```typescript
// packages/server/src/modules/workflow/types.ts

interface WorkflowConfig {
  name: string;
  version: number;
  
  config: {
    max_hypothesis_rounds: number;      // Max Judge -> Hypothesist loops
    max_audit_rounds: number;           // Max Auditor <-> Fixer loops
    max_total_tests: number;            // Global test budget
    agent_timeout_seconds: number;      // Default timeout per agent
    base_significance: number;          // Starting alpha (e.g., 0.05)
    max_parallel_hypotheses: number;    // Max concurrent hypothesis sub-DAGs
  };
  
  shared_context: string;               // Injected into every agent's purpose
  
  nodes: Record<string, WorkflowNodeDef>;
}

interface WorkflowNodeDef {
  preset: string;                       // Preset name or path
  depends_on?: string[];                // Upstream node names
  depends_on_all?: string[];            // Wait for ALL scoped instances (for meta_analyst)
  inputs?: string[];                    // .caam/ paths to read
  outputs?: string[];                   // .caam/ paths this agent writes
  
  // Branching
  branch?: Array<{
    condition: string;                  // Expression evaluated against signal.decision
    goto: string;                       // Target node name
    foreach?: string;                   // If set, fan-out over decision.payload items
  }>;
  
  // Loop control
  max_invocations?: number;             // Max times this node can be spawned
  next?: string;                        // Unconditional next node (for fixer -> auditor)
  
  // Override defaults
  max_retries?: number;
  timeout_seconds?: number;
}
```

### 4.2 YAML Parser

```typescript
// packages/server/src/modules/workflow/yaml-parser.ts

import { parse as parseYaml } from 'yaml';

function parseWorkflow(yamlContent: string): WorkflowConfig {
  const raw = parseYaml(yamlContent);
  
  assertField(raw, 'name', 'string');
  assertField(raw, 'version', 'number');
  assertField(raw, 'config', 'object');
  assertField(raw, 'nodes', 'object');
  
  const requiredConfigFields = [
    'max_hypothesis_rounds', 'max_audit_rounds', 
    'max_total_tests', 'agent_timeout_seconds'
  ];
  for (const field of requiredConfigFields) {
    assertField(raw.config, field, 'number');
  }
  
  validateNodeGraph(raw.nodes);
  resolveConfigReferences(raw);
  
  return raw as WorkflowConfig;
}

function validateNodeGraph(nodes: Record<string, WorkflowNodeDef>): void {
  for (const [name, node] of Object.entries(nodes)) {
    for (const dep of node.depends_on ?? []) {
      if (!nodes[dep]) throw new Error(`Node "${name}" depends on unknown node "${dep}"`);
    }
    for (const branch of node.branch ?? []) {
      if (!nodes[branch.goto]) throw new Error(`Node "${name}" branches to unknown node "${branch.goto}"`);
    }
    if (node.next && !nodes[node.next]) {
      throw new Error(`Node "${name}" has next="${node.next}" which doesn't exist`);
    }
  }
  
  // Check for unintended cycles using Kahn's algorithm
  // Cycles without max_invocations are errors
}
```

---

## 5. Registrar Module

The registrar is a server-side module (not an agent). It maintains the test registry file and applies Benjamini-Hochberg correction after each test execution.

```typescript
// packages/server/src/modules/workflow/registrar.ts

class Registrar {
  private registryPath: string;
  
  constructor(workspacePath: string) {
    this.registryPath = path.join(workspacePath, '.caam', 'shared', 'test-registry.json');
  }
  
  async recordTestResult(signal: SignalFile): Promise<void> {
    const registry = await this.readRegistry();
    
    const resultPath = signal.outputs.find(o => o.path.includes('result'))?.path;
    if (!resultPath) return;
    
    const result = await readJson(path.join(this.registryPath, '..', '..', resultPath));
    
    registry.entries.push({
      hypothesis_id: signal.scope,
      test_type: result.test_type,
      raw_p_value: result.p_value,
      adjusted_p_value: null,
      effect_size: result.effect_size,
      significant_after_correction: false,
      timestamp: new Date().toISOString(),
    });
    
    registry.tests_executed = registry.entries.length;
    registry.tests_remaining = registry.budget - registry.tests_executed;
    
    this.applyBenjaminiHochberg(registry);
    
    await writeJsonAtomic(this.registryPath, registry);
  }
  
  private applyBenjaminiHochberg(registry: TestRegistry): void {
    const n = registry.entries.length;
    if (n === 0) return;
    
    const sorted = registry.entries
      .map((e, i) => ({ entry: e, index: i }))
      .sort((a, b) => a.entry.raw_p_value - b.entry.raw_p_value);
    
    for (let rank = 0; rank < sorted.length; rank++) {
      const { entry } = sorted[rank];
      entry.adjusted_p_value = Math.min(
        1.0,
        entry.raw_p_value * n / (rank + 1)
      );
    }
    
    for (let i = sorted.length - 2; i >= 0; i--) {
      sorted[i].entry.adjusted_p_value = Math.min(
        sorted[i].entry.adjusted_p_value!,
        sorted[i + 1].entry.adjusted_p_value!
      );
    }
    
    const alpha = 0.05;
    for (const { entry } of sorted) {
      entry.significant_after_correction = entry.adjusted_p_value! <= alpha;
    }
    
    const lastSignificant = sorted.filter(s => s.entry.significant_after_correction).pop();
    registry.significance_threshold_current = lastSignificant 
      ? lastSignificant.entry.raw_p_value 
      : alpha / n;
  }
}
```

---

## 6. Database Changes

Add tables for workflow run persistence:

```sql
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  yaml_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  node_count INTEGER NOT NULL,
  nodes_completed INTEGER NOT NULL DEFAULT 0,
  nodes_failed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  node_name TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  event TEXT NOT NULL,
  details TEXT,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_run ON workflow_events(run_id);
```

---

## 7. WebSocket Protocol Additions

```typescript
// Client -> Server
{ type: 'workflow:start'; yamlContent: string; workspacePath: string }
{ type: 'workflow:abort'; runId: string }
{ type: 'workflow:status'; runId: string }

// Server -> Client
{ type: 'workflow:started'; runId: string; nodeCount: number; nodes: Array<{ name: string; state: NodeState; scope: string | null }> }
{ type: 'workflow:node-update'; runId: string; node: string; fromState: NodeState; toState: NodeState; event: string; terminalId?: string }
{ type: 'workflow:completed'; runId: string; summary: { total_nodes: number; completed: number; failed: number; skipped: number; duration_seconds: number } }
```

---

## 8. Changes to Existing Modules

### 8.1 app.ts

Wire DagExecutor, SignalWatcher, WorkflowRepository. Add REST endpoints for workflow start/abort/status/history.

### 8.2 terminal-registry.ts

Add per-terminal exit listeners (`onTerminalExit(terminalId, callback)`) for DagExecutor crash detection.

### 8.3 agent-bootstrap.ts

Add `initializeWorkflowDirs(workspacePath)` to create the full `.caam/shared/` directory structure for workflows (signals, hypotheses, test-plans, scripts, results, audit).

---

## 9. Utility: Atomic JSON Write

```typescript
// packages/server/src/modules/workflow/utils.ts

export async function writeJsonAtomic(filepath: string, data: unknown): Promise<void> {
  const tmpPath = `${filepath}.${randomBytes(4).toString('hex')}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, filepath);
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function buildSignalFilename(node: DagNode): string {
  let name = node.name;
  if (node.scope) name += `.${node.scope}`;
  if (node.retryCount > 0) name += `.retry-${node.retryCount}`;
  return `${name}.done.json`;
}
```

---

## 10. Implementation Order

1. **Types and utilities** — `workflow/types.ts`, `workflow/utils.ts`
2. **Signal infrastructure** — `signal-validator.ts`, `signal-watcher.ts` + tests
3. **YAML parser** — `yaml-parser.ts` + tests (install `yaml` package)
4. **Database** — migration in `database.ts`, `workflow-repository.ts`
5. **DAG executor core** — `dag-executor.ts`, `purpose-templates.ts`, terminal-registry changes + tests
6. **Registrar** — `registrar.ts` + tests (BH correction, budget tracking)
7. **Branch and fan-out** — `handleBranchDecision`, `spawnScopedSubDag` + tests
8. **WebSocket + REST** — protocol, websocket, app.ts integration
9. **Frontend** — `WorkflowPanel.tsx`, `DagVisualization.tsx` (can be Phase 3b)

---

## 11. Dependencies to Add

```bash
npm install yaml --workspace=packages/server
```

No other new dependencies required.

---

## 12. Design Decisions and Rationale

### Why filesystem-based signals instead of WebSocket messages?

1. **Persistence**: If the CAAM server crashes, signal files survive. On restart, the DAG executor can reconstruct state from the signals directory.
2. **Debuggability**: Signal files are human-readable JSON. You can inspect the entire run by looking at `.caam/shared/signals/`.
3. **Agent simplicity**: Agents write files — they don't need a communication client.
4. **Consistency with Phase 2**: The inbox.md pattern already established filesystem as the communication layer.

### Why not kill idle agents?

An idle Claude Code terminal consumes ~5-10 MB of RAM and zero API cost. Keeping completed agents alive provides scrollback buffer as a log, ability to manually inspect, and no re-spawn cost if re-invoked.

### Why Benjamini-Hochberg instead of Bonferroni?

Bonferroni is overly conservative for exploratory research. With 50 tests, the Bonferroni threshold is 0.001. BH controls the false discovery rate at 5%, acceptable for an exploratory system that generates hypotheses for human review.

### Why max_invocations on loop nodes instead of a global loop counter?

Each loop point may have different reasonable limits. Per-node limits are more expressive than a single global counter.
