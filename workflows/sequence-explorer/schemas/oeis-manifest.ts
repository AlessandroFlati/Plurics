/**
 * OEIS manifest — the profiled input sequence.
 */

export interface OeisManifest {
  schema_version: 1;
  oeis_id: string;                  // e.g. "A000045"
  name: string;                     // "Fibonacci numbers: F(n) = F(n-1) + F(n-2)"
  known_terms: number[];            // First N terms from OEIS
  known_terms_count: number;
  offset: number;                   // OEIS offset field (usually 0 or 1)

  // Metadata from OEIS
  formula_text: string[];           // Formula field lines from OEIS
  example_text: string[];           // Example field
  cross_references: string[];       // Other OEIS IDs mentioned in references
  keywords: string[];               // OEIS keywords (nonn, easy, core, ...)
  author: string;
  fetched_at: string;
}

export interface DataProfile {
  schema_version: 1;
  oeis_id: string;
  generated_at: string;

  // Growth analysis
  growth: {
    pattern: 'constant' | 'linear' | 'polynomial' | 'exponential' | 'super_exponential' | 'erratic';
    // Numeric estimates
    first_differences: number[];    // a(n+1) - a(n)
    ratios: number[];                // a(n+1) / a(n)
    log_slope: number | null;        // Slope of log(a(n)) vs n, if positive
    polynomial_degree_estimate: number | null;
  };

  // Residue patterns
  residues: {
    mod2: number[];
    mod3: number[];
    mod5: number[];
    periodicity: Record<string, number | null>;  // e.g. "mod2": 3 if period 3
  };

  // Candidate recurrence detection (linear regression on small windows)
  candidate_recurrences: Array<{
    order: number;
    coefficients: number[];           // [c_1, c_2, ..., c_order]
    residual: number;                 // L2 error of the fit
    fits_all_known: boolean;
  }>;

  // Analysis leads
  leads: Array<{
    priority: 'low' | 'medium' | 'high';
    description: string;
    suggested_conjecture_type: import('./conjecture.js').ConjectureType;
  }>;
}
