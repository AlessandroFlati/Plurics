# Plurics — High-Level Design

**Version:** 0.1 (draft)
**Status:** Living document — target architecture with implementation status markers
**Audience:** Contributors, integrators, users evaluating Plurics for their domain
**Scope:** Architectural reference at the system level. Specific subsystems have dedicated design documents linked from Section 13.

---

## 1. Purpose and Scope

Plurics is a declarative workflow engine for running autonomous agentic pipelines that combine LLM reasoning, deterministic computation, and persistent knowledge accumulation. It is designed for domains where work can be expressed as a directed acyclic graph of decisions interleaved with computations — scientific research, automated analysis, formal verification, structured exploration. It is not designed for conversational AI, real-time assistants, or streaming pipelines.

The central design commitment of Plurics is that LLMs should reason about problems and compose validated tools to solve them, while code should perform the computations. This commitment is articulated in the Plurics Manifesto (`docs/manifesto.md`); this document takes the manifesto as given and translates it into architecture. Where the manifesto says *why*, this document says *what* and *how* at a structural level.

A reader of this document alone should gain enough architectural understanding to participate in technical discussions about Plurics, to orient themselves in the codebase, and to know where to look for the details of any specific component. Full implementation details live in the subsystem design documents indexed in Section 13.

Plurics is implemented as a Node.js monorepo with TypeScript throughout, a React frontend, and SQLite persistence. It runs locally on a developer's machine as the default deployment; it does not depend on cloud services, though it can use them as backends when workflows choose to.

---

## 2. System Overview

At the highest level, Plurics consists of five major components communicating through well-defined interfaces.

```
┌────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY UI                         │
│              (React frontend, localhost:11000)              │
│   DAG visualizer · Findings panel · Workflow controls       │
│   Tool registry browser · Run history · Resumable runs      │
└─────────────────────────┬──────────────────────────────────┘
                          │ WebSocket + REST
                          │
┌─────────────────────────▼──────────────────────────────────┐
│                    WORKFLOW ENGINE                          │
│           (Node.js server, localhost:11001)                 │
│                                                             │
│   DAG executor · State machine · Signal protocol            │
│   Snapshot/resume · Plugin system · Evolutionary pool       │
└──────┬──────────────────────┬──────────────────┬───────────┘
       │                      │                   │
       │                      │                   │
       ▼                      ▼                   ▼
┌──────────────┐      ┌──────────────┐    ┌──────────────┐
│ NODE RUNTIMES│      │ TOOL REGISTRY│    │  PERSISTENCE │
│              │      │              │    │              │
│  Reasoning   │◄────►│   Tools      │    │  SQLite DB   │
│  nodes (LLM) │      │   Schemas    │    │  Run dirs    │
│              │      │   Converters │    │  Registry    │
│  Tool nodes  │◄────►│   Versioning │    │  dir         │
│  (direct)    │      │              │    │              │
└──────────────┘      └──────────────┘    └──────────────┘
```

The **Observability UI** is the primary interface. It is not a terminal multiplexer but a dashboard: users start, monitor, pause, resume, and inspect workflows. Running agents are not meant to be steered interactively; their progress is observed.

The **Workflow Engine** is the heart of Plurics. It loads workflow YAML files, parses them into executable DAGs, schedules nodes according to dependencies and concurrency limits, dispatches work to node runtimes, collects signals, persists state, and exposes progress to the UI via WebSocket. It knows nothing about specific domains.

The **Node Runtimes** are the two execution modes for nodes in a workflow: reasoning nodes (LLMs with toolsets) and tool nodes (direct tool invocations). Both are thin wrappers over lower-level mechanics — the actual LLM APIs, the child process spawning, the tool registry invocation.

The **Tool Registry** is the long-term memory of capabilities. It holds validated, typed, sandboxed primitives that reasoning nodes can compose and tool nodes can invoke directly. The registry persists across workflow runs and grows over time as workflows contribute tools.

The **Persistence** layer stores three categories of things: workflow run state (for resume and traceability), workflow metadata (in SQLite), and the tool registry itself (on disk as a structured directory with metadata in SQLite). All persistence is local to the user's machine by default.

*Implementation status: Workflow Engine, Node Runtimes, Persistence, and Observability UI are implemented in their current form (backed by the 3-backend AgentBackend abstraction and the CAAM codebase). The Tool Registry is not yet built and is the next major subsystem to implement.*

