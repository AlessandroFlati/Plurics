/**
 * Conjecture DSL for Sequence Explorer (OEIS).
 *
 * A conjecture is a hypothesized generating rule for an integer sequence.
 * The Conjecturer produces conjectures; downstream agents verify and score them.
 */

export type ConjectureType =
  | 'closed_form'            // a(n) = explicit formula in n
  | 'linear_recurrence'      // a(n) = sum of c_i * a(n-i)
  | 'generating_function'    // G(x) = sum of a(n) x^n has closed form
  | 'combinatorial_identity' // a(n) counts something
  | 'asymptotic_bound';      // a(n) ~ f(n) as n → ∞

export type ConjectureStatus =
  | 'proposed'        // Emitted by the Conjecturer, not yet evaluated
  | 'filtered_out'    // Rejected by the quick_filter (sanity check)
  | 'verified'        // Formula predicts known terms correctly
  | 'partially_verified' // Works for some terms but not all
  | 'falsified'       // Wrong on at least one known term
  | 'inconclusive'    // Verifier crashed or timed out
  | 'superseded';     // Replaced by a better descendant

export interface Conjecture {
  id: string;                     // C-001, C-002, ...
  generation: number;             // Round in which it was generated
  parent_ids: string[];           // Lineage for evolutionary tracking
  target_sequence: string;        // OEIS ID (e.g. "A000045")

  type: ConjectureType;
  title: string;                  // Short human-readable label
  natural_language: string;       // Full description
  formula: string;                // Mathematical expression in LaTeX-ish notation
  python_body: string;            // Python function body that computes a(n) —
                                  // formalizer fills this in

  // Metadata set by downstream agents
  status: ConjectureStatus;
  created_at: string;             // ISO-8601
}

export interface FitnessDimensions {
  /** Fraction of known terms the formula predicts correctly. [0, 1] */
  empirical: number;
  /** Elegance / parsimony — inversely proportional to formula complexity. [0, 1] */
  elegance: number;
  /** 1.0 if novel (not a rediscovery of a known OEIS formula), 0.5 if related, 0 if known. */
  novelty: number;
  /** Estimated formalizability in Lean 4. [0, 1] */
  provability: number;
}

export interface FitnessScore extends FitnessDimensions {
  /** Weighted composite. Default weights: empirical 0.4, novelty 0.3, elegance 0.2, provability 0.1. */
  composite: number;
}

export const DEFAULT_FITNESS_WEIGHTS: Record<keyof FitnessDimensions, number> = {
  empirical: 0.4,
  novelty: 0.3,
  elegance: 0.2,
  provability: 0.1,
};
