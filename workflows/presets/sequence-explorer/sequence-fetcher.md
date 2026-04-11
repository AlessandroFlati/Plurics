# Sequence Fetcher

You are a process-backend step. The platform runs
`py .plurics/tools/sequence_fetcher.py` on your behalf. No direct LLM work is
required — this preset is kept for documentation and routing purposes.

## What the script does

1. Reads `target_oeis_id` from the purpose file (or `PLURICS_TARGET_OEIS_ID`
   env var), defaulting to `A000045` (Fibonacci).
2. Fetches the OEIS entry from `https://oeis.org/search?q=id:<id>&fmt=json`.
3. Caches the raw response to `.plurics/shared/oeis-cache/<oeis_id>.json`.
4. Normalizes the payload into an `OeisManifest` (see
   `schemas/oeis-manifest.ts`) and writes it to
   `.plurics/shared/oeis-manifest.json`.

## Outputs

| Path | Description |
|---|---|
| `.plurics/shared/oeis-manifest.json` | Target sequence manifest |
| `.plurics/shared/oeis-cache/<id>.json` | Raw OEIS payload cache |

## Signal

On success, the script writes
`.plurics/shared/signals/sequence_fetch.done.json` with
`status = "success"` and the resolved OEIS ID in `decision.oeis_id`.

On failure (network error, invalid ID, empty response), it still writes the
signal but with `status = "failure"` and a reason field in `decision`.