---

## 3. The Three-Layer Separation

Plurics enforces a strict separation between three conceptual layers, each with different responsibilities and different rates of change. This is the most important invariant of the system.

```
┌───────────────────────────────────────────────────────────┐
│ LAYER 3 — Workflow Instances                              │
│                                                           │
│   Domain-specific pipelines defined as YAML + plugin +    │
│   presets. Each workflow is a self-contained directory.   │
│   Examples: research-swarm, math-discovery, theorem-      │
│   prover-mini, sequence-explorer.                         │
└─────────────────────┬─────────────────────────────────────┘
                      │ implements
                      ▼
┌───────────────────────────────────────────────────────────┐
│ LAYER 2 — SDK                                             │
│                                                           │
│   Domain-agnostic primitives that workflow instances use: │
│   WorkflowPlugin interface, AgentBackend interface,       │
│   EvolutionaryPool, SignalFile schema, ToolBinding types. │
└─────────────────────┬─────────────────────────────────────┘
                      │ uses
                      ▼
┌───────────────────────────────────────────────────────────┐
│ LAYER 1 — Platform                                        │
│                                                           │
│   The engine itself. DAG executor, signal watcher, YAML   │
│   parser, agent registry, tool registry, persistence,     │
│   WebSocket transport, frontend. Knows nothing about any  │
│   specific workflow or domain.                            │
└───────────────────────────────────────────────────────────┘
```

**Layer 1 — Platform.** The engine. It owns the DAG state machine, the signal protocol, the file watching, the YAML parsing, the agent registry, the tool registry, the persistence layer, and the frontend. Layer 1 code contains no references to any specific workflow or domain. The same Layer 1 runs `research-swarm` and `math-discovery` and any workflow that has not yet been written. Changes to Layer 1 must work for all workflows simultaneously.

**Layer 2 — SDK.** The contract between the platform and workflow instances. Layer 2 defines the interfaces and helper types that workflows use to express their domain logic: the `WorkflowPlugin` interface with its hooks, the `AgentBackend` interface for node runtimes, the `EvolutionaryPool` helper class for discovery workflows, the `SignalFile` schema, the `ToolBinding` type that declares which registry tools a workflow uses. Layer 2 is domain-agnostic but workflow-aware — it knows what *kinds of things* a workflow can do, without knowing what any specific workflow does.

**Layer 3 — Workflow Instances.** Self-contained directories, one per workflow, containing a `workflow.yaml` that defines the DAG, a `plugin.ts` that implements the `WorkflowPlugin` interface for domain-specific behavior, a `presets/` directory with the markdown templates for each reasoning node's purpose, and optionally a `schemas/` directory with domain types and helper resources (e.g., a Lean project template). Each workflow instance is a Layer 3 artifact; creating a new one is a matter of writing a directory, not modifying the platform.

**The separation invariant.** A change to Layer 3 (a new workflow, a modified preset, a different plugin) must never require changes to Layer 1. A change to Layer 1 must work correctly for all existing Layer 3 workflows without modification. Layer 2 is the interface that makes this possible: as long as Layer 2 is stable, Layer 1 and Layer 3 evolve independently. When Layer 2 must change, it changes as a versioned contract, and both sides adapt together.

This separation is what makes Plurics a platform rather than a framework for a specific use case. It is the architectural property that lets a user build a workflow for a domain Plurics was never designed for and have it work.

*Implementation status: the three-layer separation is fully implemented and enforced by the current codebase.*

---

## 4. The Tool Registry

The Tool Registry is the persistent store of validated computational primitives that Plurics workflows can compose and invoke. It is the component that distinguishes Plurics from workflow engines that treat tools as ephemeral artifacts of a single run.

A **tool** is a unit of deterministic computation with typed input and output ports, a sandboxed implementation, a set of tests, and metadata. Tools are invoked by reasoning nodes (LLMs call them as part of their composition of an answer) or by tool nodes (direct invocations in the workflow DAG). Tools are immutable once registered; a modified tool becomes a new version, and the old version remains available for workflows that depended on it.

A **schema** is a named type used to describe the shape of data flowing between tools. Schemas cover primitive types, structured types (like `OhlcFrame` or `FeaturesFrame`), and composite types with generics. The schema registry is what enables static type checking of tool compositions.

