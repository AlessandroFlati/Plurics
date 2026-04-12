# Spec: Evolutionary Pool Compliance
**Date:** 2026-04-12
**Status:** Approved for implementation
**Design reference:** `docs/design/evolutionary-pool.md`
**Implementation target:** `packages/server/src/modules/workflow/evolutionary-pool.ts`

---

## 1. Context

The evolutionary pool (`evolutionary-pool.ts`) is ~65% compliant with the design doc. Eight gaps block the `math-discovery` workflow from using the pool as the design intends. This spec defines the exact contract changes needed to close those gaps.

No gap requires a full rewrite. All changes are additive or surgical replacements to the existing class. The public API is extended; no existing method signatures are removed (callers must be updated where signatures change).

---

## 2. Gap Specifications

### Gap 1 — Candidate ID Format

**Current:** `C-{n}` (e.g. `C-001`) — counter-based, no content relationship.

**Target:** `cand-{generation}-{shortHash}` where `shortHash` is the first 8 hex characters of the SHA-256 of `JSON.stringify(payload)` (keys sorted for stability). Example: `cand-3-a3f2c9b1`.

**Rationale:** Content-derived IDs enable deduplication (Gap 8). The same payload in the same generation always produces the same ID. Across generations the ID differs because `generation` is part of the input.

**Contract:**

```typescript
// Hash input: JSON with sorted keys so field order does not matter
function candidateId(payload: Record<string, unknown>, generation: number): string {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  // crypto.createHash('sha256').update(stable).digest('hex').slice(0, 8)
  return `cand-${generation}-${shortHash}`;
}
```

**Breaking surface:** `restore()` reads existing IDs from snapshots verbatim — no migration needed. The counter field `idCounter` is removed.

---

### Gap 2 — Pool Statistics API

**Current:** No `stats()` method. Only `count(status?)` exists.

**Target:** Add `stats(): PoolStats` returning:

```typescript
interface PoolStats {
  total: number;
  byStatus: Record<CandidateStatus, number>;
  byGeneration: Record<number, number>;
  meanFitness: number | null;   // mean of all non-null fitness.composite values
  maxFitness: number | null;
  minFitness: number | null;
  oldestActive: string | null;  // ISO createdAt of oldest active candidate
  newestActive: string | null;  // ISO createdAt of newest active candidate
}
```

`byStatus` includes every status value, defaulting to 0 for statuses with no candidates. `byGeneration` keys are generation integers. Fitness metrics use only candidates whose fitness is not null. Timestamps are ISO 8601 strings derived from the `createdAt` epoch number.

---

### Gap 3 — onEvaluationResult Auto-updates Pool

**Current:** `dag-executor.ts` calls `plugin.onEvaluationResult()` but never calls `pool.updateFitness()`. The pool is not updated automatically.

**Target:** After calling `plugin.onEvaluationResult()`, the executor calls `pool.updateFitness()` with the candidateId, fitness, and a status derived from the verdict.

**Verdict → status mapping:**

| verdict | status |
|---------|--------|
| `pass` | `active` |
| `fail` | `falsified` |
| `inconclusive` | `active` |

The plugin's `onEvaluationResult` hook may override the pool status by calling `pool.updateStatus()` itself — the executor's auto-update runs first (as a baseline), so plugins can refine afterward.

**Executor change location:** `dag-executor.ts` around line 1205, inside the `if (this.plugin?.onEvaluationResult)` block, after the await.

---

### Gap 4 — Full 7-Status Lifecycle

**Current statuses:** `pending`, `testing`, `confirmed`, `falsified`, `inconclusive`, `superseded` — 6 statuses, none match the design's set.

**Target statuses** (design doc Section 2.1):

```typescript
type CandidateStatus =
  | 'pending_evaluation'   // just added, no fitness
  | 'active'               // evaluated, in active population
  | 'confirmed'            // verified as finding
  | 'falsified'            // verified as non-finding
  | 'pruned'               // removed by population management
  | 'archived';            // long-term storage, not active
```

**Migration impact:** The current statuses `testing`, `inconclusive`, `superseded` are removed. Any code referencing them must be updated:
- `testing` → `pending_evaluation`
- `inconclusive` → `active`
- `superseded` → `pruned`

The method `markSuperseded()` is removed; callers use `updateStatus(id, 'pruned')`.

Default status on `add()` changes from `pending` to `pending_evaluation`.

---

### Gap 5 — Custom Strategy Registration

**Current:** `select()` only accepts four hardcoded strategy names.

**Target:** Add `registerStrategy(name, fn)` so plugins inject domain-specific strategies.

```typescript
type StrategyFn = (
  population: PoolCandidate[],
  count: number,
  options?: Record<string, unknown>
) => PoolCandidate[];

registerStrategy(name: string, fn: StrategyFn): void;
```

`select()` looks up the strategy name in the registry before the switch — if found, delegates to the registered function, passing `eligible` candidates, `count`, and any extra options. Registered strategies are ephemeral (lost on restart); plugins re-register in `onWorkflowResume`.

