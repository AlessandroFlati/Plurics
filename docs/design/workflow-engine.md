# Plurics Workflow Engine — Design Document

**Version:** 0.1 (draft)
**Status:** Mostly descriptive — workflow engine is implemented; minor changes pending TR Phase 4-5 integration
**Scope:** The DAG executor, state machine, signal protocol, fan-out, scoped subgraphs, resume protocol
**Parent document:** `docs/design/overview.md` Section 6
**Related documents:** `docs/design/node-runtimes.md`, `docs/design/plugin-sdk.md`, `docs/design/type-system.md`, `docs/design/persistence.md` (to be written)

---

## 1. Introduction and Scope

The Workflow Engine is the heart of Plurics' Layer 1. It is the component that loads workflow YAML files, parses them into executable directed acyclic graphs, schedules nodes according to dependencies and concurrency constraints, dispatches work to node runtimes, collects completion signals, persists state for resumability, and exposes progress to the UI. Everything else in Plurics — the Tool Registry, the node runtimes, the plugin system, the evolutionary pool, the persistence layer, the frontend — is either consumed by the engine or consumes the engine's outputs. The engine is the orchestrator that makes the rest of the system coherent.

This document specifies the engine in detail. It covers the workflow YAML format and how it is parsed into an executable graph, the node state machine that governs execution, the scheduling logic that decides which nodes run when, the signal protocol that carries information from completed nodes back to the engine, the fan-out mechanism that creates parallel scoped subgraphs from runtime data, and the resume protocol that recovers a workflow from a snapshot after an interruption.

The document is mostly descriptive: the workflow engine is implemented in the current Plurics codebase and most of what is described here is already running. Where the engine will change for the Tool Registry integration (TR Phases 4-5), this is noted explicitly in implementation status markers. Where the description relies on assumptions about current code that the author cannot verify directly, this is marked as "verify against current implementation" so that corrections can be made during review.

The document does not cover: the per-node runtime details that happen after dispatch (those are in `docs/design/node-runtimes.md`), the type checking that happens before scheduling (that is in `docs/design/type-system.md`), the plugin hooks invoked during execution (those are in `docs/design/plugin-sdk.md`), the persistence layer's storage details (those will be in `docs/design/persistence.md`), and the WebSocket protocol used to notify the UI (that will be in `docs/design/ui.md`). Cross-references to these documents are provided where relevant.

## 2. Workflow YAML Format

A workflow is defined by a `workflow.yaml` file in the workflow's directory. The file is the declarative description from which the engine constructs the executable graph. This section specifies the format.

### 2.1 Top-Level Structure

```yaml
name: math-discovery
version: 2
description: |
  Discovery workflow for finding patterns in financial time series
  with formal verification via Lean 4.

version_policy:
  resolution: pin_at_start
  dynamic_tools:
    - "workflow.math_discovery.proposed.*"
  on_destructive_change:
    action: invalidate_and_continue
    scope: contaminated

config:
  data_source: ./data/eurusd_5m.parquet
  max_rounds: 5
  pool_size: 50

required_tools:
  - name: pandas.load_parquet
    version: latest
  - name: stats.adf_test
    version: 1
  - name: lean.compile
    version: latest

concurrency:
  max_parallel_scopes: 10
  max_concurrent_agents: 5

nodes:
  load_data:
    kind: tool
    tool: pandas.load_parquet
    inputs:
      path: "{{config.data_source}}"

  profiler:
    kind: reasoning
    backend: claude
    model: claude-sonnet-4-6
    preset: presets/profiler.md
    toolset:
      - category: descriptive_statistics
      - name: stats.adf_test
    depends_on: [load_data]

  conjecturer:
    kind: reasoning
    backend: claude
    model: claude-opus-4-6
    preset: presets/conjecturer.md
    toolset:
      - category: descriptive_statistics
      - category: hypothesis_testing
    depends_on: [profiler]
    foreach_emits: true

  prover:
    kind: reasoning
    backend: claude
    model: claude-opus-4-6
    preset: presets/prover.md
    toolset:
      - name: lean.compile
      - category: symbolic_math
    depends_on: [conjecturer]

  reporter:
    kind: reasoning
    backend: claude
    model: claude-sonnet-4-6
    preset: presets/reporter.md
    toolset: []
    depends_on: [prover]
    aggregates_scopes: true
```

The top-level fields are:

**`name`**: workflow identifier, used in run records, logs, and UI display. Must match the directory name by convention.

**`version`**: integer version of the workflow definition. Incremented when the YAML structure changes in ways that break compatibility with previous run snapshots.

**`description`**: human-readable description, displayed in the UI and included in run metadata.

**`version_policy`**: declares how the workflow resolves tool versions and reacts to destructive changes in tools it has used. Optional; workflows that omit it receive safe defaults. See `docs/design/tool-registry.md` §8.4 for the full specification of the block's fields and semantics.

**`config`**: arbitrary key-value pairs that the workflow uses for parameterization. Values can be strings, numbers, booleans, or nested objects. Referenced from node YAML using `{{config.key}}` substitution.

**`required_tools`**: list of tool dependencies the workflow needs from the registry. Validated at parse time. Added with TR Phase 4. Pre-TR-Phase-4, this field is absent and tool dependencies are implicit. → See `docs/design/tool-registry.md` Section 10.1 for the declaration format.

**`concurrency`**: scope-level and global concurrency limits enforced by the scheduler. `max_parallel_scopes` is the maximum number of concurrently active scoped subgraphs (relevant for fan-out workflows). `max_concurrent_agents` is the maximum number of nodes in any state past `ready` at the same time, regardless of scope.

**`nodes`**: the dictionary of nodes that make up the workflow's DAG. Each node is keyed by its name (a unique identifier within the workflow) and has fields specific to its kind. Specified in detail in Section 2.2.

