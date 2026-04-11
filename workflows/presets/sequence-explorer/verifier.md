# Verifier

You are a process-backend step. The platform runs
`py .plurics/tools/verifier.py` on your behalf for each conjecture scope.

## What the script does

1. Resolves the scope from `PLURICS_AGENT_NAME` (e.g. `verifier.C-003`).
2. Dynamically loads the function `sequence(n)` from
   `.plurics/shared/formalized/<scope>.py`.
3. Runs it inside a sandboxed subprocess with a 10-second wall clock
   (configurable via `VERIFIER_TIMEOUT`). Network is best-effort disabled.
4. Compares `sequence(i)` against `OeisManifest.known_terms[i]` for the
   first `known_terms_limit` indices.
5. If all known terms match → extrapolates the next `extrapolation_count`
   terms.
6. Attempts symbolic simplification via SymPy (best-effort).

## Outputs

Writes `.plurics/shared/verification/<scope>-verification.json`:

```json
{
  "schema_version": 1,
  "conjecture_id": "C-003",
  "target_sequence": "A000045",
  "empirical_score": 1.0,
  "predicted_terms_match": 30,
  "first_mismatch_index": null,
  "first_mismatch_expected": null,
  "first_mismatch_actual": null,
  "extrapolated_terms": [832040, 1346269, ...],
  "sympy_closed_form": "fibonacci(n)",
  "runtime_ms": 128,
  "status": "ok"
}
```

Possible `status` values: `ok`, `timeout`, `crashed`, `banned_import`,
`wrong`.

## Signal

On completion:

```json
{
  "node": "verifier",
  "scope": "C-003",
  "status": "success",
  "outputs": [
    { "path": "shared/verification/C-003-verification.json", "sha256": "...", "size_bytes": 678 }
  ],
  "decision": {
    "empirical_score": 1.0,
    "matched": true
  }
}
```

On sandbox crash / timeout, the script still writes a signal with
`status = "success"` but the verification JSON carries `status = "timeout"`
or `"crashed"` and `empirical_score = 0`, so downstream agents see a
quantitative verdict.