A **converter** is a special kind of tool that transforms one schema into another when they represent equivalent information in different forms (e.g., a time series as a list of records versus as a DataFrame). Converters are registered as first-class entities so that the composition type checker can automatically insert them when needed.

The registry lives on disk at `~/.plurics/registry/` with a structured layout: `tools/{name}/{version}/` for each tool's implementation, schema, tests, and metadata; `schemas/` for type definitions; `converters/` for converter tools. An SQLite database at `~/.plurics/registry/registry.db` stores indexed metadata for fast lookup, search, and dependency tracking.

The registry is bootstrapped with a set of **seed tools** covering the standard data science toolkit: descriptive statistics, hypothesis testing, regression, decomposition (PCA, ICA), clustering, time series analysis, optimization, symbolic math. These seeds are derived from thin wrappers over mature Python libraries (pandas, scipy, sklearn, sympy) exposed as typed tools. A fresh Plurics installation has 50-100 seed tools immediately available; the registry grows from there as users build domain-specific tools.

The relationship between the registry and workflow instances is governed by explicit declarations. A workflow's YAML specifies which tools (by name, version, or category) it needs; the platform verifies that those tools exist and makes them available to the workflow's nodes. Reasoning nodes receive the declared tools as a toolset in their LLM context; tool nodes invoke specific tools as their entire function.

*Implementation status: not yet built. The Tool Registry is the primary next subsystem to implement. → See `docs/design/tool-registry.md` for the full specification (to be written).*

---

## 5. Nodes and Backends

The unit of work in a Plurics workflow is the **node**. A workflow DAG is a graph of nodes connected by dependencies. Nodes come in two categories that differ in how they perform work, and this distinction replaces the earlier three-way split between `claude-code`, `process`, and `local-llm` backends that was inherited from the CAAM origin of the project.

A **reasoning node** is a workflow node that delegates its work to an LLM. The LLM is given a purpose (a markdown prompt derived from the node's preset and the plugin's purpose enrichment), a context (prior findings, run history, scope-specific data), and a toolset drawn from the tool registry. The LLM is expected to think about the problem, compose tools to solve it, invoke those tools, interpret the results, and produce a structured signal as output. The reasoning node is where both judgment and composition happen; it is where the LLM's strengths are applied.

A **tool node** is a workflow node that invokes a single tool from the registry directly, with parameters derived from upstream dependencies. No LLM is involved. Tool nodes are used when the workflow author has determined that no decision is needed at that point — only computation. Examples: the OHLC fetcher at the start of a financial pipeline, the Lean compiler at the end of a theorem proving pipeline, a Python script that rebuilds an index of artifacts.

The distinction is *architectural*, not just semantic. A reasoning node and a tool node have different runtimes, different failure modes, different cost profiles, and different observability characteristics. A tool node has a deterministic cost and a predictable execution time; a reasoning node has a variable cost dominated by LLM tokens and latency dominated by model inference time. The workflow engine handles both uniformly at the DAG level but dispatches them to different runtime paths.

**Backends** are now a lower-level concept: they describe *where* a reasoning node's LLM runs. The Plurics platform supports multiple backends — Claude API via Anthropic SDK, local models via Ollama or vLLM with OpenAI-compatible APIs, and (for legacy compatibility with the CAAM origin) Claude Code via node-pty. A reasoning node declares its backend in its YAML definition, and the workflow engine dispatches accordingly. Tool nodes do not have backends in the same sense; they have executors, which are the mechanisms for running a registered tool (a Python sandbox, a subprocess, a native call).

The abstraction that unifies both categories is the `AgentBackend` interface in Layer 2. Each concrete implementation (`ClaudeApiBackend`, `OllamaBackend`, `VllmBackend`, `ClaudeCodeBackend`, `ProcessBackend`) conforms to this interface, and the `AgentRegistry` dispatches based on the node's declared type. This is the same shape that exists in the current codebase, but its semantic interpretation shifts with the introduction of the Tool Registry: the primary role of the backend is now "how does this node invoke tools" rather than "how does this node produce output."

*Implementation status: the three current backends (claude-code, process, local-llm) are implemented. The transition to reasoning-node / tool-node as the primary concept requires (a) extending backends with tool-calling support where not present, and (b) reformulating the workflow preset style to favor composition over ad-hoc code. This is not a rewrite but an evolution. → See `docs/design/node-runtimes.md` for the full specification (to be written).*