### 2.2 Node Definition

Each node in the `nodes` dictionary has a structure determined by its `kind`. The two kinds are `reasoning` and `tool`, introduced in `docs/design/node-runtimes.md` Section 2.

**Common fields (both kinds):**

```yaml
node_name:
  kind: reasoning | tool
  depends_on: [list of upstream node names]
  timeout_seconds: 900           # optional, default varies
  max_retries: 2                 # optional, default 2
  retry_backoff_seconds: 30      # optional, default 30
  scope: scope_name | null       # optional, used for explicit scoping
```

**`kind`**: discriminator. Determines which runtime path the dispatcher uses. Required.

**`depends_on`**: list of node names that must reach `completed` state before this node can be scheduled. The names must refer to existing nodes in the same workflow. The dependency graph must be acyclic — cycles are detected at parse time and reported as errors.

**`timeout_seconds`**: maximum wall clock time the node is allowed to run before being forcibly terminated. Default depends on the node kind: tool nodes default to 300, reasoning nodes default to 900.

**`max_retries`**: number of retry attempts after a failure before the node is permanently marked as failed. Retries follow the backoff policy.

**`retry_backoff_seconds`**: base delay between retry attempts. The actual delay increases with each retry (exponential backoff with a cap; details in Section 5.4).

**`scope`**: an explicit scope name for static scoping. Most nodes do not use this — they inherit scope from the fan-out mechanism described in Section 7. Static scoping is for cases where the workflow author wants a specific node to always operate in a named scope regardless of fan-out.

**Reasoning node specific fields:**

```yaml
reasoning_node_name:
  kind: reasoning
  backend: claude | openai-compat | ollama
  model: model_identifier_string
  preset: presets/path/to/preset.md
  toolset:
    - { category: category_name }
    - { name: tool.name, version: optional_int }
    - { name: tool_pattern_with_glob.* }
  max_turns: 20                  # optional, default 20
  max_tokens_per_response: 4096  # optional, default 4096
```

These are documented in `docs/design/node-runtimes.md` Sections 2 and 4. Briefly: `backend` and `model` select the LLM, `preset` is the path to the markdown template for the purpose, `toolset` is the list of tools accessible to the LLM during execution.

**Tool node specific fields:**

```yaml
tool_node_name:
  kind: tool
  tool: tool.name
  version: optional_int
  inputs:
    port_name_1: literal_or_reference
    port_name_2: literal_or_reference
```

Documented in `docs/design/node-runtimes.md` Section 3. The `tool` field names the registry tool to invoke; `version` optionally pins to a specific version (default: latest); `inputs` provides the values for each input port.

### 2.3 YAML Parsing and Validation

The engine parses the workflow YAML in three steps:

**Step 1: Syntactic parsing.** Read the file, parse as YAML using a standard library (the current implementation uses `js-yaml`, verify against current code). Catch syntax errors and report them with line numbers. The result is a JavaScript object tree.

**Step 2: Schema validation.** Validate the parsed object against the workflow schema. Check that required top-level fields are present (`name`, `nodes`), that node definitions have the required fields for their kind, that field types match expectations (strings where strings are expected, lists where lists are expected). Schema validation errors are reported with the path to the offending field.

**Step 3: Semantic validation.** Beyond syntactic and structural correctness, check semantic constraints: the dependency graph is acyclic, all `depends_on` references point to existing nodes, all `{{config.key}}` substitutions reference existing config keys, all backend names are recognized, all preset paths refer to existing files in the workflow directory. After TR Phase 4, additional semantic checks are added: tool references resolve to registry entries, type checker passes on tool node inputs.

Errors from any step are accumulated and reported as a batch at the end of parsing. The engine refuses to start a workflow with parse errors, presenting all of them to the user at once rather than fixing one and re-parsing to find the next.

The parser produces a `ParsedWorkflow` object containing the validated structure plus derived information: the topological order of nodes, the set of root nodes (no dependencies), the set of leaf nodes (no dependents), the set of fan-out nodes, and the resolved tool references. This object is the input to the DAG construction phase.

```typescript
// Reference signature, verify against current implementation
interface ParsedWorkflow {
  name: string;
  version: number;
  description: string;
  config: Record<string, unknown>;
  requiredTools: ToolRequirement[];
  concurrency: ConcurrencyConfig;
  nodes: Map<string, NodeDefinition>;
  topologicalOrder: string[];
  rootNodes: Set<string>;
  leafNodes: Set<string>;
  fanOutNodes: Set<string>;
}
```

## 3. DAG Construction

After the workflow YAML is parsed, the engine constructs an in-memory DAG from the validated definition. The DAG is the data structure the scheduler operates on.

A node in the DAG is a `NodeInstance` that wraps a `NodeDefinition` from the YAML with runtime state: current state in the state machine, attempt count, scope identifier, signals received, error history, dispatch metadata. The `NodeInstance` is mutable; the `NodeDefinition` is not.

```typescript
// Reference signature, verify against current implementation
interface NodeInstance {
  name: string;
  scope: string | null;
  definition: NodeDefinition;
  state: NodeState;
  attempt: number;
  signals: Signal[];
  startedAt?: string;
  completedAt?: string;
  lastError?: NodeError;
  dispatchHandle?: DispatchHandle;
}
```

The DAG is initially constructed from the static node definitions in the YAML. At this point, every node in the YAML has exactly one `NodeInstance`, with `scope: null` and `state: pending`. The DAG is then a collection of these instances, indexed by `(name, scope)` tuples for efficient lookup.

When fan-out happens at runtime (Section 7), additional `NodeInstance` objects are created dynamically for each scoped copy of downstream nodes. These dynamic instances are added to the DAG and tracked alongside the static ones. From the scheduler's point of view, dynamic and static instances are indistinguishable — they are both `NodeInstance` objects with their own state and dependencies.

