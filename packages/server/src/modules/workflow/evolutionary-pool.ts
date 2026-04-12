/**
 * EvolutionaryPool — population manager for discovery workflows.
 *
 * Maintains a pool of candidates (hypotheses, conjectures, code variants, etc.)
 * with fitness scores and lineage tracking. Supports multiple selection strategies
 * for evolutionary loops.
 *
 * This is a Layer 2 SDK module — workflow plugins use it for domain-specific
 * evolutionary behaviors. The platform persists the pool as pool-state.json.
 */

import { createHash } from 'node:crypto';

// T01: Updated CandidateStatus to design-spec values
export type CandidateStatus =
  | 'pending_evaluation' // Just added, not yet evaluated
  | 'active'             // Evaluation in progress or inconclusive — still eligible
  | 'confirmed'          // Passed all checks, became part of the knowledge base
  | 'falsified'          // Failed evaluation with clear counterexample
  | 'pruned'             // Replaced by a stronger descendant (was: superseded)
  | 'archived';          // Retired from active use

export interface FitnessScore {
  /** Overall composite score (weighted average). */
  composite: number;
  /** Individual dimensions — plugin defines which apply. */
  dimensions: Record<string, number>;
}

// T02: payload replaces content; T03: parents replaces parentIds
export interface PoolCandidate {
  id: string;
  payload: Record<string, unknown>; // Structured candidate data (was: content: string)
  fitness: FitnessScore;
  generation: number;               // Round in which it was generated
  parents: string[];                // Lineage (was: parentIds)
  status: CandidateStatus;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>; // Plugin-specific fields
}

// T10: schema_version added
export interface PoolSnapshot {
  schema_version: 1;
  version: number;
  timestamp: number;
  candidates: PoolCandidate[];
}

// T09: PoolFilters for list()
export interface PoolFilters {
  status?: CandidateStatus | CandidateStatus[];
  generationRange?: [min: number, max: number];
  fitnessRange?: [min: number, max: number];
  hasParent?: string;
  metadata?: Record<string, unknown>;
}

// T08: PoolStats for stats()
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

// T10: StrategyFn type for registerStrategy
export type StrategyFn = (
  population: PoolCandidate[],
  count: number,
  options?: Record<string, unknown>
) => PoolCandidate[];

export type SelectionStrategy = 'tournament' | 'roulette' | 'top-k' | 'random' | string;

export interface SelectionOptions {
  strategy: SelectionStrategy;
  k: number;
  /** For tournament: size of each tournament. */
  tournamentSize?: number;
  /** Filter which statuses are eligible. Default: active, confirmed, pending_evaluation. */
  statusFilter?: CandidateStatus[];
  /** Exclude specific IDs (e.g. already-processed). */
  excludeIds?: string[];
  /** Optional structured filters (takes precedence over statusFilter when status is set). */
  filters?: PoolFilters;
}

// T04: Content-hash ID generator
function generateCandidateId(payload: Record<string, unknown>, generation: number): string {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  const hash = createHash('sha256').update(stable).digest('hex').slice(0, 8);
  return `cand-${generation}-${hash}`;
}

export class EvolutionaryPool {
  private candidates = new Map<string, PoolCandidate>();
  // T07: reverse index for descendants lineage
  private childrenIndex = new Map<string, Set<string>>();
  // T10: strategy registry
  private strategyRegistry = new Map<string, StrategyFn>();

  constructor() {
    // Pre-register built-in strategies
    this.strategyRegistry.set('top-k', (pop, k) => this.topK(pop, k));
    this.strategyRegistry.set('tournament', (pop, k, opts) =>
      this.tournament(pop, k, (opts?.tournamentSize as number) ?? 3));
    this.strategyRegistry.set('roulette', (pop, k) => this.roulette(pop, k));
    this.strategyRegistry.set('random', (pop, k) => this.randomSelect(pop, k));
  }

