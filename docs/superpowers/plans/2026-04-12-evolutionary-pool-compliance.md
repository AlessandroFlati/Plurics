# Plan: Evolutionary Pool Compliance
**Date:** 2026-04-12
**Spec:** `docs/superpowers/specs/2026-04-12-evolutionary-pool-compliance-design.md`
**Branch:** `feat/evolutionary-pool-compliance`
**Est. total:** ~2 days

---

## Overview

18 tasks to bring `evolutionary-pool.ts` and `dag-executor.ts` to full compliance with `docs/design/evolutionary-pool.md`. Tasks follow the dependency order: status rename → ID format → deduplication → reverse index/descendants → stats → filtering → strategy registry → executor auto-update → cleanup.

---

## Task 01 — Rename CandidateStatus to design-spec values

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — foundational, all other tasks depend on the correct status set.

### Current state

```typescript
export type CandidateStatus =
  | 'pending' | 'testing' | 'confirmed' | 'falsified' | 'inconclusive' | 'superseded';
```

### Target state

```typescript
export type CandidateStatus =
  | 'pending_evaluation'
  | 'active'
  | 'confirmed'
  | 'falsified'
  | 'pruned'
  | 'archived';
```

### Steps

1. Read `evolutionary-pool.ts` in full.
2. Replace the `CandidateStatus` type declaration with the 6-value design set.
3. Update every reference to old statuses inside the file:
   - `'pending'` → `'pending_evaluation'`
   - `'testing'` → `'pending_evaluation'`
   - `'inconclusive'` → `'active'`
   - `'superseded'` → `'pruned'`
4. Update default status in `add()` to `'pending_evaluation'`.
5. Update `getEligible()` default statusFilter from `['confirmed', 'pending', 'inconclusive']` to `['active', 'confirmed', 'pending_evaluation']`.
6. Grep for status references in `dag-executor.ts` and `sdk.ts`; update any literal status strings found.

### Verification

- TypeScript compiler (`tsc --noEmit`) passes with no errors on `evolutionary-pool.ts`.
- `EvolutionaryPool` instantiates without error in a quick `node -e` smoke.

---

## Task 02 — Replace content: string with payload: Record<string, unknown>

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — aligns the data model with the design doc (payload replaces content string).

### Current state

`PoolCandidate` has `content: string`. No `payload` field.

### Target state

`PoolCandidate` replaces `content: string` with `payload: Record<string, unknown>`.

### Steps

1. In `PoolCandidate` interface: remove `content: string`, add `payload: Record<string, unknown>`.
2. Grep for uses of `.content` on candidates in the codebase.
3. Update any references in `dag-executor.ts`, `sdk.ts`, or plugin files from `.content` to `.payload`.
4. Ensure `snapshot()` and `restore()` are payload-neutral (they serialize the full object, so no change needed there).

### Verification

`tsc --noEmit` clean. No `.content` references remain on `PoolCandidate` outside of the candidate's own type.

---

## Task 03 — Rename parentIds to parents

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`, `dag-executor.ts`, `sdk.ts`

**Abbreviated** — mechanical rename.

Replace `parentIds` with `parents` on `PoolCandidate`. Update `getLineage()` which reads `candidate.parentIds`. Grep for `parentIds` across the codebase and replace all occurrences.

---

## Task 04 — Implement content-hash ID generation (Gap 1)

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — enables deduplication, changes the public ID format.

### Implementation

Add a module-level helper:

```typescript
import { createHash } from 'node:crypto';