The DAG is held entirely in memory by the engine's main process. Persistent state on disk (snapshots, signal files, run metadata) mirrors the in-memory DAG and is used to reconstruct it on resume. This dual representation is intentional: in-memory access is fast for the scheduler's hot loop, while disk persistence is durable for crash recovery. The `node-states.json` snapshot file is the canonical persistent representation; the in-memory DAG is its working copy.

## 4. The Node State Machine

Every node in the workflow DAG passes through a state machine during its lifecycle. Understanding the state machine is essential for understanding how the engine reasons about workflow progress, when nodes can run, and what to do on failure or interruption.

### 4.1 The States

```
                  ┌─────────────┐
                  │   PENDING   │  (waiting for dependencies)
                  └──────┬──────┘
                         │ dependencies satisfied
                         ▼
                  ┌─────────────┐
              ┌──►│    READY    │  (eligible for dispatch)
              │   └──────┬──────┘
              │          │ scheduler picks this node
              │          ▼
              │   ┌─────────────┐
              │   │  SPAWNING   │  (runtime is being initialized)
              │   └──────┬──────┘
              │          │ runtime initialized
              │          ▼
              │   ┌─────────────┐
              │   │   RUNNING   │  (work in progress)
              │   └──────┬──────┘
              │          │ signal emitted
              │          ▼
              │   ┌─────────────┐
              │   │ VALIDATING  │  (signal being checked)
              │   └──┬───────┬──┘
              │      │       │
              │  ok  │       │ rejected by plugin
              │      ▼       │
              │ ┌─────────┐  │
              │ │COMPLETED│  │
              │ └─────────┘  │
              │              ▼
              │       ┌─────────────┐
              │       │  RETRYING   │  (waiting backoff)
              │       └──────┬──────┘
              │              │ backoff elapsed
              └──────────────┘ retries remain

                        ┌─────────────┐
                        │   FAILED    │  (terminal failure)
                        └─────────────┘
                              ▲
                              │ retries exhausted or fatal error
                              │
                              from any state above

                        ┌─────────────┐
                        │   SKIPPED   │  (upstream failed, this won't run)
                        └─────────────┘
```

The eight states are:

**`pending`**: the initial state. The node has been registered in the DAG but at least one of its dependencies has not yet reached `completed`. The scheduler does not consider this node for dispatch.

**`ready`**: all dependencies are `completed`, the optional `onEvaluateReadiness` plugin hook (if implemented) has approved, and the node is eligible to be picked up by the scheduler. The node sits in this state until concurrency slots become available.

**`spawning`**: the scheduler has picked up the node and is initializing its runtime. For tool nodes, this is fast (resolve the tool, prepare inputs). For reasoning nodes, this involves resolving the toolset, generating the purpose via plugin hooks, constructing the system prompt, and establishing the LLM session. The state exists as a distinct phase because spawning can fail (tool not found, preset missing, plugin error), and these failures should be distinguished from runtime failures.

**`running`**: the runtime is actively executing. For tool nodes, the Python subprocess is running. For reasoning nodes, the LLM tool-calling loop is in progress. The engine waits for a completion signal.

**`validating`**: the node has emitted a signal and the engine is processing it. This includes schema validation, normalization of field aliases, deduplication via signal_id, plugin invocation of `onSignalReceived`, and finally the platform's own state transition logic. This phase is brief but distinct because failures here (malformed signals, plugin rejections) are handled differently from runtime failures.

**`completed`**: the node has finished successfully. The signal has been validated and accepted. Downstream nodes can now check if their dependencies are satisfied. The node's outputs are available in the value store for upstream references.

**`retrying`**: the node failed but retries remain. The engine waits for the backoff period to elapse, then transitions back to `ready` for re-dispatch. The retry preserves the attempt counter but generates a fresh purpose (for reasoning nodes) and resolves inputs again from upstream signals (for tool nodes).

**`failed`**: terminal failure. The node has either exhausted its retry budget or hit a non-retryable error. Downstream nodes that depend on this one will transition to `skipped`.

**`skipped`**: the node will not run because at least one of its dependencies is in `failed` state. This is also terminal: skipped nodes do not retry and do not become eligible later.

### 4.2 The Transitions

The transitions between states are governed by the following table. Each row describes a transition from a source state, the trigger that causes it, and any side effects.

| From | To | Trigger | Side effects |
|---|---|---|---|
| pending | ready | All dependencies reached `completed` | `onEvaluateReadiness` plugin hook called if implemented |
| pending | skipped | Any dependency reached `failed` | Downstream effects propagate |
| ready | spawning | Scheduler selects this node | Concurrency slot acquired |
| spawning | running | Runtime initialized successfully | `dispatchHandle` recorded |
| spawning | retrying | Spawning failed (recoverable) | Error logged; concurrency slot released |
| spawning | failed | Spawning failed (non-recoverable) | Error logged; concurrency slot released |
| running | validating | Signal file appeared in `signals/` directory | Signal parsed and queued for validation |
| validating | completed | Signal valid and accepted by plugin | Outputs registered in value store; downstream nodes re-evaluated |
| validating | retrying | Signal rejected by plugin with retry decision | Concurrency slot released |
| validating | failed | Signal malformed and unrecoverable | Concurrency slot released |
| running | retrying | Wall clock timeout exceeded | Subprocess killed; concurrency slot released |
| running | failed | Runtime reported fatal error | Concurrency slot released |
| retrying | ready | Backoff period elapsed and retries remain | Attempt counter incremented |
| retrying | failed | Retries exhausted | — |

The `validating` state deserves special attention because it is where the plugin system intersects with the state machine most heavily. The transition from `validating` is determined by the result of `onSignalReceived` (if implemented):

