# Plurics Evolutionary Pool — Design Document

**Version:** 0.1 (draft)
**Status:** Hybrid — implementation exists but is under-exercised; this document is mostly prescriptive of the target design that math-discovery and similar workflows will require
**Scope:** The data structures, selection strategies, lineage tracking, persistence, and plugin integration of the evolutionary pool
**Parent document:** `docs/design/overview.md` Section 8
**Related documents:** `docs/design/workflow-engine.md`, `docs/design/plugin-sdk.md`, `docs/design/persistence.md` (to be written)

---

## 1. Introduction and Scope

The Evolutionary Pool is an optional Layer 2 helper for workflows that perform discovery through iterative generation and selection. It is the component that makes Plurics suitable for workflows whose structure is "generate candidates, evaluate them, select the best, generate more from those, repeat" — the pattern that characterizes scientific discovery, mathematical conjecturing, hypothesis search, and design exploration.

The pool is *not* a core component of the workflow engine. Workflows that do not perform discovery never instantiate a pool, and the engine knows nothing about pools beyond the fact that some workflows use them. This separation is important: it keeps the engine domain-agnostic and lets the pool evolve independently as discovery workflows reveal new requirements.

This document specifies the pool in detail. It covers the candidate data model, the population structure, the selection strategies, the lineage tracking, the persistence and resume mechanism, and the integration with plugin hooks. It also enumerates the gaps between the current implementation and the target design described here, so that future work has a clear map of what needs to evolve.

The document is written in a hybrid descriptive/prescriptive mode. The current implementation exists in the codebase but has not been seriously exercised by any workflow yet — `math-discovery` will be the first real consumer, and this document anticipates the requirements that will emerge from that exercise. Where the current implementation is known to differ from the target design, this is marked explicitly. The intent is that this document is the blueprint to which the implementation will be brought, not a description of the implementation as it stands today.

## 2. The Candidate Data Model

The fundamental unit of the evolutionary pool is the **candidate**. A candidate is whatever the workflow is trying to discover: a conjecture, a hypothesis, a strategy, a design, a solution. The pool itself is domain-agnostic — it does not care what a candidate represents — but it imposes a uniform structure so that selection, lineage, and persistence can be implemented once and reused across all discovery workflows.

### 2.1 Candidate Structure

A candidate has the following structure:

```typescript
// Reference signature, prescriptive — verify against current implementation
interface Candidate {
  /** Unique identifier within a single pool. */
  id: CandidateId;

  /** Domain-specific content. The workflow defines the structure. */
  payload: Record<string, unknown>;

  /** Numeric fitness score. Higher is better by convention. */
  fitness: number | null;

  /** The generation in which this candidate was created. */
  generation: number;

  /** Identifiers of the parent candidates this one was derived from. */
  parents: CandidateId[];

  /** Lifecycle status. */
  status: CandidateStatus;

  /** When this candidate was added to the pool. */
  createdAt: string; // ISO 8601 UTC

  /** When the fitness was last updated, if ever. */
  evaluatedAt: string | null;

  /** Domain-specific metadata. Free-form. */
  metadata: Record<string, unknown>;
}

type CandidateId = string;

type CandidateStatus =
  | 'pending_evaluation'  // Just added, fitness not yet known
  | 'active'              // Evaluated and in the active population
  | 'confirmed'           // Verified as a finding
  | 'falsified'           // Verified as a non-finding
  | 'pruned'              // Removed from active consideration
  | 'archived'            // Moved to long-term storage
  | 'invalidated';        // Retroactively invalidated by destructive change protocol
```

The fields divide into three categories: **identity and structure** (`id`, `payload`, `parents`, `generation`, timestamps), **evaluation state** (`fitness`, `status`, `evaluatedAt`), and **free-form extension** (`metadata`).

The `id` is a unique identifier within a single pool (which means within a single workflow run). The format is `cand-{generation}-{shortHash}`, where the hash is derived from the payload content for reproducibility — generating the same payload twice in the same generation produces the same id, which prevents accidental duplication.

The `payload` is the domain-specific content. The pool treats it as opaque: it does not parse it, validate it, or impose a schema. A `math-discovery` workflow's payload might look like:

```json
{
  "conjecture_text": "For all n >= 2, the sum of the first n primes is...",
  "formal_form": "∀ n : ℕ, n ≥ 2 → ...",
  "lean_target": "theorem prime_sum_bound : ...",
  "discovered_in_dataset": "eurusd_5m_2024"
}
```

while a `sequence-explorer` workflow's payload might look like:

```json
{
  "sequence": [1, 1, 2, 3, 5, 8, 13],
  "candidate_recurrence": "a(n) = a(n-1) + a(n-2)",
  "oeis_match": "A000045"
}
```

The pool sees both as identical from a structural standpoint: dictionaries with arbitrary keys. The workflow's plugin is responsible for interpreting payloads when needed.

The `fitness` is a single number. Higher fitness is better, by convention — the pool's selection strategies all assume this. Workflows whose natural metric is "lower is better" (e.g., loss values, error rates) should negate at the boundary so that the pool's internal representation is always "higher is better." Fitness can be `null` for candidates that have been added but not yet evaluated; selection strategies that rank by fitness ignore null-fitness candidates.

The `generation` is an integer that records when the candidate was created. The first generation of a workflow run is generation 0, the next is 1, and so on. Generation is set by the workflow plugin when adding a candidate, not inferred by the pool — the pool does not know when a "generation boundary" occurs because that is a workflow-level concept.

The `parents` field records which earlier candidates this one was derived from. For seed candidates (those that came from no prior pool members), this list is empty. For candidates generated from existing ones (the typical case in iterative discovery), the list contains the ids of the parents. The lineage information is what enables the workflow to "explain" how a finding was discovered by walking back through ancestors.