---

## 6. The Workflow Engine

The workflow engine is the core of Plurics' Layer 1. It loads workflow definitions, executes them as DAGs, manages state, and makes progress observable.

A workflow is defined by a `workflow.yaml` file that declares nodes, dependencies between them, configuration values, and optional plugin references. The YAML is parsed into an in-memory DAG with cycle detection. The engine validates the DAG, resolves presets, verifies that declared tools exist in the registry, and produces a ready-to-execute node graph.

Execution proceeds through a state machine with states `pending`, `ready`, `spawning`, `running`, `validating`, `completed`, `retrying`, `failed`, and `skipped`. Transitions are governed by dependency satisfaction, concurrency limits (both scope-level and global), and retry logic with configurable backoff. A node moves from `ready` to `spawning` when its dependencies are satisfied and concurrency slots are available, from `running` to `validating` when it emits a completion signal, and from `validating` to `completed` when the signal passes schema and integrity checks.

The engine supports **fan-out**: a node can emit a signal with a `foreach` directive, causing the downstream portion of the DAG to be dynamically instantiated as parallel scoped sub-graphs. Each scoped sub-graph receives a scope identifier and operates on its own copy of the downstream nodes. This is how a workflow like `math-discovery` handles multiple simultaneous conjectures: the selector emits a fan-out with a list of conjecture IDs, and the downstream nodes (formalizer, strategist, prover, lean_check, counterexample, abstractor) are instantiated once per conjecture, subject to concurrency limits.

The engine supports **resumable runs**. Every state transition writes a snapshot of the full node graph (including dynamically created scoped nodes) to `node-states.json` in the run directory. If the platform crashes or is intentionally stopped, the run can be resumed from the snapshot: the engine rebuilds the graph, recovers signals from disk, demotes orphaned running nodes back to ready, and re-schedules. The pool state is similarly snapshotted for workflows that use the evolutionary pool.

Signals are the mechanism by which nodes communicate completion to the engine. A signal is a JSON file written atomically to the run's `signals/` directory, containing the node's name, scope (if applicable), status, outputs, metrics, and a decision field that plugins interpret. The engine validates signals against a schema, normalizes common output variations (strips path prefixes, coerces field aliases), and routes based on the decision field and the YAML branch rules. Signals are append-only and self-contained: once written, a signal is never modified.

*Implementation status: the workflow engine is implemented and running. Current workflows (research-swarm, theorem-prover-mini) exercise most of its features end-to-end. Enhancements needed for tool registry integration: (a) YAML syntax for declaring tool dependencies, (b) plugin hooks for tool invocation, (c) type checking of tool compositions at parse time. → See `docs/design/workflow-engine.md` for the full specification (to be written).*

---

## 7. The Plugin System

Workflow instances extend the platform through a plugin system defined in Layer 2. Each workflow optionally provides a TypeScript file `plugin.ts` that implements the `WorkflowPlugin` interface. The platform dynamically imports the plugin at workflow start and invokes it at well-defined hook points during execution.

Plugins are the mechanism by which domain-specific behavior enters the system without polluting Layer 1. A plugin can enrich purposes with domain context (the `math-discovery` plugin injects the Lean project state and the conjecture lineage), interpret signal decisions with domain semantics (the `research-swarm` plugin routes falsified hypotheses back to the hypothesis generator with rejection reasons), maintain domain-specific state across nodes (the `theorem-prover-mini` plugin manages the incremental Lean project), and propose tool additions to the registry (the to-be-built `sequence-explorer` plugin can register new sequence-analysis tools discovered during a run).

The current hook set includes lifecycle hooks (`onWorkflowStart`, `onWorkflowResume`, `onWorkflowComplete`), signal handling hooks (`onSignalReceived`, `onEvaluationResult`), scheduling hooks (`onEvaluateReadiness`, `onResolveRouting`), and purpose generation hooks (`onPurposeGenerate`, `onEvolutionaryContext`). With the introduction of the Tool Registry, additional hooks are needed to integrate tool registration and regression into the workflow lifecycle: a `declareTools` hook for declaring which tools a workflow needs, an `onToolProposal` hook for validating and registering new tools proposed by reasoning nodes, and an `onToolRegression` hook for handling the case where a registry change breaks a previously-working tool composition.

