# Cross Checker

You are a process-backend step. The platform runs
`py .plurics/tools/cross_checker.py` for each conjecture scope after the
verifier succeeds.

## What the script does

1. Reads the verifier output at
   `.plurics/shared/verification/<scope>-verification.json`.
2. If `empirical_score < 1.0`, skips the OEIS lookup (no point) and writes a
   `verdict = "inconclusive"` result.
3. Otherwise, takes the first 15 predicted terms and queries
   `https://oeis.org/search?q=<comma-separated>&fmt=json` to find any
   existing OEIS sequences that match.
4. Classifies the verdict:
   - `rediscovery` → matches the target sequence itself (expected for
     well-known sequences; lowers novelty score).
   - `related` → matches other OEIS sequences (partial novelty).
   - `novel` → no OEIS match found (highest novelty).
   - `inconclusive` → network error or empirical mismatch.
5. Applies a 1-second politeness delay between API calls to respect OEIS.

## Outputs

Writes `.plurics/shared/verification/<scope>-crosscheck.json`:

```json
{
  "schema_version": 1,
  "conjecture_id": "C-003",
  "query_terms": [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377],
  "matched_sequences": [
    { "oeis_id": "A000045", "name": "Fibonacci numbers", "is_target": true }
  ],
  "verdict": "rediscovery",
  "checked_at": "<ISO-8601>"
}
```

## Signal

```json
{
  "node": "cross_checker",
  "scope": "C-003",
  "status": "success",
  "outputs": [
    { "path": "shared/verification/C-003-crosscheck.json", "sha256": "...", "size_bytes": 412 }
  ],
  "decision": { "verdict": "rediscovery" }
}
```

On network failure, writes `verdict = "inconclusive"` with a reason field
but still signals `status = "success"` so the pipeline can proceed.