Built-in strategies are pre-loaded into the registry at construction using the same `StrategyFn` signature.

---

### Gap 6 — Rich Filtering via list()

**Current:** `list()` does not exist. `getAll()` returns everything; specialized methods exist for confirmed/falsified only.

**Target:** Add `list(filters?: PoolFilters): PoolCandidate[]` and deprecate `getAll()`, `getConfirmed()`, `getFalsified()` (keep as thin wrappers for one release).

```typescript
interface PoolFilters {
  status?: CandidateStatus | CandidateStatus[];
  generationRange?: [min: number, max: number];
  fitnessRange?: [min: number, max: number];
  hasParent?: string;           // must have this ID as a direct parent
  metadata?: Record<string, unknown>;  // shallow key=value match
}
```

`generationRange` is inclusive on both ends. `fitnessRange` uses `fitness.composite`. `metadata` filter matches if every key in the filter exists in `candidate.metadata` with a strictly equal value (no deep comparison). A candidate with `fitness === null` fails any `fitnessRange` filter.

`select()` is updated to accept `PoolFilters` in addition to the existing `SelectionOptions.statusFilter` and `excludeIds`. When `filters` is provided, it replaces `statusFilter` (the two mechanisms are not combined).

---

### Gap 7 — Descendants Lineage Query

**Current:** `getLineage(id)` walks ancestors only (follows `parentIds` backward). No direction parameter, no depth limit.

**Target:** `getLineage(id, direction?, maxDepth?)` with `direction: 'ancestors' | 'descendants'` (default `'ancestors'`) and `maxDepth?: number` (default unlimited).

```typescript
getLineage(
  id: string,
  direction?: 'ancestors' | 'descendants',
  maxDepth?: number
): PoolCandidate[];
```

**Descendants implementation:** Requires a reverse index — a `Map<string, Set<string>>` mapping each candidate ID to the set of IDs whose `parentIds` contain it. This index is:
- Populated incrementally in `add()` when parents are provided.
- Rebuilt from scratch in `restore()` by walking all candidates.
- Used in `getLineage()` when `direction === 'descendants'`: BFS forward through children up to `maxDepth` levels.

`maxDepth` applies to both directions. Depth 1 = direct parents/children only. Depth 0 is treated as unlimited (consistent with "no limit specified").

---

### Gap 8 — Candidate Deduplication

**Current:** No deduplication. Two identical payloads in the same generation create two candidates with different counter IDs.

**Target:** `add()` computes the content hash (Gap 1 logic). If a candidate with that ID already exists in the pool, the method returns the existing ID without inserting a duplicate. A deduplication event is logged via the injected logger (if present).

**Signature change for add():**

```typescript
// Before (current):
add(candidate: Omit<PoolCandidate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): string

// After:
add(
  payload: Record<string, unknown>,
  parents: string[],
  generation: number,
  metadata?: Record<string, unknown>
): string  // returns id of inserted or existing candidate
```

The new signature aligns with the design doc (Section 3.1). The `content: string` field is replaced by `payload: Record<string, unknown>` (also part of the design alignment). The `FitnessScore` object remains for composite+dimensions tracking; initial fitness is `null` / `{ composite: 0, dimensions: {} }` on add.

---

## 3. Data Model Changes Summary

| Field | Before | After |
|-------|--------|-------|
| `id` | `C-{n}` counter | `cand-{gen}-{hash8}` |
| `content: string` | natural language string | removed; use `payload` |
| `payload` | absent | `Record<string, unknown>` (domain data) |
| `status` | 6-value set (wrong names) | 6-value set per design doc |
| `parentIds` | present | renamed `parents` to match design doc |
| `fitness.composite` | number | number (kept; `null` initial) |

`FitnessScore` with `composite` + `dimensions` is retained as it is more expressive than a bare `number`. The `stats()` fitness metrics use `fitness.composite`.

---

## 4. Dependency Map

```
Gap 1 (ID format)
  └── Gap 8 (deduplication) — requires hash-based IDs to deduplicate
  └── Gap 4 (status rename) — add() sets status to 'pending_evaluation'

Gap 7 (descendants) — requires reverse index
  └── built in add() / restore()

Gap 3 (auto-update) — requires Gap 4 statuses ('active', 'falsified')
  └── dag-executor.ts change

Gap 5 (strategy registry) — prerequisite for Gap 6 select() options
Gap 6 (list + filters) — standalone but list() used by stats() helpers
Gap 2 (stats) — standalone, reads from candidate map
```

Implementation order that respects dependencies: 4 → 1 → 8 → 7 → 2 → 6 → 5 → 3.

---

## 5. Non-Goals

- No migration of existing pool snapshots. Workflows that have live runs with old format IDs will not have those snapshots automatically converted.
- No multi-population / island model support (open question in design doc Section 10).
- No schema validation of candidate payloads.
- No persistence format change (JSON remains).
