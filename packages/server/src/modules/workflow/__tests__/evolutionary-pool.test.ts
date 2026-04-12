/**
 * Comprehensive unit tests for EvolutionaryPool (T15).
 * Covers: content-hash IDs, deduplication, 7-status lifecycle,
 * stats(), list(filters), descendants lineage, custom strategy.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvolutionaryPool,
  computeCompositeFitness,
} from '../evolutionary-pool.js';
import type {
  CandidateStatus,
  PoolCandidate,
  StrategyFn,
} from '../evolutionary-pool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(): EvolutionaryPool {
  return new EvolutionaryPool();
}

// ---------------------------------------------------------------------------
// Content-hash IDs
// ---------------------------------------------------------------------------

describe('content-hash ID generation', () => {
  it('produces cand-{generation}-{8hex} format', () => {
    const pool = makePool();
    const id = pool.add({ x: 1 }, [], 0);
    expect(id).toMatch(/^cand-0-[0-9a-f]{8}$/);
  });

  it('same payload + generation always yields the same ID', () => {
    const pool = makePool();
    const id1 = pool.add({ a: 1, b: 2 }, [], 3);
    pool.clear();
    const id2 = pool.add({ a: 1, b: 2 }, [], 3);
    expect(id1).toBe(id2);
  });

  it('key order in payload does not affect the ID (sorted)', () => {
    const pool = makePool();
    const id1 = pool.add({ a: 1, b: 2 }, [], 0);
    pool.clear();
    const id2 = pool.add({ b: 2, a: 1 }, [], 0);
    expect(id1).toBe(id2);
  });

  it('different generation yields different ID for same payload', () => {
    const pool = makePool();
    const id1 = pool.add({ a: 1 }, [], 0);
    pool.clear();
    const id2 = pool.add({ a: 1 }, [], 1);
    expect(id1).not.toBe(id2);
    expect(id2).toMatch(/^cand-1-/);
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('deduplication', () => {
  it('adding the same payload+generation twice returns the same ID and does not double-add', () => {
    const pool = makePool();
    const id1 = pool.add({ conjecture: 'test' }, [], 0);
    const id2 = pool.add({ conjecture: 'test' }, [], 0);
    expect(id1).toBe(id2);
    expect(pool.count()).toBe(1);
  });

  it('different payload produces a new candidate', () => {
    const pool = makePool();
    const id1 = pool.add({ conjecture: 'A' }, [], 0);
    const id2 = pool.add({ conjecture: 'B' }, [], 0);
    expect(id1).not.toBe(id2);
    expect(pool.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6-status lifecycle
// ---------------------------------------------------------------------------

describe('status lifecycle', () => {
  it('new candidate starts with status pending_evaluation', () => {
    const pool = makePool();
    const id = pool.add({ x: 1 }, [], 0);
    expect(pool.get(id)?.status).toBe('pending_evaluation');
  });

  it('updateStatus transitions to any valid status', () => {
    const pool = makePool();
    const id = pool.add({ x: 1 }, [], 0);
    const statuses: CandidateStatus[] = [
      'active', 'confirmed', 'falsified', 'pruned', 'archived', 'pending_evaluation',
    ];
    for (const s of statuses) {
      pool.updateStatus(id, s);
      expect(pool.get(id)?.status).toBe(s);
    }
  });

  it('updateStatus throws for unknown candidate', () => {
    const pool = makePool();
    expect(() => pool.updateStatus('nonexistent', 'active')).toThrow('Candidate not found');
  });

  it('updateFitness updates composite and optional status', () => {
    const pool = makePool();
    const id = pool.add({ x: 1 }, [], 0);
    pool.updateFitness(id, 0.75, 'active');
    const c = pool.get(id)!;
    expect(c.fitness.composite).toBe(0.75);
    expect(c.status).toBe('active');
  });

  it('updateFitness without status keeps existing status', () => {
    const pool = makePool();
    const id = pool.add({ x: 1 }, [], 0);
    pool.updateFitness(id, 0.5);
    expect(pool.get(id)?.status).toBe('pending_evaluation');
  });

  it('updateFitness throws for unknown candidate', () => {
    const pool = makePool();
    expect(() => pool.updateFitness('nonexistent', 0.9)).toThrow('Candidate not found');
  });
});

// ---------------------------------------------------------------------------
// stats()
// ---------------------------------------------------------------------------

describe('stats()', () => {
  it('returns zeros for empty pool', () => {
    const pool = makePool();
    const s = pool.stats();
    expect(s.total).toBe(0);
    expect(s.byStatus.pending_evaluation).toBe(0);
    expect(s.meanFitness).toBeNull();
    expect(s.oldestActive).toBeNull();
  });

  it('counts totals and byStatus correctly', () => {
    const pool = makePool();
    const id1 = pool.add({ x: 1 }, [], 0);
    const id2 = pool.add({ x: 2 }, [], 0);
    pool.updateFitness(id1, 0.5, 'active');
    pool.updateFitness(id2, 0.8, 'active');
    const s = pool.stats();
    expect(s.total).toBe(2);
    expect(s.byStatus.active).toBe(2);
    expect(s.byStatus.pending_evaluation).toBe(0);
    expect(s.meanFitness).toBeCloseTo(0.65, 5);
    expect(s.maxFitness).toBe(0.8);
    expect(s.minFitness).toBe(0.5);
  });

  it('byGeneration counts per generation', () => {
    const pool = makePool();
    pool.add({ x: 1 }, [], 0);
    pool.add({ x: 2 }, [], 0);
    pool.add({ x: 3 }, [], 1);
    const s = pool.stats();
    expect(s.byGeneration[0]).toBe(2);
    expect(s.byGeneration[1]).toBe(1);
  });

  it('oldestActive and newestActive are valid ISO strings', () => {
    const pool = makePool();
    const id1 = pool.add({ x: 1 }, [], 0);
    const id2 = pool.add({ x: 2 }, [], 0);
    pool.updateStatus(id1, 'active');
    pool.updateStatus(id2, 'active');
    const s = pool.stats();
    expect(s.oldestActive).not.toBeNull();
    expect(s.newestActive).not.toBeNull();
    expect(() => new Date(s.oldestActive!)).not.toThrow();
  });

  it('excludes pending_evaluation candidates from fitness when fitness is 0', () => {
    const pool = makePool();
    pool.add({ x: 1 }, [], 0); // pending_evaluation, fitness=0 — excluded
    const s = pool.stats();
    expect(s.meanFitness).toBeNull(); // nothing to average
  });
});

// ---------------------------------------------------------------------------
// list(filters)
// ---------------------------------------------------------------------------

describe('list(filters)', () => {
  let pool: EvolutionaryPool;
  let id1: string, id2: string, id3: string;

  beforeEach(() => {
    pool = makePool();
    id1 = pool.add({ topic: 'math' }, [], 0);
    id2 = pool.add({ topic: 'physics' }, [id1], 1);
    id3 = pool.add({ topic: 'chem' }, [id1], 2);
    pool.updateFitness(id1, 0.9, 'confirmed');
    pool.updateFitness(id2, 0.5, 'active');
    pool.updateFitness(id3, 0.3, 'falsified');
  });

  it('no filters returns all candidates', () => {
    expect(pool.list()).toHaveLength(3);
  });

  it('filters by single status', () => {
    const result = pool.list({ status: 'active' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(id2);
  });

  it('filters by array of statuses', () => {
    const result = pool.list({ status: ['active', 'confirmed'] });
    expect(result).toHaveLength(2);
  });

  it('filters by generationRange', () => {
    const result = pool.list({ generationRange: [1, 2] });
    expect(result).toHaveLength(2);
    expect(result.every(c => c.generation >= 1 && c.generation <= 2)).toBe(true);
  });

  it('filters by fitnessRange', () => {
    const result = pool.list({ fitnessRange: [0.4, 1.0] });
    expect(result).toHaveLength(2);
    expect(result.some(c => c.id === id1)).toBe(true);
    expect(result.some(c => c.id === id2)).toBe(true);
  });

  it('filters by hasParent', () => {
    const result = pool.list({ hasParent: id1 });
    expect(result).toHaveLength(2);
    expect(result.every(c => c.parents.includes(id1))).toBe(true);
  });

  it('filters by metadata', () => {
    const pool2 = makePool();
    pool2.add({ x: 1 }, [], 0, { topic: 'primes' });
    pool2.add({ x: 2 }, [], 0, { topic: 'composites' });
    const result = pool2.list({ metadata: { topic: 'primes' } });
    expect(result).toHaveLength(1);
    expect(result[0].metadata.topic).toBe('primes');
  });

  it('combined filters work together', () => {
    const result = pool.list({ status: 'active', generationRange: [1, 1] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// descendants lineage (getLineage)
// ---------------------------------------------------------------------------

describe('getLineage()', () => {
  let pool: EvolutionaryPool;
  let idA: string, idB: string, idC: string, idD: string;

  beforeEach(() => {
    pool = makePool();
    // Graph: A -> B -> C, A -> D
    idA = pool.add({ label: 'A' }, [], 0);
    idB = pool.add({ label: 'B' }, [idA], 1);
    idC = pool.add({ label: 'C' }, [idB], 2);
    idD = pool.add({ label: 'D' }, [idA], 1);
  });

  it('ancestors of C: [B, A]', () => {
    const result = pool.getLineage(idC, 'ancestors');
    const ids = result.map(c => c.id);
    expect(ids).toContain(idB);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(idC);
    expect(ids).not.toContain(idD);
  });

  it('descendants of A: [B, C, D]', () => {
    const result = pool.getLineage(idA, 'descendants');
    const ids = result.map(c => c.id);
    expect(ids).toContain(idB);
    expect(ids).toContain(idC);
    expect(ids).toContain(idD);
    expect(ids).not.toContain(idA);
  });

  it('descendants of A with maxDepth=1: only direct children [B, D]', () => {
    const result = pool.getLineage(idA, 'descendants', 1);
    const ids = result.map(c => c.id);
    expect(ids).toContain(idB);
    expect(ids).toContain(idD);
    expect(ids).not.toContain(idC);
  });

  it('root node with no parents returns empty ancestors', () => {
    expect(pool.getLineage(idA, 'ancestors')).toHaveLength(0);
  });

  it('leaf node with no children returns empty descendants', () => {
    expect(pool.getLineage(idC, 'descendants')).toHaveLength(0);
  });

  it('default direction is ancestors', () => {
    const result = pool.getLineage(idC);
    expect(result.map(c => c.id)).toContain(idB);
  });
});

// ---------------------------------------------------------------------------
// Custom strategy via registerStrategy()
// ---------------------------------------------------------------------------

describe('registerStrategy()', () => {
  it('custom strategy is called during select()', () => {
    const pool = makePool();
    const id1 = pool.add({ x: 1 }, [], 0);
    const id2 = pool.add({ x: 2 }, [], 0);
    pool.updateFitness(id1, 0.5, 'active');
    pool.updateFitness(id2, 0.9, 'active');

    const alwaysFirst: StrategyFn = (pop) => [pop[0]];
    pool.registerStrategy('always_first', alwaysFirst);

    const result = pool.select({ strategy: 'always_first', k: 1 });
    expect(result).toHaveLength(1);
  });

  it('unknown strategy throws when k < eligible count', () => {
    const pool = makePool();
    const id1 = pool.add({ x: 1 }, [], 0);
    const id2 = pool.add({ x: 2 }, [], 0);
    pool.updateStatus(id1, 'active');
    pool.updateStatus(id2, 'active');
    // k=1 < eligible=2, so the strategy lookup is reached
    expect(() => pool.select({ strategy: 'nonexistent', k: 1 })).toThrow('Unknown selection strategy');
  });

  it('can override a built-in strategy name', () => {
    const pool = makePool();
    const id1 = pool.add({ x: 1 }, [], 0);
    const id2 = pool.add({ x: 2 }, [], 0);
    pool.updateStatus(id1, 'active');
    pool.updateStatus(id2, 'active');

    let called = false;
    // k=1 < eligible=2, so strategy function is invoked
    pool.registerStrategy('top-k', (pop, k) => { called = true; return pop.slice(0, k); });
    pool.select({ strategy: 'top-k', k: 1 });
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Built-in selection strategies
// ---------------------------------------------------------------------------

describe('built-in selection strategies', () => {
  function populatedPool(): { pool: EvolutionaryPool; ids: string[] } {
    const pool = makePool();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = pool.add({ i }, [], 0);
      pool.updateFitness(id, (i + 1) * 0.1, 'active');
      ids.push(id);
    }
    return { pool, ids };
  }

  it('top-k returns k candidates sorted by fitness desc', () => {
    const { pool } = populatedPool();
    const result = pool.select({ strategy: 'top-k', k: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].fitness.composite).toBeGreaterThanOrEqual(result[1].fitness.composite);
  });

  it('random returns k distinct candidates', () => {
    const { pool } = populatedPool();
    const result = pool.select({ strategy: 'random', k: 3 });
    expect(result).toHaveLength(3);
    const ids = result.map(c => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('tournament returns k candidates', () => {
    const { pool } = populatedPool();
    const result = pool.select({ strategy: 'tournament', k: 2, tournamentSize: 3 });
    expect(result).toHaveLength(2);
  });

  it('roulette returns k candidates', () => {
    const { pool } = populatedPool();
    const result = pool.select({ strategy: 'roulette', k: 2 });
    expect(result).toHaveLength(2);
  });

  it('select returns all if k >= eligible count', () => {
    const { pool } = populatedPool();
    const result = pool.select({ strategy: 'top-k', k: 100 });
    expect(result).toHaveLength(5);
  });

  it('select with filters applies PoolFilters', () => {
    const pool = makePool();
    const id1 = pool.add({ x: 1 }, [], 0);
    const id2 = pool.add({ x: 2 }, [], 0);
    pool.updateFitness(id1, 0.9, 'confirmed');
    pool.updateFitness(id2, 0.5, 'active');

    const result = pool.select({ strategy: 'top-k', k: 5, filters: { status: 'confirmed' } });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(id1);
  });
});

// ---------------------------------------------------------------------------
// snapshot() and restore()
// ---------------------------------------------------------------------------

describe('snapshot() / restore()', () => {
  it('restores all candidates and rebuilds children index', () => {
    const pool = makePool();
    const id1 = pool.add({ x: 1 }, [], 0);
    const id2 = pool.add({ x: 2 }, [id1], 1);
    pool.updateFitness(id1, 0.9, 'confirmed');

    const snap = pool.snapshot();
    expect(snap.schema_version).toBe(1);

    const pool2 = makePool();
    pool2.restore(snap);

    expect(pool2.count()).toBe(2);
    expect(pool2.get(id1)?.fitness.composite).toBe(0.9);
    expect(pool2.get(id1)?.status).toBe('confirmed');

    // Children index rebuilt
    const descendants = pool2.getLineage(id1, 'descendants');
    expect(descendants.map(c => c.id)).toContain(id2);
  });

  it('restore clears previous state', () => {
    const pool = makePool();
    pool.add({ x: 99 }, [], 0);

    const snap = pool.snapshot();
    const pool2 = makePool();
    pool2.add({ y: 100 }, [], 0);
    pool2.restore(snap); // should clear the y:100 candidate

    expect(pool2.count()).toBe(1);
    expect(pool2.list()[0].payload).toEqual({ x: 99 });
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

describe('clear()', () => {
  it('removes all candidates and children index', () => {
    const pool = makePool();
    const id1 = pool.add({ x: 1 }, [], 0);
    pool.add({ x: 2 }, [id1], 1);
    pool.clear();
    expect(pool.count()).toBe(0);
    expect(pool.getLineage(id1, 'descendants')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeCompositeFitness helper
// ---------------------------------------------------------------------------

describe('computeCompositeFitness()', () => {
  it('computes weighted average', () => {
    const result = computeCompositeFitness(
      { accuracy: 0.8, speed: 0.6 },
      { accuracy: 2, speed: 1 },
    );
    expect(result).toBeCloseTo((0.8 * 2 + 0.6 * 1) / 3, 5);
  });

  it('returns 0 for no matching weights', () => {
    expect(computeCompositeFitness({ x: 1 }, {})).toBe(0);
  });

  it('ignores dimensions with no weight', () => {
    const result = computeCompositeFitness({ a: 0.5, b: 0.9 }, { a: 1 });
    expect(result).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// T16: Integration test — onEvaluationResult pool auto-update
// ---------------------------------------------------------------------------

describe('T16: onEvaluationResult pool auto-update (unit simulation)', () => {
  /**
   * Simulates the dag-executor's onEvaluationResult logic in isolation.
   * The executor: BEFORE calling plugin hook, if pool.get(candidateId) exists,
   * calls pool.updateFitness(candidateId, fitness, autoStatus).
   */
  function simulateEvaluationResult(
    pool: EvolutionaryPool,
    candidateId: string,
    fitness: number,
    verdict: 'pass' | 'fail' | 'inconclusive',
  ): void {
    if (pool.get(candidateId)) {
      const autoStatus: CandidateStatus = verdict === 'fail' ? 'falsified' : 'active';
      pool.updateFitness(candidateId, fitness, autoStatus);
    }
  }

  it('passing verdict sets status to active with correct fitness', () => {
    const pool = makePool();
    const id = pool.add({ hypothesis: 'H1' }, [], 0);
    simulateEvaluationResult(pool, id, 0.85, 'pass');
    const c = pool.get(id)!;
    expect(c.fitness.composite).toBe(0.85);
    expect(c.status).toBe('active');
  });

  it('fail verdict sets status to falsified', () => {
    const pool = makePool();
    const id = pool.add({ hypothesis: 'H2' }, [], 0);
    simulateEvaluationResult(pool, id, 0.1, 'fail');
    const c = pool.get(id)!;
    expect(c.fitness.composite).toBe(0.1);
    expect(c.status).toBe('falsified');
  });

  it('inconclusive verdict sets status to active', () => {
    const pool = makePool();
    const id = pool.add({ hypothesis: 'H3' }, [], 0);
    simulateEvaluationResult(pool, id, 0.5, 'inconclusive');
    const c = pool.get(id)!;
    expect(c.status).toBe('active');
  });

  it('unknown candidateId is a no-op (pool.get returns undefined)', () => {
    const pool = makePool();
    // Should not throw
    expect(() => simulateEvaluationResult(pool, 'ghost-id', 0.5, 'pass')).not.toThrow();
    expect(pool.count()).toBe(0);
  });
});
