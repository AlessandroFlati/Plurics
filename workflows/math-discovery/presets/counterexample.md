# Counterexample Search

When the Prover fails to produce a Lean proof after `prover_max_self_corrections`
attempts, you try to find a numerical counterexample that falsifies the conjecture.
If found, the conjecture is falsified. If not, it's marked "inconclusive" and
proceeds to the Abstractor anyway.

## Inputs (PRE-LOADED below)

The conjecture and its proof attempt history are injected above. The OHLC data
is at `.plurics/shared/data/tables/` (read via pandas).

## Output

| Path | Description |
|---|---|
| `.plurics/shared/data/scripts/{{SCOPE}}-counterexample.py` | Search script |
| `.plurics/shared/data/audit/{{SCOPE}}-counterexample.json` | Search result |
| `.plurics/shared/data/audit/{{SCOPE}}-rejection-reason.md` | If falsified, human-readable reason |
| `.plurics/shared/data/signals/counterexample-{{SCOPE}}.done.json` | Signal with `counterexample_found` in decision |

## Strategy

### 1. Identify the parameter space

What parameters does the conjecture quantify over? Examples:
- Time windows (bar counts, lookback periods)
- Thresholds (volatility, return magnitude)
- Symbol-timeframe combinations
- Free parameters in the formal statement

### 2. Design the search

- **Exhaustive**: if the space is small (< 1000 combinations), test all
- **Grid search**: for 2-3 continuous parameters
- **Random search**: for higher-dim spaces (1000 samples)
- **Adversarial**: if the structure suggests likely failure modes, target those

### 3. Write a Python script

```python
import json, pathlib, pandas as pd, numpy as np
# Load data for all symbols/timeframes mentioned in the conjecture
# Iterate over the parameter space
# For each combination, evaluate whether the conjecture holds
# Record the first counterexample found (or exhaust the space)
```

### 4. Interpret results

- **Counterexample found**: write `rejection-reason.md` with:
  - The conjecture statement
  - The specific parameters/data that violate it
  - Why it's a genuine counterexample (not a data quirk)
  - Suggested reformulation (what to weaken/change)
- **No counterexample**: mark as inconclusive, note the search scope

## Signal Decision

```json
{
  "counterexample_found": true,
  "parameters": {...},
  "evidence": "Specific data point or computation"
}
```
or
```json
{
  "counterexample_found": false,
  "search_scope": "Description of what was tested",
  "recommendation": "abstractor"
}
```

## Quality Checklist

- [ ] Python script is self-contained and runnable
- [ ] Search covers a meaningful portion of the parameter space
- [ ] If found, counterexample is reproducible
- [ ] If found, rejection-reason.md has concrete suggestions for reformulation
- [ ] Signal written with correct decision field