The plugin system is deliberately opt-in. A workflow that does not need domain-specific behavior can omit the plugin entirely and the engine uses sensible defaults. This keeps simple workflows simple while allowing complex workflows to fully exploit the platform.

*Implementation status: the plugin system is implemented with 9 hooks. The three new hooks for tool registry integration (`declareTools`, `onToolProposal`, `onToolRegression`) will be added alongside the Tool Registry. → See `docs/design/plugin-sdk.md` for the full specification (to be written).*

---

## 8. The Evolutionary Pool

The Evolutionary Pool is an optional Layer 2 helper for workflows that perform discovery through iterative generation and selection. It is not a core component of the engine — workflows that do not do discovery never instantiate a pool.

A pool holds a population of candidates (conjectures, hypotheses, designs, solutions) each with a fitness score, a generation number, a lineage of parent candidates, and a status. Candidates are added by reasoning nodes (typically a generator) and their fitness is updated by evaluator nodes (typically a verifier or critic). The pool supports selection strategies for producing input to subsequent generation rounds: tournament selection, roulette wheel, top-k, random. A generator at round N consumes pool state at round N-1 to inform its next batch of candidates.

The pool is persisted to `pool-state.json` in the run directory and restored on resume. Plugins interact with the pool through two hooks: `onEvaluationResult` (called when an evaluator emits a signal, to update fitness) and `onEvolutionaryContext` (called before a generator runs, to compose the context from positive examples, negative examples, confirmed findings, and lineage information).

The pool is what enables Plurics to support workflows that genuinely search rather than merely compute. A workflow that uses the pool is explicitly structured as a feedback loop: generate, evaluate, update, select, repeat. This is different from a workflow that simply runs a linear pipeline to completion.

*Implementation status: the Evolutionary Pool is implemented but not yet exercised by a full workflow. The `math-discovery` workflow will be its first real consumer. → See `docs/design/evolutionary-pool.md` for the full specification (to be written).*

---

## 9. Persistence and Traceability

Plurics persists three categories of state, each with its own policy and location.

**Workflow runs** are stored as directories under `{workspace}/.plurics/runs/{runId}/`. Each run directory is a complete, self-contained record: the `purposes/` subdirectory holds every purpose prompt generated for every agent invocation (including retries); the `logs/` subdirectory holds captured stdout and stderr; the `signals/` subdirectory holds the signal files the engine received; the `findings/` subdirectory holds domain-specific finding documents; `node-states.json` holds the DAG snapshot for resume; `run-metadata.json` holds timing, config, and summary information; `pool-state.json` holds the evolutionary pool snapshot if used. A run directory is sufficient on its own to reconstruct what happened during the run, diagnose problems after the fact, or resume execution from a crash.

**Platform state** is stored in SQLite at `~/.plurics/plurics.db`. This database holds workspaces (saved directories where Plurics has been used), agent presets (reusable purpose templates indexed across projects), workflow run metadata (history, status, links to run directories), and workflow events (state transition log for audit). SQLite is used because Plurics runs locally and does not need distributed state; the database is small, fast, and needs no administration.

**The Tool Registry** is stored as a structured directory at `~/.plurics/registry/` with `tools/`, `schemas/`, `converters/`, and `tests/` subdirectories. Metadata is indexed in a separate SQLite database at `~/.plurics/registry/registry.db`. The registry is versioned: modifying a tool creates a new version, and old versions remain available until explicitly deleted.

**The invariant of traceability.** Every run is a complete object: if the platform disappeared tomorrow, the run directories would remain intelligible and reproducible by a human. Nothing important about a run lives only in memory or only in the database. The database holds indexes and metadata; the filesystem holds the substance. This invariant is what makes Plurics operable as a research tool: results are not locked in the platform.

*Implementation status: run persistence and SQLite schema are implemented. Tool Registry persistence is not yet built. → See `docs/design/persistence.md` for the full specification (to be written).*

---

## 10. Observability and UI

The Plurics frontend is an observability dashboard. It is not a terminal multiplexer, not a chat interface, and not an IDE. Its purpose is to let a user start a workflow, watch it progress, inspect what is happening, intervene when necessary, and review results after completion.

