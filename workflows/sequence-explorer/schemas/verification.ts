/**
 * Verification result schemas — output of the Python `verifier.py` script.
 *
 * The verifier loads a formalizer-generated `sequence(n)` function and runs
 * two checks: empirical match against known terms and extrapolation to new
 * indices.
 */

export interface VerificationResult {
  conjecture_id: string;
  timestamp: string;

  // Empirical check
  known_terms_length: number;
  predicted_terms_match: number;     // Count of correctly predicted known terms
  empirical_score: number;            // predicted_terms_match / known_terms_length
  first_mismatch_index: number | null;
  first_mismatch_expected: number | string | null;
  first_mismatch_got: number | string | null;

  // Extrapolation (only if empirical_score == 1.0)
  extrapolated_terms: Array<number | string>;  // a(N..N+20)

  // Execution metadata
  execution_ms: number;
  execution_error: string | null;     // stderr or exception message if failed
  exit_code: number;
}

export interface CrossCheckResult {
  conjecture_id: string;
  timestamp: string;

  // Query: first 10-20 predicted terms
  query_terms: Array<number | string>;

  // OEIS response
  matched_sequences: Array<{
    oeis_id: string;           // "A000045"
    name: string;              // "Fibonacci numbers"
    is_exact_match: boolean;   // true if the query is a prefix of the OEIS sequence
  }>;

  /** "novel" if no match, "rediscovery" if exact match, "related" if partial match. */
  verdict: 'novel' | 'rediscovery' | 'related' | 'inconclusive';
  matched_target: boolean;     // true if the target sequence is in matches
  notes: string;
}