- If the plugin returns `accept`: transition to `completed`.
- If the plugin returns `accept_with_handoff`: write the handoff files, then transition to `completed`.
- If the plugin returns `reject_and_retry`: transition to `retrying` with the rejection reason recorded.
- If the plugin returns `reject_and_branch`: transition to `completed` (the source node itself is fine), but redirect the workflow's downstream evaluation to the branch target instead of the default routing.
- If the plugin throws an exception: transition to `failed` with the plugin error.
- If no plugin is implemented (or `onSignalReceived` is not present): default to `accept` semantics.

### 4.3 State Persistence

State transitions are persisted to disk continuously. After every transition, the engine writes the updated `node-states.json` snapshot in the run directory. The snapshot is the canonical record of "what the workflow looks like right now," and it is what the resume protocol reads to reconstruct state.

The snapshot is written atomically: the new content goes to a temporary file, which is then renamed over the existing snapshot. Atomic rename prevents corruption if the engine crashes mid-write. The frequency of snapshot writes is "every state transition" — there is no batching, no debouncing, no opportunistic delay. This is a deliberate choice for crash safety: any node state visible in memory must also be visible on disk.

The performance cost of frequent snapshot writes is acceptable for the workflow scales Plurics targets (tens to low hundreds of nodes per workflow, transition rates of dozens per second at most). For larger scales, batching could be introduced, but it is not currently necessary. The full snapshot is small: even with 200 dynamically created scoped node instances, the JSON serialization is well under 100 KB.

## 5. Scheduling and Concurrency

The scheduler is the part of the engine that decides which `ready` nodes to transition to `spawning`. It runs in response to state changes and respects concurrency limits.

### 5.1 The Scheduler Loop

The scheduler is implemented as an event-driven loop rather than a polling loop. It is triggered by:

- A node transitioning to `completed` (downstream dependencies may now be satisfied)
- A node transitioning to `failed` (downstream nodes need to transition to `skipped`)
- A node releasing a concurrency slot (more `ready` nodes may now be eligible)
- A `retrying` node's backoff elapsing
- An external trigger (workflow start, resume from snapshot)

On each trigger, the scheduler performs the following sweep:

1. **Recompute readiness.** For every node currently in `pending`, check if all its dependencies are `completed`. If so, transition to `ready` (or to `skipped` if any dependency is `failed`).

2. **Apply readiness hook.** For every node newly in `ready`, if `onEvaluateReadiness` is implemented, call it. If the hook returns `ready: false`, return the node to `pending` with the deferred reason logged.

3. **Pick eligible nodes.** Identify all `ready` nodes that can be dispatched given current concurrency. The eligibility check considers both the global limit (`max_concurrent_agents`) and the per-scope limit (`max_parallel_scopes` for fan-out workflows). Within the eligible set, ordering is by topological position (earlier nodes first) with ties broken by name for determinism.

4. **Dispatch.** For each picked node, transition to `spawning`, acquire a concurrency slot, and hand off to the appropriate runtime (tool node runtime or reasoning node runtime, depending on `kind`).

5. **Handle failures and skips.** Propagate `failed` status to downstream nodes that have this node as a dependency, transitioning them to `skipped`.

6. **Persist state.** Write the updated snapshot to disk.

The sweep is idempotent: running it multiple times with the same input state produces the same output state. This is important for resume — the scheduler can run on the recovered state and arrive at exactly the same scheduling decisions as before the crash.

### 5.2 Concurrency Limits

Two limits constrain how many nodes can be active at once:

**`max_concurrent_agents`**: the global limit. Counts every node currently in `spawning`, `running`, or `validating` state, across all scopes. When this limit is reached, no new dispatches happen until a slot is released by a node transitioning out of these states.

**`max_parallel_scopes`**: the per-scope limit. Counts the number of scopes that have at least one node in an active state. When this limit is reached, no new scopes are created (relevant for fan-out workflows where each fan-out instance creates a new scope).

The two limits interact in non-trivial ways. A workflow with `max_concurrent_agents: 5` and `max_parallel_scopes: 10` can have 10 scopes active simultaneously, but only 5 of those scopes can have a node actively running at any moment — the other 5 are sitting in `pending` or `ready`, waiting for a slot. This creates fairness issues that the scheduler must handle: which 5 scopes get to run? The current implementation (verify against actual code) uses a round-robin among scopes with `ready` nodes, ensuring that no scope is starved.

Concurrency slots are acquired and released via a counter rather than a semaphore. The counter is incremented when a node enters `spawning` and decremented when it leaves `validating` (whether to `completed`, `retrying`, or `failed`). The counter is stored in memory and reflected in the snapshot for resume consistency.

### 5.3 Deterministic Ordering

The scheduler is deterministic given the same inputs. Two runs of the same workflow with the same data and the same RNG seed (where applicable) produce the same node order. This is important for two reasons:

**Reproducibility.** A user investigating a failed run can replay the same workflow and reasonably expect to see the same behavior, including the order in which nodes were dispatched. Non-determinism here would make debugging nightmarish.

**Resume consistency.** When resuming from a snapshot, the scheduler must arrive at the same decisions it would have made if the crash had not happened. If scheduling order depended on wall clock time or random selection, the resumed run would diverge from the pre-crash behavior in subtle ways.

Determinism is achieved by sorting the eligible set by `(topological_position, name, scope)` as a stable tuple. The topological position is computed once at parse time. Wall clock time is not used as an input to scheduling decisions; it is only used for retry backoff and for timing measurements that go into metrics but not into control flow.

LLM responses are inherently non-deterministic, so determinism in the scheduling sense does not extend to "the same result is produced." It extends to "the same nodes run in the same order." What each node produces depends on the LLM, and that varies even on identical inputs.

### 5.4 Retry Backoff