The primary UI elements are the **DAG visualizer**, which shows the workflow graph as a left-to-right SVG with state-colored nodes and pan/zoom controls; the **findings panel**, which displays real-time finding reports as the workflow produces them, with verdict badges and collapsible content; the **workflow controls**, which allow starting a new run, pausing, resuming, and stopping; the **resumable runs list**, which surfaces interrupted runs that can be continued from their snapshot; and the **tool registry browser** (not yet built), which will allow inspection and search of the installed registry.

A secondary UI element is the **terminal grid**, a residual from the CAAM origin of the project. It shows live terminal output for `claude-code` backend nodes. It is retained for manual debugging and for workflows that explicitly use interactive Claude Code sessions, but it is not the primary way to observe a workflow.

All agent I/O is captured server-side in run directories regardless of whether a terminal grid is active. The UI is stateless with respect to running workflows: closing and reopening the browser does not affect workflow execution, and opening a new browser connection shows the current state of everything.

The frontend communicates with the server over a single WebSocket connection multiplexing workflow events, terminal I/O, and tool registry updates. REST endpoints expose workflow history, run details, findings, and registry contents for read access.

*Implementation status: the DAG visualizer, findings panel, workflow controls, resumable runs list, and terminal grid are implemented. The tool registry browser is not yet built. → See `docs/design/ui.md` for the full specification (to be written).*

---

## 11. Design Invariants

The following invariants must hold across any future change to Plurics. They are the constraints that define what the system *is*, as opposed to what it currently happens to do. A proposed change that violates an invariant should be rejected or should explicitly re-examine and potentially revise the invariant itself.

1. **Layer 1 never knows the domain.** The DAG executor, signal watcher, YAML parser, tool registry, and frontend must operate identically for research hypotheses, mathematical theorems, sequence analysis, financial time series, or any domain that has not yet been imagined. Domain logic lives exclusively in Layer 3 plugins and presets.

2. **Signals are append-only and self-contained.** Once written, a signal file is never modified. The `signal_id` is a unique deduplication key. Plugins interpret decisions but never mutate signals. A signal is meaningful in isolation: a reader can understand what happened from the signal alone, without consulting other state.

3. **Tools in the registry are immutable.** Modifying a tool creates a new version. Workflows that depend on a specific version continue to work against that version regardless of future changes. Version resolution is explicit in workflow YAML or governed by a pinning policy.

4. **Runs are complete objects.** Everything important about a workflow execution is captured in the run directory. The database holds indexes and metadata; the filesystem holds substance. A run can be understood, diagnosed, or resumed from the run directory alone.

5. **Tool invocations are typed.** Reasoning nodes and tool nodes alike invoke tools through a typed interface. Type checking of compositions happens at workflow parse time where statically possible, and at tool dispatch time for dynamically chosen compositions. Tools cannot be invoked with wrongly-typed inputs without an explicit type error.

6. **The platform serializes what the plugin allows.** Concurrency limits (`max_parallel_scopes`, `max_concurrent_agents`) are enforced by the Layer 1 scheduler. Plugins can further constrain via `onEvaluateReadiness`. The platform never exceeds declared limits, but it also never enforces limits a plugin did not declare.

7. **Agents are stateless between invocations.** Each retry spawns a fresh agent with a fresh purpose. State is transmitted via filesystem (shared workspace, signal files, handoff documents) or via the tool registry (for persistent capabilities). The platform does not attempt to preserve LLM conversation state across invocations; this would break the separation between reasoning (which is ephemeral) and persistent knowledge (which lives in tools and findings).

8. **One signal per completion.** The platform expects exactly one signal per scheduled node invocation. Multiple signals from the same invocation are undefined behavior. This keeps the signal protocol simple and the state machine predictable.

These invariants are non-negotiable in ordinary development. They may be revised in a major version change, but never silently.

---

## 12. Open Questions

A design document that claims to have answered every question is either finished or dishonest. Plurics is not finished. The following questions are known to be open at the time of this writing and will be addressed in future design iterations.

**Tool versioning propagation.** When a new version of a tool is registered, how does it propagate to workflows currently in execution? Options: (a) running workflows continue with their original version; new runs pick up the new version; (b) running workflows pick up the new version at the next node that invokes it; (c) administrator chooses policy per registry. The current inclination is (a), but this has not been tested in practice.