function generateCandidateId(payload: Record<string, unknown>, generation: number): string {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  const hash = createHash('sha256').update(stable).digest('hex').slice(0, 8);
  return `cand-${generation}-${hash}`;
}
```

Notes:
- `Object.keys(payload).sort()` is passed as the replacer to `JSON.stringify` for deterministic key order.
- `node:crypto` is a built-in Node module; no new dependency needed.

### Steps

1. Add `import { createHash } from 'node:crypto';` at the top of the file.
2. Add the `generateCandidateId` function above the class.
3. Remove `private idCounter = 0;` from the class.
4. Remove `private generateId(): string { ... }` method.
5. `add()` will call `generateCandidateId(payload, generation)` — done in Task 05 when add() is rewritten.

### Verification

```typescript
// In a test or node -e:
const id1 = generateCandidateId({ a: 1, b: 2 }, 3);
const id2 = generateCandidateId({ b: 2, a: 1 }, 3); // different key order
// id1 === id2 (sorted keys → same hash)
const id3 = generateCandidateId({ a: 1, b: 2 }, 4);
// id3 !== id1 (different generation)
```

---

## Task 05 — Rewrite add() with new signature and deduplication (Gaps 1, 8)

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — changes the public API of `add()`.

### Current signature

```typescript
add(candidate: Omit<PoolCandidate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): string
```

### Target signature

```typescript
add(
  payload: Record<string, unknown>,
  parents: string[],
  generation: number,
  metadata?: Record<string, unknown>
): string
```

### Implementation

```typescript
add(
  payload: Record<string, unknown>,
  parents: string[],
  generation: number,
  metadata: Record<string, unknown> = {}
): string {
  const id = generateCandidateId(payload, generation);

  if (this.candidates.has(id)) {
    // Deduplication: return existing candidate unchanged
    this.logger?.info('evolutionary-pool: duplicate candidate skipped', { id, generation });
    return id;
  }

  const now = Date.now();
  const candidate: PoolCandidate = {
    id,
    payload,
    parents,
    generation,
    fitness: { composite: 0, dimensions: {} },
    status: 'pending_evaluation',
    createdAt: now,
    updatedAt: now,
    metadata,
  };
  this.candidates.set(id, candidate);

  // Update reverse index (for descendants lineage)
  for (const parentId of parents) {
    if (!this.childrenIndex.has(parentId)) {
      this.childrenIndex.set(parentId, new Set());
    }
    this.childrenIndex.get(parentId)!.add(id);
  }

  return id;
}
```

`this.logger` is an optional `PlatformLogger` injected via constructor (see Task 09). `this.childrenIndex` is added in Task 07.

### Steps

1. Add `private childrenIndex = new Map<string, Set<string>>();` to the class (placeholder — Task 07 fills).
2. Replace `add()` with the implementation above.
3. Grep codebase for all `pool.add(` calls; update to new signature.
4. Update `restore()` to also populate `childrenIndex` (Task 07).

### Verification

`tsc --noEmit` clean. Call `add({ x: 1 }, [], 0)` twice; confirm only one candidate in the map and the same ID returned both times.

---

## Task 06 — Add updateFitness() and updateStatus() methods (Gap 4 complement)

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — the design doc specifies these as named methods; current code uses a generic `update()`.

### Steps

1. Add `updateFitness(id: string, fitness: number, status?: CandidateStatus): void`:
   - Reads existing candidate (throws if not found).
   - Sets `fitness.composite = fitness` (keeps existing `dimensions`).
   - If `status` provided, sets `status`.
   - Sets `updatedAt = Date.now()`.
   - Writes back to `this.candidates`.

2. Add `updateStatus(id: string, status: CandidateStatus): void`:
   - Reads existing candidate (throws if not found).
   - Sets `status` and `updatedAt`.
   - Writes back.

3. Keep `update()` as the generic mutation method (used internally). It is not part of the design doc's public API but is harmless to retain.

### Verification

Unit-level: add a candidate, call `updateFitness(id, 0.9, 'active')`, confirm `get(id).fitness.composite === 0.9` and `status === 'active'`.

---

## Task 07 — Build reverse children index and implement descendants lineage (Gap 7)

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — enables descendants direction in `getLineage()`.

### Steps

1. Add `private childrenIndex = new Map<string, Set<string>>();` (if not done in Task 05).

2. Update `restore()` to rebuild the index:

```typescript
restore(snapshot: PoolSnapshot): void {
  this.candidates.clear();
  this.childrenIndex.clear();
  for (const c of snapshot.candidates) {
    this.candidates.set(c.id, c);
  }
  // Rebuild reverse index
  for (const c of snapshot.candidates) {
    for (const parentId of c.parents) {
      if (!this.childrenIndex.has(parentId)) {
        this.childrenIndex.set(parentId, new Set());
      }
      this.childrenIndex.get(parentId)!.add(c.id);
    }
  }
  // idCounter removal: nothing to reset (hash-based IDs)
}
```

3. Replace `getLineage(id)` with `getLineage(id, direction?, maxDepth?)`:

```typescript
getLineage(
  id: string,
  direction: 'ancestors' | 'descendants' = 'ancestors',
  maxDepth?: number
): PoolCandidate[] {
  const result: PoolCandidate[] = [];
  const visited = new Set<string>();
  // BFS with depth tracking
  const queue: Array<{ id: string; depth: number }> = [{ id, depth: 0 }];

  while (queue.length > 0) {
    const { id: current, depth } = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const candidate = this.candidates.get(current);
    if (!candidate) continue;
    if (current !== id) result.push(candidate); // exclude the root itself

    if (maxDepth !== undefined && maxDepth > 0 && depth >= maxDepth) continue;

    if (direction === 'ancestors') {
      for (const parentId of candidate.parents) {
        queue.push({ id: parentId, depth: depth + 1 });
      }
    } else {
      const children = this.childrenIndex.get(current) ?? new Set();
      for (const childId of children) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    }
  }
  return result;
}
```

### Verification

Build a small graph (A → B → C, A → D). Assert:
- `getLineage('C', 'ancestors')` returns [B, A].
- `getLineage('A', 'descendants')` returns [B, C, D].
- `getLineage('A', 'descendants', 1)` returns [B, D] only (depth 1).

---

## Task 08 — Add stats() method (Gap 2)

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — new public method required by design doc.

### Steps

1. Add `PoolStats` interface above the class:

```typescript
export interface PoolStats {
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

2. Add `stats(): PoolStats` method:

```typescript
stats(): PoolStats {
  const all = [...this.candidates.values()];
  const statuses: CandidateStatus[] = [
    'pending_evaluation', 'active', 'confirmed', 'falsified', 'pruned', 'archived'
  ];
  const byStatus = Object.fromEntries(statuses.map(s => [s, 0])) as Record<CandidateStatus, number>;
  const byGeneration: Record<number, number> = {};
  const fitnessValues: number[] = [];
  const activeCandidates: PoolCandidate[] = [];

  for (const c of all) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    byGeneration[c.generation] = (byGeneration[c.generation] ?? 0) + 1;
    if (c.fitness.composite !== 0 || c.status !== 'pending_evaluation') {
      fitnessValues.push(c.fitness.composite);
    }
    if (c.status === 'active') activeCandidates.push(c);
  }

  const mean = fitnessValues.length > 0
    ? fitnessValues.reduce((a, b) => a + b, 0) / fitnessValues.length
    : null;
  const maxF = fitnessValues.length > 0 ? Math.max(...fitnessValues) : null;
  const minF = fitnessValues.length > 0 ? Math.min(...fitnessValues) : null;

  const activeByCreated = activeCandidates.sort((a, b) => a.createdAt - b.createdAt);
  const oldestActive = activeByCreated[0]
    ? new Date(activeByCreated[0].createdAt).toISOString() : null;
  const newestActive = activeByCreated[activeByCreated.length - 1]
    ? new Date(activeByCreated[activeByCreated.length - 1].createdAt).toISOString() : null;

  return {
    total: all.length,
    byStatus,
    byGeneration,
    meanFitness: mean,
    maxFitness: maxF,
    minFitness: minF,
    oldestActive,
    newestActive,
  };
}
```

### Verification

Pool with 3 candidates (1 pending_evaluation, 2 active with fitness 0.5 and 0.8). Assert:
- `stats().total === 3`
- `stats().byStatus.active === 2`
- `stats().meanFitness` ≈ 0.65
- `stats().oldestActive` is a valid ISO string.

---

## Task 09 — Add list(filters?) method (Gap 6)

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — replaces ad-hoc getAll/getConfirmed/getFalsified with a unified filter API.

### Steps

1. Add `PoolFilters` interface:

```typescript
export interface PoolFilters {
  status?: CandidateStatus | CandidateStatus[];
  generationRange?: [min: number, max: number];
  fitnessRange?: [min: number, max: number];
  hasParent?: string;
  metadata?: Record<string, unknown>;
}
```

2. Add `list(filters?: PoolFilters): PoolCandidate[]`:

```typescript
list(filters?: PoolFilters): PoolCandidate[] {
  let result = [...this.candidates.values()];
  if (!filters) return result;

  if (filters.status !== undefined) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    result = result.filter(c => statuses.includes(c.status));
  }
  if (filters.generationRange !== undefined) {
    const [min, max] = filters.generationRange;
    result = result.filter(c => c.generation >= min && c.generation <= max);
  }
  if (filters.fitnessRange !== undefined) {
    const [min, max] = filters.fitnessRange;
    result = result.filter(c =>
      c.fitness.composite >= min && c.fitness.composite <= max
    );
  }
  if (filters.hasParent !== undefined) {
    result = result.filter(c => c.parents.includes(filters.hasParent!));
  }
  if (filters.metadata !== undefined) {
    result = result.filter(c =>
      Object.entries(filters.metadata!).every(([k, v]) => c.metadata[k] === v)
    );
  }
  return result;
}
```

3. Update `getEligible()` in `select()` to accept and apply `PoolFilters` when provided.

4. Mark `getAll()`, `getConfirmed()`, `getFalsified()` as `@deprecated` with JSDoc comment pointing to `list()`. Do not delete them yet.

### Verification

- `list({ status: 'active' })` returns only active candidates.
- `list({ generationRange: [1, 3] })` returns only generations 1, 2, 3.
- `list({ hasParent: 'cand-0-xxxxxxxx' })` returns direct children of that ID.
- `list({ metadata: { topic: 'primes' } })` returns candidates where `metadata.topic === 'primes'`.

---

## Task 10 — Add registerStrategy() and update select() (Gap 5)

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Full task** — plugin-extensible selection.

### Steps

1. Add the strategy function type and registry:

```typescript
export type StrategyFn = (
  population: PoolCandidate[],
  count: number,
  options?: Record<string, unknown>
) => PoolCandidate[];

// Inside class:
private strategyRegistry = new Map<string, StrategyFn>();
```

2. Add `registerStrategy(name: string, fn: StrategyFn): void`:

```typescript
registerStrategy(name: string, fn: StrategyFn): void {
  this.strategyRegistry.set(name, fn);
}
```

3. In constructor, pre-register built-in strategies:

```typescript
constructor(logger?: PlatformLogger) {
  this.logger = logger ?? null;
  this.strategyRegistry.set('top-k', (pop, k) => this.topK(pop, k));
  this.strategyRegistry.set('tournament', (pop, k, opts) =>
    this.tournament(pop, k, (opts?.tournamentSize as number) ?? 3));
  this.strategyRegistry.set('roulette', (pop, k) => this.roulette(pop, k));
  this.strategyRegistry.set('random', (pop, k) => this.randomSelect(pop, k));
}
```

4. Update `select()` to check registry before the switch:

```typescript
select(options: SelectionOptions): PoolCandidate[] {
  const eligible = this.getEligible(options);
  if (eligible.length === 0) return [];
  if (options.k >= eligible.length) return [...eligible];

  const fn = this.strategyRegistry.get(options.strategy);
  if (fn) return fn(eligible, options.k, options as unknown as Record<string, unknown>);

  throw new Error(`Unknown selection strategy: ${options.strategy}`);
}
```

The old `switch` block is removed since all built-ins are now in the registry.

### Verification

- Register `'test_strategy'` that always returns the first candidate. Call `select({ strategy: 'test_strategy', k: 1 })`. Assert result has length 1.
- Unregistered strategy name throws `Error`.

---

## Task 11 — Inject optional logger into EvolutionaryPool constructor

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`, `dag-executor.ts`

**Abbreviated** — adds `PlatformLogger | null` as optional constructor param; needed by Task 05 deduplication logging.

Add `private logger: PlatformLogger | null = null;` and `constructor(logger?: PlatformLogger)` setter. In `dag-executor.ts`, where `this.pool = new EvolutionaryPool()` is constructed, pass `this.buildPlatformServices().logger`.

---

## Task 12 — Auto-update pool in dag-executor onEvaluationResult (Gap 3)

**Files:** `packages/server/src/modules/workflow/dag-executor.ts`

**Full task** — closes the integration gap between evaluation and pool state.

### Current code (around line 1204)

```typescript
if (this.plugin?.onEvaluationResult) {
  const evalCtx: EvaluationContext = { ... };
  try {
    await this.plugin.onEvaluationResult(evalCtx);
  } catch (err) {
    ps.logger.error('onEvaluationResult hook threw', { ... });
  }
}
```

### Target: add pool auto-update after the hook

```typescript
if (this.plugin?.onEvaluationResult) {
  const evalCtx: EvaluationContext = { ... };
  try {
    await this.plugin.onEvaluationResult(evalCtx);
  } catch (err) {
    const ps = this.buildPlatformServices();
    ps.logger.error('onEvaluationResult hook threw', { error: String(err), node: node.name });
  }

  // Auto-update pool fitness baseline (plugin may override via updateStatus)
  const candidateId = evalCtx.candidateId;
  if (candidateId && this.pool.get(candidateId)) {
    const verdictStatus: CandidateStatus =
      evalCtx.verdict === 'fail' ? 'falsified' : 'active';
    try {
      this.pool.updateFitness(candidateId, evalCtx.fitness, verdictStatus);
    } catch (err) {
      const ps = this.buildPlatformServices();
      ps.logger.warn('pool.updateFitness failed after evaluation', {
        candidateId, error: String(err)
      });
    }
  }
}
```

### Steps

1. Read `dag-executor.ts` lines 1190–1230 to confirm exact current structure.
2. Add the import for `CandidateStatus` from `evolutionary-pool.ts` if not already imported.
3. Insert the auto-update block as shown above, after the try/catch for the plugin hook.
4. Confirm `this.pool.get()` returns the right type after Tasks 05–06 changes.

### Verification

Integration smoke: construct a DAG with one evaluator node. After the node's signal is processed, confirm `pool.get(candidateId).status === 'active'` (for a passing verdict) without the plugin needing to call `updateFitness`.

---

## Task 13 — Update PoolSnapshot type and restore() for new schema

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Abbreviated** — `PoolSnapshot` currently has `candidates: PoolCandidate[]`. After Task 02 and 03, `PoolCandidate` has `payload` not `content`, and `parents` not `parentIds`. Ensure `snapshot()` and `restore()` serialize/deserialize the current type correctly. Add `schema_version: 1` to `PoolSnapshot`. The `restore()` from Task 07 already handles `childrenIndex` rebuild.

---

## Task 14 — Remove markSuperseded() and deprecated helpers

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Abbreviated** — `markSuperseded()` becomes dead code after the status rename (Task 01 removes `superseded`). Delete it. Grep for callers in codebase; replace with `pool.updateStatus(id, 'pruned')`. After confirming no callers remain, also remove `selectAsNegativeExamples()` and `selectForContext()` (now covered by `list()` + `select()`), unless they are called externally.

---

## Task 15 — Update sdk.ts EvaluationContext types

**Files:** `packages/server/src/modules/workflow/sdk.ts`

**Abbreviated** — `EvaluationContext.verdict` is currently `'pass' | 'fail' | 'inconclusive'`. Verify this matches what the executor populates (`evalCtx.verdict`). If the executor hard-codes `'inconclusive'` (it does, line ~1212), fix it to derive the verdict from the signal outputs. Also add `pool?: EvolutionaryPool` to `PlatformServices` so plugins can call `pool.updateStatus()` from hook contexts (currently the pool is not exposed to plugins).

---

## Task 16 — Update SelectionOptions to accept PoolFilters

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Abbreviated** — Add `filters?: PoolFilters` to `SelectionOptions`. Update `getEligible()` to apply `PoolFilters` when present (delegating to `list()` internally). When `filters.status` is set, it takes precedence over `statusFilter`. This wires Task 09 into the selection path.

---

## Task 17 — Fix idCounter removal in restore()

**Files:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

**Abbreviated** — After Task 04, the counter-based `idCounter` is removed. The current `restore()` has logic to reset `this.idCounter` from snapshot IDs. Delete those lines (they parse numeric IDs from `C-{n}` format which no longer applies). The only state that `restore()` needs to reset beyond candidates is `childrenIndex` (Task 07).

---

## Task 18 — End-to-end smoke test

**Files:** `test-data/run-smoke.js` (or a new `test-data/run-pool-compliance.js`)

**Full task** — validates the complete set of changes work together.

### Test sequence

1. Instantiate `EvolutionaryPool`.
2. `add({ conjecture: 'test-1' }, [], 0)` → assert ID matches `cand-0-{hash}` format.
3. `add({ conjecture: 'test-1' }, [], 0)` again → assert same ID returned (deduplication).
4. `add({ conjecture: 'test-2' }, [id1], 1)` → assert new ID, children index updated.
5. `updateFitness(id1, 0.75, 'active')` → assert `get(id1).fitness.composite === 0.75`.
6. `updateFitness(id2, 0.9, 'active')` → assert status updated.
7. `stats()` → assert `total === 2`, `byStatus.active === 2`, `meanFitness ≈ 0.825`.
8. `list({ status: 'active' })` → assert length 2.
9. `list({ fitnessRange: [0.8, 1.0] })` → assert only id2 returned.
10. `getLineage(id2, 'ancestors')` → assert [id1].
11. `getLineage(id1, 'descendants')` → assert [id2].
12. `registerStrategy('always_first', (pop) => [pop[0]])` → `select({ strategy: 'always_first', k: 1 })` → assert length 1.
13. `snapshot()` → `restore(snapshot)` → assert all candidates present and children index rebuilt.
14. `stats()` after restore → same values as step 7.

### Steps

1. Create `test-data/run-pool-compliance.js` with the above sequence using CommonJS require or ESM import.
2. Run with `node test-data/run-pool-compliance.js`.
3. All asserts pass with `console.log('PASS: <step name>')` output.
4. Confirm no TypeScript errors before running: `tsc --noEmit` in `packages/server/`.

---

## Execution Checklist

| # | Task | Scope | Deps |
|---|------|-------|------|
| 01 | Rename CandidateStatus | evolutionary-pool.ts | — |
| 02 | payload replaces content | evolutionary-pool.ts | 01 |
| 03 | parentIds → parents | evolutionary-pool.ts + callers | 01 |
| 04 | Hash-based ID generator | evolutionary-pool.ts | — |
| 05 | Rewrite add() | evolutionary-pool.ts | 02, 03, 04 |
| 06 | Add updateFitness/updateStatus | evolutionary-pool.ts | 01 |
| 07 | Reverse index + descendants | evolutionary-pool.ts | 03, 05 |
| 08 | stats() | evolutionary-pool.ts | 01 |
| 09 | list(filters?) | evolutionary-pool.ts | 01 |
| 10 | registerStrategy + select() | evolutionary-pool.ts | 09 |
| 11 | Logger injection | evolutionary-pool.ts, executor | — |
| 12 | Auto-update pool in executor | dag-executor.ts | 06, 11 |
| 13 | PoolSnapshot schema update | evolutionary-pool.ts | 02, 03 |
| 14 | Remove markSuperseded | evolutionary-pool.ts | 01 |
| 15 | sdk.ts EvaluationContext + pool | sdk.ts | 01, 06 |
| 16 | SelectionOptions + PoolFilters | evolutionary-pool.ts | 09 |
| 17 | Remove idCounter from restore | evolutionary-pool.ts | 04 |
| 18 | Smoke test | test-data/ | all |