When a node enters `retrying`, the engine sets a timer for the backoff period before transitioning back to `ready`. The backoff is exponential with a cap:

```
delay = min(retry_backoff_seconds * (2 ** (attempt - 1)), 600)
```

For the default `retry_backoff_seconds: 30` and `max_retries: 2`:
- Attempt 1 (first retry): wait 30 seconds
- Attempt 2 (second retry): wait 60 seconds

The cap of 600 seconds (10 minutes) prevents extreme backoffs from delaying the workflow indefinitely on persistent failures. With the default retry count, the cap is never reached, but workflows configured with high retry counts and high backoff base values would otherwise see backoffs grow without bound.

The timer is implemented via `setTimeout` in the Node.js event loop. On a crash and resume, the timer is lost — the resumed engine sees the node in `retrying` state and immediately re-evaluates whether to transition it back to `ready`, effectively cutting any remaining backoff. This is a deliberate trade-off: precise backoff timing is not as important as making forward progress quickly after recovery.

## 6. The Signal Protocol

A signal is the mechanism by which a node reports completion to the workflow engine. This section specifies the signal format, validation rules, and processing pipeline in full.

### 6.1 Signal Schema

A signal is a JSON object written to a file in the run's `signals/` directory. The file naming convention is `{nodeName}-{scope_or_root}-{attempt}-{shortHash}.json`, where `scope_or_root` is the scope identifier or `root` for non-scoped nodes, and `shortHash` is a short hash for uniqueness in case of multiple writes.

```typescript
// Canonical signal schema, verify against current implementation
interface Signal {
  schema_version: 1;
  signal_id: string;          // Unique deduplication key
  agent: string;              // The node name that emitted this signal
  scope: string | null;       // The scope, or null for non-scoped nodes
  attempt: number;            // Which attempt of the node this is
  status: 'success' | 'failure' | 'partial';
  decision: SignalDecision | null;
  outputs: SignalOutput[];
  metrics: SignalMetrics;
  error: SignalError | null;
  timestamp: string;          // ISO 8601 UTC
}

interface SignalDecision {
  // Domain-specific routing/decision data, interpreted by plugin
  // Common fields used by built-in routing logic:
  verdict?: 'confirmed' | 'falsified' | 'inconclusive';
  next_action?: string;
  // Plus arbitrary additional fields the workflow plugin understands
  [key: string]: unknown;
}

interface SignalOutput {
  port: string;               // Port name as declared by the node
  schema: string;             // Schema name from the type system
  value_ref: string;          // Reference to the value store entry
  sha256: string;             // Integrity hash
  size_bytes: number;         // Size for observability
  summary?: string;           // Optional human-readable summary
}

// The `path`-based format (`{path, sha256, size_bytes}`) is legacy from the pre-registry
// era and is accepted for backward compatibility but should not be used in new signal
// emissions. All new code should use the `value_ref`-based format above.

interface SignalMetrics {
  duration_seconds: number;
  tokens_used?: number;       // For reasoning nodes
  retries_used: number;
  tool_calls_made?: number;   // For reasoning nodes
}

interface SignalError {
  category: string;
  message: string;
  details?: Record<string, unknown>;
}
```

The fields are:

**`schema_version`**: integer version of the signal schema. Currently 1. Allows for future schema evolution while maintaining backward compatibility for resumed runs.

**`signal_id`**: a unique deduplication key. Generated by the runtime as `{runId}-{nodeName}-{scope}-{attempt}-{shortRandom}`. The engine uses this to detect and ignore duplicate signal writes.

**`agent`**: the name of the node that produced this signal. Must match a node in the workflow YAML. Used to route the signal to the correct DAG entry.

**`scope`**: the scope identifier if the node is part of a scoped subgraph, or null otherwise.

**`attempt`**: the attempt counter, starting at 1 for the first attempt, incremented by 1 for each retry. Used to correlate the signal with the correct dispatch.

**`status`**: the high-level outcome. `success` and `failure` are obvious; `partial` is used for nodes that completed some work but are signaling that they need to be re-dispatched (a hybrid of completion and retry).

**`decision`**: an optional object whose fields are interpreted by the workflow plugin. The platform recognizes a few standard fields (like `verdict` for evolutionary workflows) but treats the rest as opaque.

**`outputs`**: the list of values the node produced, one per declared output port. Each entry references the value store rather than inlining the value, so signals stay small even when outputs are large.

**`metrics`**: timing, token usage (for reasoning nodes), and retry metadata. Used for observability and run analysis.

**`error`**: present only when `status` is `failure`. Contains the error category, message, and any additional details.

**`timestamp`**: when the signal was emitted, in UTC ISO 8601 format.

### 6.2 Signal Detection and Reading

The engine watches the `signals/` directory using a file watcher (the current implementation uses `chokidar`, verify against current code). When a new file appears, the engine reads it, parses it as JSON, validates it against the schema, and processes it.

File watching has known reliability issues across platforms. The current implementation handles this with a polling fallback for filesystems where native watching is unreliable (notably NTFS on Windows). The fallback polls the directory at a low frequency (every 2 seconds) for files that appeared since the last sweep, in addition to any native events the watcher emits.

Signal files are not deleted after being processed. They remain in the run directory as part of the audit trail. The engine deduplicates by `signal_id`, so re-reading an already-processed file (e.g., on resume) does not cause double processing.

### 6.3 Signal Validation and Normalization

Validation proceeds in three steps:

**Step 1: Schema validation.** Check that the JSON parses, that required fields are present, that field types match the schema. Failures at this step mean the signal is unusable and the node is treated as if it had emitted a malformed signal — it transitions to `failed` with the validation error captured.