**Cross-language tool support.** The initial Tool Registry will support Python tools (since the seed library is built on pandas, scipy, sklearn, sympy). Supporting TypeScript tools natively is feasible since the platform is TypeScript. Supporting arbitrary binaries or scripts in other languages is possible but raises sandboxing complexity. Open question: do we commit to a single-language registry, a dual-language (Python + TypeScript) registry, or a polyglot registry with per-language sandboxes?

**Extensible type system.** The type system for tool schemas will initially support a fixed set of primitives and structured types. Workflows in domains with specialized types (e.g., Lean expressions, custom DataFrames) will want to register new types. Open question: how do workflow-contributed types interact with the core type system? Are they first-class or contained in a namespace?

**Registry sharing across machines.** The initial registry is local to a user's machine. Teams or researchers who want to share a registry face the question of how. Options: file-based sync (git-style), a hosted registry service, export/import tarballs. This is deferred until there is demonstrated demand, but the design should not preclude any option.

**System tools versus workflow tools.** Some tools are universal (descriptive stats, hypothesis testing) and should be available to every workflow without explicit declaration. Others are domain-specific and should be opt-in. The registry needs a concept of "always-available" versus "opt-in" tools, and the mechanism for distinguishing them is not yet designed.

**Plugin sandboxing.** Workflow plugins are TypeScript code loaded dynamically by the platform. A malicious or buggy plugin can compromise the platform process. Open question: do plugins need sandboxing? If yes, what kind (worker threads, vm module, separate processes)? The current assumption is that plugins are trusted because they are authored by the user running Plurics, but this will not hold in a world where workflows are shared.

**Multi-user and concurrent workflow execution.** Plurics is single-user by design, but a single user can currently only run one workflow at a time in the UI. Running multiple workflows concurrently on the same Plurics instance is a natural extension and requires careful thought about registry locking, UI routing, and SQLite concurrency.

These questions are not blockers. They are items for future design cycles, and most will be answered by the experience of building and using Plurics on real workflows over time.

---

## 13. Document Map

This document is the root of Plurics' architectural documentation. The following subsystem design documents are children of this one, each covering a specific component in full detail.

| Document | Covers | Status |
|---|---|---|
| `docs/manifesto.md` | The philosophical position and the "why" of Plurics | **Complete** |
| `docs/design/overview.md` | **This document.** High-level architecture and component map | **Draft** |
| `docs/design/tool-registry.md` | Tool Registry: schema, storage, versioning, sandboxing, API | **To be written** |
| `docs/design/node-runtimes.md` | Reasoning nodes, tool nodes, backend implementations, tool dispatch | **To be written** |
| `docs/design/workflow-engine.md` | DAG executor, state machine, signal protocol, fan-out, resume | **To be written** |
| `docs/design/plugin-sdk.md` | WorkflowPlugin interface, hook semantics, plugin loading | **To be written** |
| `docs/design/evolutionary-pool.md` | Pool data structures, selection strategies, persistence | **To be written** |
| `docs/design/persistence.md` | Run directories, SQLite schema, filesystem layout, migrations | **To be written** |
| `docs/design/ui.md` | Frontend architecture, components, WebSocket protocol, REST API | **To be written** |
| `docs/design/type-system.md` | Schemas, converters, compositions, type checking | **To be written** |
| `docs/design/seed-tools.md` | Catalog of seed tools shipped with Plurics, their schemas | **To be written** |
| `docs/guides/writing-workflows.md` | Tutorial: how to write a workflow instance from scratch | **To be written** |
| `docs/guides/building-tools.md` | Tutorial: how to build and register a new tool | **To be written** |

Each subsystem document is expected to be self-contained for its scope: a reader interested only in the Tool Registry should be able to read `docs/design/tool-registry.md` and understand the full design of that component, with references back to this overview document for context on how it fits into the larger system.

The subsystem documents will be written in the order dictated by implementation priority. The current priority order is: tool registry first (because it is the keystone of the new architecture), followed by node runtimes (to update the existing backend abstraction for tool calling), followed by the updated plugin SDK (to add the tool-related hooks), followed by the seed tools catalog (to populate the registry with a useful starting set). The remaining documents describe existing components and will be written as time allows or as specific changes are proposed.

---

*This document is a living artifact. It will be updated as the architecture evolves, with version history visible in git. Changes to design invariants require discussion and explicit acknowledgment of the change in commit messages.*