  // T05: New add() signature with deduplication
  add(
    payload: Record<string, unknown>,
    parents: string[],
    generation: number,
    metadata: Record<string, unknown> = {}
  ): string {
    const id = generateCandidateId(payload, generation);

    if (this.candidates.has(id)) {
      // Deduplication: return existing candidate unchanged
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

    // Update reverse index for descendants lineage
    for (const parentId of parents) {
      if (!this.childrenIndex.has(parentId)) {
        this.childrenIndex.set(parentId, new Set());
      }
      this.childrenIndex.get(parentId)!.add(id);
    }

    return id;
  }

  /** Update an existing candidate (fitness, status, metadata). */
  update(id: string, changes: Partial<Omit<PoolCandidate, 'id' | 'createdAt'>>): void {
    const existing = this.candidates.get(id);
    if (!existing) throw new Error(`Candidate not found: ${id}`);
    this.candidates.set(id, {
      ...existing,
      ...changes,
      updatedAt: Date.now(),
    });
  }

  // T06: updateFitness method
  updateFitness(id: string, fitness: number, status?: CandidateStatus): void {
    const existing = this.candidates.get(id);
    if (!existing) throw new Error(`Candidate not found: ${id}`);
    this.candidates.set(id, {
      ...existing,
      fitness: { ...existing.fitness, composite: fitness },
      ...(status !== undefined ? { status } : {}),
      updatedAt: Date.now(),
    });
  }

  // T06: updateStatus method
  updateStatus(id: string, status: CandidateStatus): void {
    const existing = this.candidates.get(id);
    if (!existing) throw new Error(`Candidate not found: ${id}`);
    this.candidates.set(id, {
      ...existing,
      status,
      updatedAt: Date.now(),
    });
  }

  /** Retrieve a candidate by ID. */
  get(id: string): PoolCandidate | undefined {
    return this.candidates.get(id);
  }

  /**
   * @deprecated Use list() instead.
   */
  getAll(): PoolCandidate[] {
    return [...this.candidates.values()];
  }

  /** Count candidates, optionally filtered by status. */
  count(status?: CandidateStatus): number {
    if (!status) return this.candidates.size;
    return [...this.candidates.values()].filter(c => c.status === status).length;
  }

  /**
   * Get all confirmed candidates (sorted by fitness descending).
   * @deprecated Use list({ status: 'confirmed' }) instead.
   */
  getConfirmed(): PoolCandidate[] {
    return [...this.candidates.values()]
      .filter(c => c.status === 'confirmed')
      .sort((a, b) => b.fitness.composite - a.fitness.composite);
  }

  /**
   * Get all falsified candidates (for negative examples).
   * @deprecated Use list({ status: 'falsified' }) instead.
   */
  getFalsified(): PoolCandidate[] {
    return [...this.candidates.values()]
      .filter(c => c.status === 'falsified')
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // T07: Extended getLineage with direction and maxDepth (BFS)
  getLineage(
    id: string,
    direction: 'ancestors' | 'descendants' = 'ancestors',
    maxDepth?: number
  ): PoolCandidate[] {
    const result: PoolCandidate[] = [];
    const visited = new Set<string>();
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

  // T08: stats() method
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

  // T09: list(filters?) method
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

  // T10: registerStrategy()
  registerStrategy(name: string, fn: StrategyFn): void {
    this.strategyRegistry.set(name, fn);
  }

  /** Select candidates for exploration using the configured strategy. */
  select(options: SelectionOptions): PoolCandidate[] {
    const eligible = this.getEligible(options);
    if (eligible.length === 0) return [];
    if (options.k >= eligible.length) return [...eligible];

    const fn = this.strategyRegistry.get(options.strategy);
    if (fn) return fn(eligible, options.k, options as unknown as Record<string, unknown>);

    throw new Error(`Unknown selection strategy: ${options.strategy}`);
  }

  /** Select candidates to use as negative examples (falsified, most recent first). */
  selectAsNegativeExamples(k: number): PoolCandidate[] {
    return this.getFalsified().slice(0, k);
  }

  /** Select top-k candidates for positive context. */
  selectForContext(k: number): PoolCandidate[] {
    return this.getConfirmed().slice(0, k);
  }

  /** Serialize to a snapshot (for persistence/resume). */
  snapshot(): PoolSnapshot {
    return {
      schema_version: 1,
      version: 1,
      timestamp: Date.now(),
      candidates: [...this.candidates.values()],
    };
  }

  /** Restore state from a snapshot (for resume). T10: handles new fields + rebuilds childrenIndex. */
  restore(snapshot: PoolSnapshot): void {
    this.candidates.clear();
    this.childrenIndex.clear();
    for (const c of snapshot.candidates) {
      this.candidates.set(c.id, c);
    }
    // Rebuild reverse children index
    for (const c of snapshot.candidates) {
      for (const parentId of c.parents) {
        if (!this.childrenIndex.has(parentId)) {
          this.childrenIndex.set(parentId, new Set());
        }
        this.childrenIndex.get(parentId)!.add(c.id);
      }
    }
  }

  /** Clear all state (for testing). */
  clear(): void {
    this.candidates.clear();
    this.childrenIndex.clear();
  }

  // ----- private helpers -----

  private getEligible(options: SelectionOptions): PoolCandidate[] {
    const excluded = new Set(options.excludeIds ?? []);

    // If structured filters provided and include status, use list() for filtering
    if (options.filters) {
      return this.list(options.filters).filter(c => !excluded.has(c.id));
    }

    const statuses = options.statusFilter ?? ['active', 'confirmed', 'pending_evaluation'];
    return [...this.candidates.values()]
      .filter(c => statuses.includes(c.status) && !excluded.has(c.id));
  }

  private topK(candidates: PoolCandidate[], k: number): PoolCandidate[] {
    return [...candidates]
      .sort((a, b) => b.fitness.composite - a.fitness.composite)
      .slice(0, k);
  }

  private tournament(candidates: PoolCandidate[], k: number, tournamentSize: number): PoolCandidate[] {
    const selected: PoolCandidate[] = [];
    const available = [...candidates];

    while (selected.length < k && available.length > 0) {
      const size = Math.min(tournamentSize, available.length);
      const indices: number[] = [];
      while (indices.length < size) {
        const idx = Math.floor(Math.random() * available.length);
        if (!indices.includes(idx)) indices.push(idx);
      }
      const contestants = indices.map(i => available[i]);
      const winner = contestants.reduce((best, c) =>
        c.fitness.composite > best.fitness.composite ? c : best,
      );
      selected.push(winner);
      // Remove winner from available to avoid duplicates
      const winnerIdx = available.indexOf(winner);
      available.splice(winnerIdx, 1);
    }
    return selected;
  }

  private roulette(candidates: PoolCandidate[], k: number): PoolCandidate[] {
    const selected: PoolCandidate[] = [];
    const available = [...candidates];

    while (selected.length < k && available.length > 0) {
      const totalFitness = available.reduce((sum, c) => sum + Math.max(c.fitness.composite, 0.001), 0);
      let r = Math.random() * totalFitness;
      let chosen = available[0];
      for (const c of available) {
        r -= Math.max(c.fitness.composite, 0.001);
        if (r <= 0) { chosen = c; break; }
      }
      selected.push(chosen);
      const idx = available.indexOf(chosen);
      available.splice(idx, 1);
    }
    return selected;
  }

  private randomSelect(candidates: PoolCandidate[], k: number): PoolCandidate[] {
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, k);
  }
}

/**
 * Compute a composite fitness score from weighted dimensions.
 * Plugins use this helper to turn their own metrics into a single number.
 */
export function computeCompositeFitness(
  dimensions: Record<string, number>,
  weights: Record<string, number>,
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [key, value] of Object.entries(dimensions)) {
    const w = weights[key] ?? 0;
    weightedSum += value * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