**Step 2: Normalization.** Apply transformations that standardize common output variations. For example: stripping run-relative path prefixes from `value_ref` fields, coercing alternative field names (`agent_name` → `agent`, `result` → `outputs`) to the canonical form, defaulting missing optional fields to their conventional values. Normalization is forgiving: signals from older workflow versions or from agents that emit slightly different field names still get processed.

**Step 3: Deduplication.** Check the `signal_id` against the set of previously-processed signal IDs for the run. If the ID has been seen before, the signal is a duplicate and is silently ignored. Duplicates can occur if a node writes the same signal twice (e.g., a Python wrapper that retries on transient errors), or if the file watcher delivers the same event twice.

After validation and normalization, the signal enters the validating state of the corresponding node and is processed by the plugin's `onSignalReceived` hook (if implemented), then by the platform's default signal handling logic.

### 6.4 Signal Acceptance and Routing

The default signal handling logic (when no plugin overrides) is:

- If `status: success`: transition the node to `completed`. Register outputs in the value store. Re-evaluate downstream dependencies.
- If `status: failure`: increment the attempt counter. If retries remain, transition to `retrying`. If exhausted, transition to `failed`.
- If `status: partial`: treat as a request to re-dispatch. The node transitions to `retrying` with a special "continuation" flag that the runtime can read on the next attempt to avoid starting from scratch.

The plugin's `onSignalReceived` can override this default by returning one of the four decision actions (`accept`, `accept_with_handoff`, `reject_and_retry`, `reject_and_branch`) as documented in `docs/design/plugin-sdk.md` Section 4.1.

## 7. Fan-Out and Scoped Subgraphs

Fan-out is the mechanism by which a workflow processes a list of items in parallel using the same downstream subgraph. It is what makes Plurics suitable for discovery workflows where the number of items to process is determined at runtime.

### 7.1 The Concept

A typical workflow without fan-out has a fixed DAG: every node is instantiated once, and execution proceeds linearly through the dependencies. A fan-out workflow has a node that emits a signal containing a list, and the engine creates a parallel scoped subgraph for each item in the list, instantiating the downstream nodes once per scope.

The motivating example is `research-swarm`. A `hypothesis_generator` node produces 10 hypotheses. The downstream nodes (`investigator`, `critic`, `synthesizer`) need to run on each hypothesis independently. Without fan-out, the workflow author would have to either write 10 copies of each downstream node or write a single node that loops internally (losing parallelism and observability). With fan-out, the workflow declares the subgraph once and the engine handles the multiplication automatically.

### 7.2 The Mechanism

A fan-out happens when:

1. A node in the workflow YAML has `foreach_emits: true` declared in its definition.
2. That node emits a signal whose `outputs` includes a port whose value is an array.
3. The engine detects the array output and creates one scoped subgraph per element.

The scoped subgraph consists of all downstream nodes (transitively) of the fan-out node, up to (but not including) any node that has `aggregates_scopes: true` declared. The aggregator node receives the union of signals from all scopes and is responsible for combining them into a single result.

```
Without fan-out:                With fan-out:

   [generator]                       [generator]
        │                                 │
        ▼                                 │ emits foreach
   [investigator]                         │
        │                       ┌─────────┼─────────┐
        ▼                       │         │         │
   [critic]                  scope_h1  scope_h2  scope_h3
        │                    [investigator] x3
        ▼                       │         │         │
   [synthesizer]              [critic]  [critic]  [critic]
                                │         │         │
                                └─────────┼─────────┘
                                          │ aggregator
                                          ▼
                                    [synthesizer]
```

### 7.3 Scope Identifier Generation

Each scope created by fan-out is identified by a string. The format is `{fanOutNodeName}-{itemIndex}-{shortHash}` where `itemIndex` is the position of the item in the array (1-indexed) and `shortHash` is a 4-character hash of the item's content for disambiguation.

For example, a fan-out from `hypothesis_generator` with 3 hypotheses might create scopes: `hypothesis_generator-1-a3f2`, `hypothesis_generator-2-b7e1`, `hypothesis_generator-3-c5d9`. The scope identifier is opaque to the workflow but is used by the engine to track per-scope state and by the plugin's hooks to know which scope they are operating on.

The hash component is included so that re-running a fan-out with the same items produces the same scope identifiers, supporting reproducibility. If a fan-out produces a different list on a re-run, the scope identifiers differ accordingly.

### 7.4 Scoped Node Instantiation

When the engine processes a fan-out signal, it walks the static DAG starting from the fan-out node, identifies all transitively downstream nodes that are within scope (i.e., before the next aggregator), and creates a `NodeInstance` for each scoped copy. The new instances have:

- `name`: same as the static definition
- `scope`: the scope identifier
- `definition`: shared with the static definition (immutable)
- `state`: starts as `pending`
- All other fields: per-instance

The dynamically created instances are added to the in-memory DAG and to the snapshot. From the scheduler's point of view, they are first-class nodes that participate in the same state machine as static nodes. Their dependencies are also scoped: a scoped `critic` depends on the scoped `investigator` of the same scope, not on all `investigator` instances.

The aggregator node is *not* duplicated. There is exactly one instance of the aggregator, and its dependency on the scoped subgraph is special: it requires *all* scoped instances of its declared upstream node to reach `completed` before it becomes ready. This many-to-one dependency is represented in the dependency graph as a special edge type that the scheduler recognizes.

### 7.5 Scoped State and Routing

Plugin hooks called for scoped nodes receive the scope identifier in their context. This lets the plugin maintain per-scope state, route signals based on scope, and customize purposes per scope. The plugin's responsibilities are:

- Treating each scope as an independent execution thread for signal handling
- Aggregating across scopes when the aggregator node is called
- Cleaning up per-scope state when scopes terminate

The platform handles the basics: scoping the value store entries, scoping the signal directory layout (signals from a scoped node have the scope in their filename), and scoping the snapshot persistence.

