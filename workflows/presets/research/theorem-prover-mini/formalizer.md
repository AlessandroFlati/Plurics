# Formalizer (theorem-prover-mini)

Translate the theorem (pre-loaded below) into a Lean 4 statement with `sorry`
as placeholder. The Prover will fill in the proof.

## Inputs (PRE-LOADED below)

The theorem JSON is injected above.

## Output

| Path | Description |
|---|---|
| `.plurics/shared/formalized/{{SCOPE}}.lean` | Lean statement with `sorry` placeholder |
| `.plurics/shared/signals/formalizer-{{SCOPE}}.done.json` | Signal |

Note: the file is written into `.plurics/shared/formalized/`. The plugin will
later copy it to the Lean project directory before the Prover runs.

## Lean File Template

```lean
/-
Theorem {{SCOPE}}: <title>

<natural language statement>
-/

import Mathlib.Data.Nat.Basic
import Mathlib.Tactic

namespace TheoremProverMini.Theorems

/-- <title> -/
theorem {{SCOPE_SNAKE}}_statement : <the goal> := by
  sorry

end TheoremProverMini.Theorems
```

## Key Guidelines

1. **Replace `{{SCOPE_SNAKE}}`** with the theorem ID in snake_case (e.g., `T-001` → `t_001`)
2. **Use only `Mathlib.Data.Nat.Basic` and `Mathlib.Tactic`** unless the theorem requires something else (keeps build time low)
3. **Avoid heavy imports**: no `Mathlib.Analysis.*`, no `Mathlib.Topology.*`, no `Mathlib.MeasureTheory.*`
4. **Explicit quantifiers**: every "for all" becomes `∀`, every "exists" becomes `∃`
5. **Natural number by default**: if the theorem is about "numbers" without specification, use `ℕ`
6. **Leave `sorry`**: the Prover fills this in

## Examples

### T-001: Commutativity of addition

```lean
import Mathlib.Data.Nat.Basic
import Mathlib.Tactic

namespace TheoremProverMini.Theorems

/-- For all natural numbers n and m, n + m = m + n. -/
theorem t_001_statement : ∀ (n m : ℕ), n + m = m + n := by
  sorry

end TheoremProverMini.Theorems
```

### T-002: Gauss formula

```lean
import Mathlib.Data.Nat.Basic
import Mathlib.Algebra.BigOperators.Basic
import Mathlib.Tactic

namespace TheoremProverMini.Theorems

open Finset

/-- 2 * (sum from 0 to n) = n * (n + 1) -/
theorem t_002_statement : ∀ (n : ℕ), 2 * ∑ i ∈ range (n + 1), i = n * (n + 1) := by
  sorry

end TheoremProverMini.Theorems
```

## Quality Checklist

- [ ] Imports are minimal (Nat.Basic + Tactic + optional BigOperators)
- [ ] Theorem name matches `{scope_snake}_statement`
- [ ] Statement uses explicit `∀`/`∃` quantifiers
- [ ] Proof body is exactly `sorry`
- [ ] File is saved in `TheoremProverMini/Theorems/{{SCOPE}}.lean`
- [ ] Signal written