The `status` is the lifecycle state of the candidate. The seven values cover the typical journey: a candidate is added in `pending_evaluation`, becomes `active` when its fitness is computed, can transition to `confirmed` (if the workflow's verification step accepts it as a true finding), to `falsified` (if verification rejects it), to `pruned` (if it is removed from consideration to make room for newer candidates), or to `archived` (if it is preserved for record but no longer active). The state machine is documented in Section 4.

The `metadata` field is free-form and is the escape hatch for workflow-specific information that doesn't fit the standard fields. Examples: the LLM model that generated the candidate, the specific prompt used, references to external artifacts (proof files, datasets), notes from the verification step.

### 2.2 Candidate Identity and Equality

Two candidates are equal if they have the same id. The id is derived from the payload content via a hash, so two candidates with identical payloads in the same generation have the same id and the pool deduplicates them automatically: attempting to add a candidate whose id already exists returns the existing one without modification.

This deduplication is important for discovery workflows because LLM-based generators are not always diverse — a generator may produce the same conjecture twice in a row, and the pool should not store both as distinct entries. The hash-based id ensures that duplicates collapse silently.

The deduplication is *within* a generation. A candidate with the same payload in generation 5 and again in generation 7 produces two distinct ids (`cand-5-a3f2` and `cand-7-a3f2`) because the generation is part of the id. This is intentional: the same conjecture being rediscovered in a later generation is a meaningful event (the workflow converged on it again), and conflating it with the original would lose that information.

## 3. The Population Structure

A pool holds a population of candidates plus indexing structures that make selection and lineage queries fast. The population is the in-memory representation; persistence is covered in Section 6.

### 3.1 Pool Interface

The pool exposes the following public API to plugins:

```typescript
// Reference signature, prescriptive
interface EvolutionaryPool {
  /** Add a new candidate. Returns the candidate (with id assigned) or the
   *  existing one if a duplicate. */
  add(payload: Record<string, unknown>, parents: CandidateId[],
      generation: number, metadata?: Record<string, unknown>): Candidate;

  /** Update the fitness and optionally the status of a candidate. */
  updateFitness(id: CandidateId, fitness: number,
                status?: CandidateStatus): void;

  /** Mark a candidate's status without changing fitness. */
  updateStatus(id: CandidateId, status: CandidateStatus): void;

  /** Retrieve a candidate by id. */
  get(id: CandidateId): Candidate | null;

  /** List candidates matching filters. */
  list(filters?: PoolFilters): Candidate[];

  /** Select candidates using a named strategy. */
  select(strategy: SelectionStrategy, count: number,
         filters?: PoolFilters): Candidate[];

  /** Get the lineage (ancestors or descendants) of a candidate. */
  lineage(id: CandidateId, direction: 'ancestors' | 'descendants',
          maxDepth?: number): Candidate[];

  /** Statistics about the pool's current state. */
  stats(): PoolStats;
}

interface PoolFilters {
  status?: CandidateStatus | CandidateStatus[];
  generation?: number | { min?: number; max?: number };
  minFitness?: number;
  maxFitness?: number;
  hasParents?: boolean;
  metadataMatch?: Record<string, unknown>;
}

interface PoolStats {
  total: number;
  byStatus: Record<CandidateStatus, number>;
  byGeneration: Record<number, number>;
  meanFitness: number | null;
  maxFitness: number | null;
  minFitness: number | null;
  oldestActive: string | null;
  newestActive: string | null;
}
```

The API is intentionally narrow. Plugins do not directly mutate the population or the indexes; they go through the public methods, which maintain consistency. A plugin that wants to do something the API does not directly support (e.g., a custom statistic) reads candidates via `list()` and computes the statistic on its own.

### 3.2 Internal Indexes

To make queries fast, the pool maintains several indexes alongside the canonical population dictionary:

**By status**: a map from each status value to the set of candidate ids in that status. Used by `list({ status: ... })` and by selection strategies that operate on a status subset (e.g., "select from active").

**By generation**: a map from generation number to the set of ids created in that generation. Used by the `byGeneration` stat and by queries that filter by generation range.

**By fitness**: a sorted list of (fitness, id) pairs for the active candidates, kept in descending order. Used by top-k selection and by queries that filter by fitness range. Updated incrementally as candidates are added or have their fitness updated.

**Lineage forward and reverse**: two maps. The forward map (`parents`) is implicit in each candidate's `parents` field. The reverse map (`children`) is maintained explicitly: for each candidate id, the set of ids of candidates that list it as a parent. The reverse map is updated when new candidates are added.

These indexes are pure derivations of the canonical state. They are rebuilt from scratch on resume by walking the canonical population, so they are not separately persisted.

### 3.3 Population Lifecycle

A candidate's life in the pool follows a predictable pattern:

```
              ┌──────────────────────┐
              │ pending_evaluation   │  (just added)
              └──────────┬───────────┘
                         │ updateFitness called
                         ▼
              ┌──────────────────────┐
        ┌────►│       active         │  (in active population)
        │     └──┬─────┬─────┬───────┘
        │        │     │     │
        │        │     │     │
        │        │     │     │
        ▼        ▼     ▼     ▼
   ┌────────┐ ┌──────┐ ┌────────┐ ┌──────────┐
   │confirmd│ │falsfd│ │ pruned │ │ archived │
   └────────┘ └──────┘ └────────┘ └──────────┘
        │        │
        └────────┴──► invalidated  (destructive change protocol)
```

A candidate is added in `pending_evaluation` (no fitness yet). Once an evaluator computes its fitness, it transitions to `active`. From `active`, it can move to four terminal states:

- **`confirmed`**: the candidate passed verification (e.g., a Lean proof succeeded, an empirical test confirmed the hypothesis). This is the success state.
- **`falsified`**: the candidate failed verification. This is one of the failure states, and it is preserved for the lineage record (knowing what didn't work informs future generations).
- **`pruned`**: the candidate was removed from active consideration to manage population size. Pruning is a workflow-level decision (the plugin requests it via `updateStatus`); the pool does not automatically prune.
- **`archived`**: the candidate was moved to long-term storage. Used by workflows that want to record interesting candidates without keeping them in the active population.
- **`invalidated`**: the candidate was marked as invalid retroactively because a tool it depends on received a destructive change. The invalidation is recorded with a reason code in the candidate's metadata (e.g., `destructive_change_in_tool:sklearn.pca:2→3`). Invalidated candidates are preserved in the pool for traceability but are excluded from selection strategies, lineage queries for active candidates, and statistical aggregates. This state is typically entered automatically by the destructive change protocol (see `docs/design/tool-registry.md` §8.4.3), not by explicit plugin action.

The transitions are managed by the plugin via `updateFitness` and `updateStatus`. The pool does not enforce a strict state machine — it accepts any transition the plugin requests — but plugins are encouraged to follow the conventional flow.

A candidate in any state remains in the pool. None of the states triggers deletion. The pool's `list()` and `select()` methods accept status filters so that workflows can ignore states they don't care about, but the underlying records are preserved for traceability and resume.

## 4. Selection Strategies

Selection is how the pool answers the question "which candidates should the next generator look at?" The pool provides four built-in strategies, and plugins can register additional strategies via the workflow's startup.

### 4.1 Built-in Strategies

**Top-K**: returns the K candidates with the highest fitness, optionally filtered. The simplest strategy: it is greedy and converges quickly toward the local optimum, but it is vulnerable to premature convergence (the population becomes dominated by descendants of a single high-fitness ancestor).

```typescript
pool.select('top_k', 5, { status: 'active' });
// Returns the 5 active candidates with highest fitness.
```

Use top-k when the discovery process is well-behaved and you want fast convergence. Avoid it when diversity matters more than speed.

**Tournament**: runs N independent tournaments of size K, where each tournament randomly samples K candidates from the population (with replacement) and selects the highest-fitness one. The result is N candidates, each chosen as a tournament winner. Tournament selection is robust against fitness skew (a single super-fit candidate does not dominate) and provides selection pressure that scales with K.

```typescript
pool.select('tournament', 5, { status: 'active', tournamentSize: 4 });
// Returns 5 candidates, each the winner of a 4-way tournament.
```

The `tournamentSize` (K) is part of the strategy options, not the count. K=2 gives mild selection pressure; K=8 gives strong pressure. K=4 is a reasonable default.

Use tournament when you want a balance of fitness and diversity. It is the recommended default for discovery workflows.

**Roulette**: each candidate is assigned a probability proportional to its fitness, and N candidates are sampled according to that distribution. Mathematically elegant, but vulnerable to two failure modes: when one candidate has fitness much higher than the rest, it dominates the wheel; when fitness values are negative or close to zero, the proportional interpretation breaks down. The pool addresses these by normalizing fitness to a positive range before sampling, but the underlying sensitivity remains.

```typescript
pool.select('roulette', 5, { status: 'active' });
// Returns 5 candidates sampled with probability proportional to fitness.
```

Use roulette when fitness values are well-distributed and you want softer selection pressure than tournament. Avoid it when fitness has long tails.

**Random**: returns N candidates sampled uniformly at random, ignoring fitness entirely. This is the diversity-maximizing strategy: it gives every candidate an equal chance and prevents any selection pressure from acting.

```typescript
pool.select('random', 5, { status: 'active' });
// Returns 5 random active candidates.
```

Use random when you specifically want to explore rather than exploit, or when the next generator is itself going to do the selection (the pool just provides raw material).

### 4.2 Selection Composition

A common pattern in discovery workflows is to combine multiple strategies for a single round. For example, "give me the 3 best candidates plus 2 random ones plus 5 from a tournament." The pool supports this via composition: the plugin makes multiple `select()` calls with different strategies and combines the results.

```typescript
const top = pool.select('top_k', 3, { status: 'active' });
const explorer = pool.select('random', 2, { status: 'active' });
const tournament = pool.select('tournament', 5, { status: 'active', tournamentSize: 3 });

const next_generation_inputs = [...top, ...explorer, ...tournament];
```

The pool does not provide a single composite call because the right composition depends on the workflow's strategy and is best expressed in plugin code. Workflows that always use the same composition can wrap it in a helper function within their plugin.

### 4.3 Custom Strategies

A plugin can register custom selection strategies at workflow start by extending the pool's strategy registry:

```typescript
async onWorkflowStart(context: WorkflowStartContext): Promise<void> {
  const pool = context.platform.pool;

  pool.registerStrategy('balanced_by_topic', (population, count, options) => {
    // Custom logic: ensure the result has at least one candidate per topic
    // tracked in metadata.topic
    const topics = new Set(population.map(c => c.metadata.topic));
    const result: Candidate[] = [];
    for (const topic of topics) {
      const topicCandidates = population.filter(c => c.metadata.topic === topic);
      const topInTopic = topicCandidates
        .sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0))
        .slice(0, Math.ceil(count / topics.size));
      result.push(...topInTopic);
    }
    return result.slice(0, count);
  });
}
```

After registration, the custom strategy is callable like the built-ins:

```typescript
pool.select('balanced_by_topic', 10, { status: 'active' });
```

Custom strategies are ephemeral — they exist only for the duration of the workflow run and are re-registered on resume by the plugin's `onWorkflowResume` hook (or by `onWorkflowStart` if the plugin treats start and resume identically). The strategies themselves are not persisted, only the candidates they operated on.

## 5. Lineage and Traceability

Lineage is the record of which candidates were derived from which other candidates. It is the structural backbone of "explaining" a finding: when a workflow concludes that conjecture C is confirmed, the lineage shows the chain of generations and parent candidates that led to C.

### 5.1 The Lineage Graph

The lineage of a pool is a directed acyclic graph where nodes are candidates and edges go from parents to children. The graph is built incrementally as candidates are added: each new candidate's `parents` field defines incoming edges, and the pool's reverse index tracks outgoing edges.

The graph is acyclic by construction. A candidate is created with a fixed list of parent ids that must already exist in the pool, and the parent list is immutable after creation. There is no way to introduce a cycle without modifying past candidates, which the API does not allow.

The graph spans generations. Candidates in generation N can have parents in any generation less than N (typically N-1, but a candidate could be re-derived from a much earlier ancestor if the workflow logic supports it). The graph captures the full history of derivation across the entire run.

### 5.2 Lineage Queries

The pool exposes two directions of lineage query:

**Ancestors**: given a candidate, return all its ancestors (parents, grandparents, etc.) up to a configurable depth. This is what you want when explaining a finding: "C was derived from B, which was derived from A, which was a seed candidate."

```typescript
const ancestors = pool.lineage('cand-7-c5d9', 'ancestors', 10);
// Returns all candidates in the ancestry of cand-7-c5d9, up to 10 generations back.
```

**Descendants**: given a candidate, return all its descendants. This is what you want when analyzing how a particular ancestor influenced the search: "starting from this seed conjecture, the workflow generated 47 descendants over 5 generations, of which 3 were confirmed."

```typescript
const descendants = pool.lineage('cand-0-a3f2', 'descendants', 5);
// Returns all candidates descended from cand-0-a3f2, up to 5 generations forward.
```

The `maxDepth` parameter prevents runaway queries on large pools. With no depth limit, querying ancestors of a deep generation candidate could return hundreds of records; with a limit of 3, it returns at most 3 generations of ancestry, which is usually sufficient for the immediate context.

### 5.3 Why Lineage Matters

Lineage is not just an analytical curiosity. It serves three concrete purposes in discovery workflows:

**Reporting and explanation**: when a workflow produces a finding, the user wants to know how it was discovered. The lineage shows the trajectory: which seed candidate started the line, which generations refined it, what the intermediate fitness values were. A confirmed conjecture without a lineage record is just a statement; with a lineage record, it is a discovery story.

**Diversity assessment**: the workflow can ask "are my top candidates all descendants of the same ancestor?" If yes, the population has converged to a single line and may need diversity injection. If no, the population is exploring multiple lines and is healthy.

**Credit assignment**: when reasoning about the effectiveness of generators or strategies, the lineage tells you which generators produced the ancestors of confirmed findings. A generator whose descendants frequently get confirmed is more effective than one whose descendants get falsified, even if both produce equally many candidates.

## 6. Persistence and Resume

The pool's state must survive crashes and intentional shutdowns so that resumed workflows pick up where they left off. The persistence mechanism is straightforward: the entire pool is serialized to a single JSON file in the run directory, and that file is rewritten atomically on every modification.

### 6.1 The Snapshot Format

The pool state is stored at `{runDirectory}/pool-state.json` with the following structure:

```json
{
  "schema_version": 1,
  "snapshot_timestamp": "2026-04-15T14:32:08.123Z",
  "candidates": {
    "cand-0-a3f2": {
      "id": "cand-0-a3f2",
      "payload": { ... },
      "fitness": 0.847,
      "generation": 0,
      "parents": [],
      "status": "active",
      "createdAt": "2026-04-15T14:25:00.000Z",
      "evaluatedAt": "2026-04-15T14:27:30.000Z",
      "metadata": { ... }
    },
    "cand-1-b7e1": {
      "id": "cand-1-b7e1",
      "payload": { ... },
      "fitness": 0.923,
      "generation": 1,
      "parents": ["cand-0-a3f2"],
      "status": "confirmed",
      "createdAt": "2026-04-15T14:30:00.000Z",
      "evaluatedAt": "2026-04-15T14:31:45.000Z",
      "metadata": { ... }
    }
  },
  "stats_at_snapshot": {
    "total": 2,
    "byStatus": { "active": 1, "confirmed": 1 },
    "byGeneration": { "0": 1, "1": 1 }
  }
}
```

The `schema_version` field allows for future evolution of the format. Currently 1.

The `snapshot_timestamp` records when the snapshot was last written. Used for diagnostics and for determining whether a snapshot is stale relative to other run files.

The `candidates` field is a dictionary keyed by candidate id. Storing as a dictionary (rather than an array) makes lookup fast when the snapshot is loaded back, and avoids the need for a separate id field outside the candidate object.

The `stats_at_snapshot` field caches the population statistics at the time of the snapshot. This is informational — when the pool is reconstructed, the stats are recomputed from the candidates — but it provides a quick summary that can be inspected without loading the full pool into memory.

The format is intentionally human-readable. JSON is not the most efficient serialization for large pools, but pool sizes in practice are small (low hundreds of candidates at most for typical discovery workflows), and the ability to inspect, grep, and diff snapshots manually is valuable for debugging. If pools grow large enough that JSON becomes a bottleneck, switching to a binary format is a future optimization, but it is not currently a concern.

### 6.2 Snapshot Frequency

The pool snapshot is written after every operation that modifies the population:

- After `add()`: a new candidate is in the snapshot
- After `updateFitness()`: the fitness and timestamp are updated
- After `updateStatus()`: the status is updated

Read operations (`get`, `list`, `select`, `lineage`, `stats`) do not trigger snapshot writes. They are pure reads.

The write is atomic: the new content is written to a temporary file (`pool-state.json.tmp`), and then renamed over the existing file. Atomic rename is supported on all major filesystems and ensures that a crash during the write does not leave a corrupted snapshot. The previous snapshot is fully replaced, not merged or appended.

This frequency is consistent with how the workflow engine snapshots `node-states.json`. The cost of writing a small JSON file on every operation is negligible compared to the cost of regenerating a candidate via LLM, so write amplification is not a concern.

### 6.3 Resume Reconstruction

When a workflow run is resumed, the pool is reconstructed from `pool-state.json` as part of the resume sequence (covered in `docs/design/workflow-engine.md` Section 8.3, Step 7). The reconstruction:

1. Reads the JSON file and parses it
2. Validates the schema version matches the current pool implementation
3. Walks the candidates and rebuilds the in-memory population dictionary
4. Rebuilds the indexes (by status, by generation, by fitness, lineage forward and reverse) by walking the candidates
5. Reports the recovered population size in the resume log

If the snapshot file is missing or corrupted, the resume fails for the pool component. The workflow engine treats this as a fatal resume error if the workflow uses a pool, because the pool state is unrecoverable in that case. Workflows that do not use a pool are unaffected.

The plugin's `onWorkflowResume` hook is called after the pool has been reconstructed, so the plugin can re-register custom selection strategies, restore any plugin-side state derived from the pool, and do any other resume preparation that depends on the pool being available.

### 6.4 Snapshot Rotation and Backup

The current design rewrites a single snapshot file. There is no automatic backup of previous snapshots, no rolling history, no ability to inspect the pool's state at an earlier point in the run.

For workflows where this matters (e.g., long discovery runs where the user wants to compare the pool at generation 5 vs generation 15), the workaround is for the plugin to explicitly write its own backup snapshots to a separate location at meaningful checkpoints. The plugin can serialize the pool itself via `pool.list()` and write the result to a file in the run directory.

If snapshot history becomes a recurring need, the pool can be extended to maintain a rolling history (e.g., the last N snapshots) automatically, but this is not in the current scope.

## 7. Plugin Integration

The pool is exposed to plugins via `context.platform.pool` in every hook context. Plugins use the pool through three primary interaction patterns: adding candidates from a generator, updating fitness from an evaluator, and querying for selection input from a generator's context.

### 7.1 Adding Candidates from a Generator

A generator node produces new candidates as part of its output. The plugin's `onSignalReceived` hook (or a similar hook depending on workflow conventions) receives the generator's signal, extracts the proposed candidates, and adds them to the pool.

```typescript
async onSignalReceived(context: SignalContext): Promise<SignalDecision> {
  const { signal, nodeName, platform } = context;

  if (nodeName === 'conjecturer') {
    const proposedConjectures = signal.outputs[0].value as Conjecture[];
    const generation = computeNextGeneration(platform.pool);

    for (const conjecture of proposedConjectures) {
      platform.pool.add(
        conjecture,                       // payload
        conjecture.derived_from ?? [],    // parents
        generation,                       // generation
        { proposed_by: 'conjecturer', model: 'opus' }  // metadata
      );
    }

    return { action: 'accept' };
  }

  // ... handling for other nodes
}
```

The generator does not need to know about the pool's internals. It produces candidates as structured data in its signal output, and the plugin translates this into pool operations. The separation keeps the generator's preset focused on the domain task and the pool interaction in TypeScript code where it is type-safe.

### 7.2 Updating Fitness from an Evaluator

An evaluator node assigns a fitness score (and optionally a verdict) to a candidate. The plugin's `onEvaluationResult` hook receives the evaluation result and updates the pool.

```typescript
async onEvaluationResult(context: EvaluationContext): Promise<void> {
  const { candidateId, fitness, verdict, platform } = context;

  let newStatus: CandidateStatus = 'active';
  if (verdict === 'confirmed') newStatus = 'confirmed';
  if (verdict === 'falsified') newStatus = 'falsified';

  platform.pool.updateFitness(candidateId, fitness, newStatus);
}
```

The hook fires automatically when the platform recognizes a signal as an evaluation result (based on the node's role declaration in the workflow YAML). The plugin's only job is to translate the evaluation context into a pool update.

### 7.3 Providing Context to a Generator

Before a generator runs, it needs context: which candidates from the pool should it look at as input? The plugin's `onEvolutionaryContext` hook is called with the generator's role, and the plugin uses the pool to select the relevant candidates.

```typescript
async onEvolutionaryContext(
  context: EvolutionaryContextRequest
): Promise<EvolutionaryContextResult> {
  const { role, platform } = context;

  if (role === 'generator') {
    const positives = platform.pool.select('top_k', 5, { status: 'confirmed' });
    const negatives = platform.pool.select('top_k', 3, { status: 'falsified' });
    const ancestors = positives.flatMap(c =>
      platform.pool.lineage(c.id, 'ancestors', 2)
    );

    return {
      positiveExamples: positives,
      negativeExamples: negatives,
      ancestors,
      customContext: {
        total_pool_size: platform.pool.stats().total,
        current_generation: computeCurrentGeneration(platform.pool)
      }
    };
  }

  return { positiveExamples: [], negativeExamples: [], ancestors: [], customContext: {} };
}
```

The result is consumed by the workflow engine when constructing the generator's purpose: the positive and negative examples are formatted into the prompt according to the preset's slots, and the custom context is available as template variables. The plugin's selection logic determines what the generator sees, which is the primary lever for controlling the discovery process.

## 8. Implementation Status and Gaps

This section documents the gaps between the current pool implementation and the target design described in this document. The intent is to make the work needed for math-discovery's pool integration explicit.

**Implemented in the current codebase (verify against actual code):**
- Basic pool data structure with candidates, fitness, generation, parents, status
- Add, get, list operations
- Some form of selection (likely top-k at minimum)
- Persistence to a JSON file in the run directory
- Resume from snapshot
- Plugin hook integration via `onEvaluationResult` and `onEvolutionaryContext`

**Likely gaps requiring work for math-discovery:**
- Complete set of built-in selection strategies (tournament, roulette, random in addition to top-k)
- Custom strategy registration via plugin
- Lineage queries with depth limits
- Rich filtering in `list()` and `select()`
- Reverse lineage index (children) for descendant queries
- Population statistics with all the fields specified in `PoolStats`
- Status state machine with all seven states (the current implementation may have fewer)
- Reproducible candidate ids via content hashing
- Support for the `invalidated` status in the lifecycle, including: adding it to the enum, excluding invalidated candidates from `select()` and active `list()` queries, preserving them for lineage tracing, and handling automatic entry into this state via the destructive change protocol triggered from `RegistryClient`.

**Items that may need design refinement when math-discovery exercises the pool:**
- Whether the candidate `payload` should have any standard substructure (e.g., a required `summary` field for LLM consumption) or remain entirely free-form
- Whether selection strategies should be passed structured options (like `tournamentSize`) or named variants (`tournament_4`, `tournament_8`)
- Whether the pool should support multi-population structures (e.g., island models with migration between subpopulations) — math-discovery may or may not need this
- Whether large pools should switch to a more efficient persistence format

**Estimated work to bring the implementation to the target:**
- Selection strategies completion: 2-3 days
- Lineage queries with depth: 1 day
- Statistics and filtering: 1-2 days
- Status state machine clarification: 1 day
- Custom strategy registration: 1 day
- Documentation and testing: 2 days

Total: approximately 1.5-2 weeks of focused work, but most of this can be deferred until math-discovery actually needs each feature. The pool can evolve incrementally as the first real consumer reveals which features are critical and which are nice-to-have.

## 9. Common Patterns

This section catalogues patterns that come up in discovery workflows using the pool. They are advisory, not normative.

**Generation tracking via plugin state.** The pool does not track "current generation" because generations are a workflow-level concept. The plugin maintains its own counter (in plugin state, persisted to a small JSON file or to the run metadata) and increments it each time a generator runs. The counter is passed to `pool.add()` for new candidates.

**Verification as status transition.** When a verifier node confirms or falsifies a candidate, the plugin transitions the status in `onEvaluationResult`. The candidate stays in the pool (it does not get deleted) so that the lineage record is preserved and the verification outcome can be reasoned about later.

**Pruning policies for population management.** Long-running discovery workflows can accumulate large populations. The plugin can implement a pruning policy that runs periodically (e.g., at the end of each generation) and marks low-fitness or old candidates as `pruned`. The `pruned` status removes them from active selection without losing the lineage record.

**Diversity injection via random selection.** When the population shows signs of premature convergence (top-k from multiple generations all descend from the same ancestor), the plugin can mix random selection into the next generation's input. This is a workflow-level decision, not a pool feature, but the pool's `random` strategy supports it directly.

**Cross-generation comparisons.** When evaluating whether the workflow is making progress, the plugin can compare statistics across generations: `pool.stats().byGeneration` gives counts; per-generation fitness can be computed from `list({ generation: N })`.

**Lineage-based reporting.** When generating a final report on confirmed findings, the plugin can include the lineage of each confirmation: walk back from the confirmed candidate to its seed ancestor, format the chain, and present it as the discovery story.

---

## 10. Open Questions

A handful of design questions remain unresolved at the time of this writing. They will be addressed when math-discovery exercises the pool in earnest.

**Multi-population (island model) support.** Some evolutionary computing workflows benefit from maintaining multiple parallel subpopulations with occasional migration between them. The current pool is single-population. Adding island support is not trivial — it touches the candidate id format, the selection strategies, and the persistence — and is deferred until a workflow demonstrates the need.

**Generation boundaries as first-class events.** Currently, generation is just an integer field on candidates. There is no "generation N just ended" event that hooks could observe. Some workflows may want such events for triggering checkpoint operations, computing per-generation statistics, or deciding when to terminate.

**Cross-run pool sharing.** A future workflow might want to start with a pool seeded from a previous run's findings. The current design has pools scoped to a single run, with no mechanism for export/import. Adding this is straightforward (the snapshot format is already JSON) but the semantics need thought: do imported candidates retain their original ids? Do they get a new generation number?

**Pool size limits and eviction.** The current pool has no maximum size. A runaway workflow could accumulate millions of candidates, eventually exhausting memory. Adding a configurable size limit with an eviction policy is a defensive feature that may become necessary.

**Type system integration.** The candidate payloads are free-form `Record<string, unknown>`. With the introduction of the type system in TR Phase 4, it might make sense to allow workflows to declare a schema for their candidates, so that the pool can validate payloads and so that LLMs can be informed about the structure they are operating on. This is a natural extension but is not in the current scope.

These questions are recorded so that future revisions of this document can address them as the experience of using the pool reveals which ones matter.

---

*This document is the design target for the Plurics Evolutionary Pool. The current implementation is a starting point that needs refinement to fully realize this design. The first major consumer (math-discovery) is expected to drive the gap-closing work, and this document should be updated to reflect what is learned during that process.*