### 7.6 Concurrency Within and Across Scopes

The `max_parallel_scopes` concurrency limit caps the number of scopes that can have active nodes simultaneously. Within each scope, the global `max_concurrent_agents` limit applies, but scopes also share the global pool — so if `max_concurrent_agents: 5` and 10 scopes are active, the 5 slots are distributed across scopes via round-robin fairness.

This means that even with high `max_parallel_scopes`, the actual parallelism is bounded by `max_concurrent_agents`. Workflow authors should size both limits with this interaction in mind: `max_parallel_scopes` controls how many independent investigations can be in progress, while `max_concurrent_agents` controls how much concurrent work the platform handles at once.

## 8. The Resume Protocol

The resume protocol is what makes Plurics workflows recoverable from crashes, intentional shutdowns, or platform restarts. A resumed workflow picks up exactly where the original left off, with no loss of completed work and no duplication of effort.

### 8.1 Snapshot Contents

The state needed to resume a workflow is captured in three files in the run directory:

**`node-states.json`**: the canonical DAG snapshot. Contains the full set of `NodeInstance` objects with their current states, attempt counters, scope identifiers, and signal references. Updated after every state transition (Section 4.3).

**`run-metadata.json`**: high-level run information. Contains the workflow name and version, the run ID, the start timestamp, the configuration, and aggregate metrics. Updated less frequently — at start, at workflow completion, and on significant milestones.

**`pool-state.json`**: the evolutionary pool state, if the workflow uses one. Contains the candidate population with fitness, lineage, and status. Updated whenever the pool changes. → See `docs/design/evolutionary-pool.md` (to be written) for the format.

The signals in `signals/` and the values in `values/` are also part of the recoverable state, but they are not snapshots in the same sense — they are append-only artifacts that survive any crash by virtue of being on disk already.

### 8.2 Resume Initiation

A workflow run can be resumed if:

1. The run directory exists at `{workspace}/.plurics/runs/{runId}/`
2. `node-states.json` is present and parses as valid JSON
3. The workflow YAML referenced by `run-metadata.json` exists and parses successfully
4. The workflow YAML version matches the one recorded in `run-metadata.json` (or is compatible with it)

