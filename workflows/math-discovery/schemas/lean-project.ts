/**
 * Lean Project — types for managing the incremental Lean 4 project
 * that accumulates conjectures, proofs, and theorems.
 */

export interface LeanProjectStructure {
  /** Root directory of the Lean project (.plurics/shared/lean-project/). */
  root: string;
  /** Path to lakefile.lean. */
  lakefile: string;
  /** Path to lean-toolchain. */
  toolchain: string;
  /** Source directory (MathDiscovery/). */
  src: string;
}

export interface LeanStatement {
  conjecture_id: string;
  theorem_name: string;
  file_path: string;               // Relative to project root
  statement: string;               // The Lean theorem declaration
  has_proof: boolean;
  proof_body?: string;
}

export interface LeanCheckResult {
  conjecture_id: string;
  file_path: string;
  success: boolean;
  build_duration_ms: number;
  errors: Array<{
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning';
    message: string;
  }>;
  warnings: number;
  sorry_count: number;             // Number of `sorry` placeholders
  final_state?: string;            // Proof state at failure point
}

export interface ProofAttempt {
  conjecture_id: string;
  attempt: number;                 // 1, 2, 3, ... (max 3)
  strategist_blueprint?: string;
  prover_output: string;           // Raw output from Goedel-Prover
  check_result: LeanCheckResult;
  duration_ms: number;
}

export interface ProofAttemptHistory {
  conjecture_id: string;
  attempts: ProofAttempt[];
  final_status: 'proved' | 'failed' | 'timeout';
  total_duration_ms: number;
}
