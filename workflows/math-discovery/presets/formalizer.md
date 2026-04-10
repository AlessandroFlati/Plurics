# Formalizer

Translate a natural-language conjecture into a Lean 4 theorem statement.
This is the most delicate bridge in the pipeline — the Lean statement must
capture the intent precisely, with the right types and the right quantifiers.

## Inputs (PRE-LOADED below)

The conjecture to formalize is injected above. The Lean project base
definitions are in `.plurics/shared/lean-project/MathDiscovery/Basic.lean`
(import via `import MathDiscovery.Basic`).

## Output

| Path | Description |
|---|---|
| `.plurics/shared/lean-project/MathDiscovery/Conjectures/{{SCOPE}}.lean` | Lean file with statement + `sorry` placeholder |
| `.plurics/shared/data/signals/formalizer-{{SCOPE}}.done.json` | Signal |

## Lean File Template

```lean
/-
Conjecture {{SCOPE}}: <title>

<natural language statement>
-/

import MathDiscovery.Basic
import Mathlib.Analysis.SpecialFunctions.Log.Basic

namespace MathDiscovery.Conjectures

open MathDiscovery

/-- Formal statement of {{SCOPE}}. -/
theorem {{SCOPE}}_statement
    (p : TimeSeries)
    (hp : IsPositive p)
    : <your formal property> := by
  sorry

end MathDiscovery.Conjectures
```

## Key Guidelines

1. **Types first**: decide what mathematical objects the conjecture is about (series, distributions, measures, dynamical systems).
2. **Quantifiers**: every implicit "for all" or "exists" must become explicit (`∀`, `∃`).
3. **Hypotheses**: any assumption (positivity, stationarity, finiteness) becomes a hypothesis before the main claim.
4. **Decidable vs. propositional**: if the claim involves real-valued quantities, use `Prop`. If it's a finite combinatorial check, consider making it `Decidable`.
5. **Use Basic.lean helpers**: `TimeSeries`, `logReturns`, `simpleReturns`, `rollingMean`, `IsPositive`, `IsBounded` are all available via `import MathDiscovery.Basic`.
6. **Placeholder proof**: use `sorry` — the Prover will fill it in.

## Quality Checklist

- [ ] The Lean file compiles (Basic.lean imports resolve)
- [ ] The statement has explicit quantifiers
- [ ] All hypotheses are listed before the goal
- [ ] The theorem name matches `{{SCOPE}}_statement`
- [ ] `sorry` is the only proof content
- [ ] Signal written