If all four conditions hold, the user (or the UI's resume button) can trigger a resume. If any fail, the run is marked as unrecoverable and resume is not offered.

### 8.3 Resume Steps

When a resume is triggered, the engine performs the following sequence:

**Step 1: Load run metadata.** Parse `run-metadata.json` to recover the run identity, workflow reference, and configuration. Set up the engine state for the run.

**Step 2: Parse the workflow YAML.** Load and parse the workflow YAML referenced by the metadata. This goes through the same parser and validator as a fresh start (Section 2.3). Errors here mean the workflow definition has changed in incompatible ways since the run started, and the resume fails.

**Step 3: Reconstruct the DAG.** Read `node-states.json` and reconstruct the in-memory DAG. Each `NodeInstance` from the snapshot becomes a live `NodeInstance` in the engine. Dynamically created scoped instances are reconstructed alongside the static ones; the snapshot does not distinguish, so this happens automatically.

**Step 4: Check for destructive changes.** Read the `resolved_tools` section of `run-metadata.json` and compare each pinned tool version with the current state of the registry. For any tool whose newer version has `change_type: destructive`, apply the workflow's `version_policy.on_destructive_change` policy automatically. The policy is read from `workflow.yaml.snapshot` in the run directory. This check is specified in `docs/design/tool-registry.md` §8.4.5.

**Step 5: Reconcile with signals.** Walk the `signals/` directory and process any signal files that are not yet reflected in the DAG state. This catches the case where a signal was written just before the crash but was not yet incorporated into the snapshot. The engine treats these signals as if they had just been emitted: they go through validation, plugin handling, and state transition.

**Step 6: Demote orphaned running nodes.** Any node whose state in the snapshot is `running` or `spawning` is in an inconsistent state — the engine cannot know whether the runtime actually completed before the crash, so it must assume the work is lost. These nodes are demoted to `ready` and will be re-dispatched, with the attempt counter unchanged. (The retry counter increments only on explicit failures, not on resume-induced re-dispatches.)

**Step 7: Restore the pool state.** If the workflow uses an evolutionary pool, parse `pool-state.json` and restore the pool. The plugin's `onWorkflowResume` hook (if implemented) is called at this point with the resume context.

**Step 8: Resume scheduling.** Trigger the scheduler sweep. From this point forward, the resumed workflow behaves identically to a workflow that has been running continuously since its start. The scheduler picks up `ready` nodes, dispatches them, processes signals, and progresses through the state machine.

The entire resume sequence completes in seconds for typical workflows. The slowest step is usually Step 5 (reconciling with signals) when there are many signal files to scan, but even with thousands of signals this is fast on local SSD.

### 8.4 Idempotency of Resume

The resume protocol is idempotent: resuming a workflow that is already in a stable state produces the same state. This means the user can attempt to resume a workflow that has already completed, and the engine will simply load the snapshot, see that everything is in `completed` state, and report the workflow as already done.

This idempotency is also important for double-resume scenarios. If a user clicks "Resume" and the platform crashes again before making any progress, the second resume attempt sees the same state as the first and does the same thing. There is no risk of "partial resume" leaving the workflow in a worse state than it started.

### 8.5 Limitations of Resume

The resume protocol cannot recover from every situation:

- **Workflow YAML changes that affect the DAG structure** are not recoverable. If the user adds, removes, or renames nodes between the crash and the resume, the snapshot's DAG no longer matches the YAML and the resume fails. The protection is the workflow version field — bumping the version is the user's signal that the change is intentional and the run should be considered abandoned.

- **External state changes** are not recoverable. If a tool wrote files outside the run directory, deleted database rows, or made API calls, the resume cannot undo or replay these effects. The run resumes from the platform's perspective, but external side effects from the pre-crash run remain in whatever state they were left.

- **In-memory plugin state** is not recoverable unless the plugin persists it explicitly. The `onWorkflowResume` hook gives the plugin a chance to restore state from disk, but if the plugin held important state in memory and never persisted it, that state is lost.

- **Tool subprocess state** is not recoverable. A long-running tool that was killed mid-execution loses any progress. The node is re-dispatched and starts the tool from scratch. Tools that need to be resumable must implement their own checkpointing internally.

These limitations are documented so that workflow authors understand when resume is reliable and when it is not. The protection against unrecoverable situations is, in most cases, the practice of designing workflows that are tolerant of restart: tool nodes that are cheap to re-run, plugin state that is persisted to disk, no external side effects without idempotency.

## 9. Error Handling

The workflow engine handles errors at multiple levels: errors from node runtimes, errors from plugin hooks, errors from signal validation, errors from the engine itself. This section consolidates the error handling model.

**Runtime errors from nodes.** Captured by the runtime layer (`docs/design/node-runtimes.md` Section 7) and reported back to the engine as a `failure` signal. The engine processes these as failed attempts and applies retry logic.

**Plugin errors.** Captured by the engine when a plugin hook throws. Behavior is per-hook as documented in `docs/design/plugin-sdk.md` Section 9. Most plugin errors result in the affected node failing or the workflow run failing entirely.

**Signal validation errors.** When a signal cannot be parsed or fails schema validation, the engine treats the source node as having failed with a `signal_validation_error`. The node enters retry logic if retries remain.

**Engine internal errors.** Bugs in the engine itself (state machine inconsistency, scheduler errors, snapshot write failures) are logged with full stack traces and either fail the workflow run with a clear error or, in extreme cases, crash the engine process. Crashes leave the snapshot intact, and the user can resume after the bug is fixed.

**Workflow YAML errors.** Caught at parse time before any nodes run. The workflow refuses to start with the parse errors reported.

The general principle is that errors should fail loudly and persist visibly. A confused user looking at a failed workflow should be able to find a clear error message in the run directory and the UI, with enough context to understand what went wrong.

## 10. Integration with Other Subsystems

This section is a cross-reference index to where the workflow engine touches other subsystems.

**Tool Registry** (`docs/design/tool-registry.md`): the engine uses the registry's discovery API at parse time (to validate `required_tools` and to resolve toolset declarations on reasoning nodes) and at scheduling time (to resolve specific tool versions). The engine is the consumer; the registry provides services. → After TR Phase 4-5 integration, the engine also calls the type checker before scheduling, and rejects workflows with type errors.

**Node Runtimes** (`docs/design/node-runtimes.md`): the engine dispatches `ready` nodes to the appropriate runtime based on `kind`. Tool nodes go to the tool node runtime (Section 3 of node-runtimes); reasoning nodes go to the reasoning node runtime (Section 4). The engine does not see the internals of either runtime — it sees only the dispatch handle, the eventual signal, and the metrics.

**Plugin SDK** (`docs/design/plugin-sdk.md`): the engine invokes plugin hooks at the points documented in plugin-sdk Sections 3-7. The engine treats hook results according to the plugin contract: signal decisions guide state transitions, purpose enrichments are passed to runtimes, tool proposals are routed to the registry.

**Type System** (`docs/design/type-system.md`): the engine calls the type checker after parsing a workflow YAML and before scheduling any nodes. Type errors from the checker are reported as parse errors. After TR Phase 4 is complete, this integration is active; before then, the engine skips type checking.

**Persistence** (`docs/design/persistence.md`, to be written): the engine writes snapshots, run metadata, and signal files to the run directory. The persistence layer specifies the layout and format.

**UI / Observability** (`docs/design/ui.md`, to be written): the engine emits events on a WebSocket whenever state transitions occur, when signals are received, and when scheduling decisions are made. The UI consumes these events to update its visualization.

**Evolutionary Pool** (`docs/design/evolutionary-pool.md`, to be written): the engine integrates with the pool through plugin hooks (`onEvaluationResult`, `onEvolutionaryContext`) and through the persistence layer (loading and saving `pool-state.json`). The pool is otherwise external to the engine.

---

## 11. Implementation Status

**Implemented (current codebase):** The full workflow engine described in Sections 2-9 is implemented and running. Workflows like `research-swarm` and `theorem-prover-mini` exercise it end-to-end. The fan-out mechanism, the resume protocol, and the signal protocol are all in production.

**Pending TR Phase 4 integration:** The type checker invocation between parsing and scheduling. This requires the type checker itself to be implemented (TR Phase 4) and then a small change to the engine's parse path to call the checker and handle its results. Estimated effort: ~1 day for the engine-side change, after the type checker is available.

**Pending TR Phase 5 integration:** The new YAML fields (`kind`, `tool`, `toolset` with category/name/glob entries, `required_tools`) and the dispatch routing based on `kind`. The current parser does not require `kind` (it infers from backend), and the dispatch routing uses the legacy backend taxonomy. Updating both is straightforward but touches the YAML parser, the node definition types, and the dispatcher. Estimated effort: ~3-4 days as part of TR Phase 5.

**Verification needed:** The reference signatures and module names in this document (e.g., `ParsedWorkflow`, `NodeInstance`, the use of `chokidar` for file watching) are inferred from common patterns and from previous discussions, not from direct inspection of the current codebase. They should be verified against `packages/server/` (or wherever the engine implementation lives) and corrected if drift is found.

---

*This document is the authoritative reference for the Plurics Workflow Engine. The engine is a stable component — most of what is described here will not change as Plurics evolves. Updates to this document will mainly track the integration points with other subsystems as those subsystems mature.*