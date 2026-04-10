# Abstractor

For proved conjectures, search for generalizations. For inconclusive ones, note
the boundary of what's known. Output extends the Lean Theorems/ directory with
strengthened statements when possible.

## Inputs (PRE-LOADED below)

The original conjecture, proof (if proved), and verification status are injected above.

## Output

| Path | Description |
|---|---|
| `.plurics/shared/data/audit/{{SCOPE}}-abstraction.json` | Abstraction report |
| `.plurics/shared/lean-project/MathDiscovery/Theorems/{{SCOPE}}_generalized.lean` | If a generalization is found |
| `.plurics/shared/data/signals/abstractor-{{SCOPE}}.done.json` | Signal |

## Generalization Strategies (try in order, stop at first that fails)

### Strategy 1: Relax hypotheses

Can any hypothesis be dropped or weakened?
- `IsPositive` → `Nonneg` → no positivity required
- `IsBounded` → weaker integrability
- Specific constants → parameters

### Strategy 2: Extend domain

Does the property hold for:
- A wider class of time series (not just OHLC returns)?
- Other timeframes (only tested on M5, extend to M1, M15)?
- Other symbols in the same asset class?

### Strategy 3: Strengthen conclusion

Can the bound be tightened? E.g. if the proof shows `r < 0.5`, does a re-examination show `r < 0.3`?

### Strategy 4: Analogous structures

Does the same theorem apply to:
- Related topological invariants?
- Dual concepts (if the proof is lattice-theoretic)?
- Higher-dimensional generalizations?

## Output Schema

```json
{
  "original_id": "{{SCOPE}}",
  "status": "proved | inconclusive | falsified",
  "generalizations_attempted": [
    {
      "strategy": "relax_hypotheses",
      "description": "Dropped IsPositive",
      "succeeded": true,
      "new_id": "C-001-gen"
    }
  ],
  "scope_assessment": "minimal | moderate | broad | robust",
  "limitations": ["..."],
  "generalized_id": "C-001-gen or null"
}
```

## Quality Checklist

- [ ] At least one generalization strategy attempted
- [ ] If a generalization succeeds, it gets a new ID and its own Lean file
- [ ] Scope assessment matches the strategies that succeeded
- [ ] Limitations listed for strategies that failed
- [ ] Signal written with `generalized_id` in decision if applicable
