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

export type CandidateStatus =
  | 'pending'      // Just added, not yet evaluated
  | 'testing'      // Evaluation in progress
  | 'confirmed'    // Passed all checks, become part of the knowledge base
  | 'falsified'    // Failed evaluation with clear counterexample
  | 'inconclusive' // Tested but neither confirmed nor falsified
  | 'superseded';  // Replaced by a stronger descendant

export interface FitnessScore {
  /** Overall composite score (weighted average). */
  composite: number;
  /** Individual dimensions — plugin defines which apply. */
  dimensions: Record<string, number>;
}

export interface PoolCandidate {
  id: string;
  content: string;                 // Natural language + formal representation
  fitness: FitnessScore;
  generation: number;              // Round in which it was generated
  parentIds: string[];             // Lineage (for mutation/crossover)
  status: CandidateStatus;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>; // Plugin-specific fields
}

export interface PoolSnapshot {
  version: number;
  timestamp: number;
  candidates: PoolCandidate[];
}

export type SelectionStrategy = 'tournament' | 'roulette' | 'top-k' | 'random';

export interface SelectionOptions {
  strategy: SelectionStrategy;
  k: number;
  /** For tournament: size of each tournament. */
  tournamentSize?: number;
  /** Filter which statuses are eligible. Default: all non-superseded. */
  statusFilter?: CandidateStatus[];
  /** Exclude specific IDs (e.g. already-processed). */
  excludeIds?: string[];
}

export class EvolutionaryPool {
  private candidates = new Map<string, PoolCandidate>();
  private idCounter = 0;

  /** Add a new candidate to the pool. Returns the candidate's ID. */
  add(candidate: Omit<PoolCandidate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): string {
    const id = candidate.id ?? this.generateId();
    const now = Date.now();
    const fullCandidate: PoolCandidate = {
      ...candidate,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.candidates.set(id, fullCandidate);
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

  /** Retrieve a candidate by ID. */
  get(id: string): PoolCandidate | undefined {
    return this.candidates.get(id);
  }

  /** Get all candidates (copy of internal state). */
  getAll(): PoolCandidate[] {
    return [...this.candidates.values()];
  }

  /** Count candidates, optionally filtered by status. */
  count(status?: CandidateStatus): number {
    if (!status) return this.candidates.size;
    return [...this.candidates.values()].filter(c => c.status === status).length;
  }

  /** Get all confirmed candidates (sorted by fitness descending). */
  getConfirmed(): PoolCandidate[] {
    return [...this.candidates.values()]
      .filter(c => c.status === 'confirmed')
      .sort((a, b) => b.fitness.composite - a.fitness.composite);
  }

  /** Get all falsified candidates (for negative examples). */
  getFalsified(): PoolCandidate[] {
    return [...this.candidates.values()]
      .filter(c => c.status === 'falsified')
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get the lineage (ancestors) of a candidate.
   * Returns the candidate itself plus all recursively-resolved parents.
   */
  getLineage(id: string): PoolCandidate[] {
    const result: PoolCandidate[] = [];
    const visited = new Set<string>();
    const queue = [id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const candidate = this.candidates.get(current);
      if (candidate) {
        result.push(candidate);
        queue.push(...candidate.parentIds);
      }
    }
    return result;
  }

  /** Select candidates for exploration using the configured strategy. */
  select(options: SelectionOptions): PoolCandidate[] {
    const eligible = this.getEligible(options);
    if (eligible.length === 0) return [];
    if (options.k >= eligible.length) return [...eligible];

    switch (options.strategy) {
      case 'top-k':
        return this.topK(eligible, options.k);
      case 'tournament':
        return this.tournament(eligible, options.k, options.tournamentSize ?? 3);
      case 'roulette':
        return this.roulette(eligible, options.k);
      case 'random':
        return this.randomSelect(eligible, options.k);
      default:
        throw new Error(`Unknown selection strategy: ${options.strategy}`);
    }
  }

  /** Select candidates to use as negative examples (falsified, most recent first). */
  selectAsNegativeExamples(k: number): PoolCandidate[] {
    return this.getFalsified().slice(0, k);
  }

  /** Select top-k candidates for positive context. */
  selectForContext(k: number): PoolCandidate[] {
    return this.getConfirmed().slice(0, k);
  }

  /** Mark a candidate as superseded by a descendant. */
  markSuperseded(id: string, replacedBy: string): void {
    this.update(id, { status: 'superseded', metadata: { replacedBy } });
  }

  /** Serialize to a snapshot (for persistence/resume). */
  snapshot(): PoolSnapshot {
    return {
      version: 1,
      timestamp: Date.now(),
      candidates: [...this.candidates.values()],
    };
  }

  /** Restore state from a snapshot (for resume). */
  restore(snapshot: PoolSnapshot): void {
    this.candidates.clear();
    for (const c of snapshot.candidates) {
      this.candidates.set(c.id, c);
    }
    // Reset ID counter so new candidates don't collide
    const maxNumericId = snapshot.candidates
      .map(c => parseInt(c.id.replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n))
      .reduce((a, b) => Math.max(a, b), 0);
    this.idCounter = maxNumericId;
  }

  /** Clear all state (for testing). */
  clear(): void {
    this.candidates.clear();
    this.idCounter = 0;
  }

  // ----- private helpers -----

  private generateId(): string {
    this.idCounter += 1;
    return `C-${String(this.idCounter).padStart(3, '0')}`;
  }

  private getEligible(options: SelectionOptions): PoolCandidate[] {
    const statuses = options.statusFilter ?? ['confirmed', 'pending', 'inconclusive'];
    const excluded = new Set(options.excludeIds ?? []);
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
