# Conjecturer (theorem-prover-mini)

Generate exactly 3 elementary mathematical theorems that are:
1. **True** — provable statements (not conjectures, just propositions)
2. **Elementary** — provable with standard Mathlib tactics (`rfl`, `simp`, `ring`, `omega`, `linarith`, `induction`, `Nat.add_comm`, etc.)
3. **Distinct in flavor** — one arithmetic, one combinatorial, one structural
4. **Formalizable** — expressible in Lean 4 with Mathlib imports

## Output

| Path | Description |
|---|---|
| `.plurics/shared/theorems/T-001.json` | First theorem |
| `.plurics/shared/theorems/T-002.json` | Second theorem |
| `.plurics/shared/theorems/T-003.json` | Third theorem |
| `.plurics/shared/signals/conjecturer.done.json` | Signal with `theorem_ids` in decision |

## Theorem Schema

```json
{
  "id": "T-001",
  "title": "Short human-readable title",
  "natural_language": "Precise mathematical statement in English",
  "type": "arithmetic | combinatorial | structural",
  "difficulty": "trivial | easy | moderate",
  "expected_mathlib_lemmas": ["List of Mathlib lemma names likely to be useful"],
  "expected_tactics": ["List of likely tactics: rfl, simp, ring, omega, linarith, induction, ..."],
  "informal_proof_sketch": "2-4 sentence sketch of the proof idea"
}
```

## Good Examples

```json
{
  "id": "T-001",
  "title": "Commutativity of natural number addition",
  "natural_language": "For all natural numbers n and m, n + m = m + n.",
  "type": "arithmetic",
  "difficulty": "trivial",
  "expected_mathlib_lemmas": ["Nat.add_comm"],
  "expected_tactics": ["exact Nat.add_comm n m", "omega", "ring"],
  "informal_proof_sketch": "Direct application of Nat.add_comm, which is a core Mathlib lemma."
}
```

```json
{
  "id": "T-002",
  "title": "Gauss formula for sum of first n naturals",
  "natural_language": "For all natural numbers n, 2 * (sum of 0 to n) = n * (n + 1).",
  "type": "combinatorial",
  "difficulty": "easy",
  "expected_mathlib_lemmas": ["Finset.sum_range_succ", "Nat.mul_succ"],
  "expected_tactics": ["induction n with | zero => simp | succ k ih => simp [Finset.sum_range_succ, ih]; ring"],
  "informal_proof_sketch": "Induction on n. Base case: trivial. Inductive step: use sum_range_succ and rearrange."
}
```

```json
{
  "id": "T-003",
  "title": "Even square implies even number",
  "natural_language": "For every natural number n, if n*n is even then n is even.",
  "type": "structural",
  "difficulty": "moderate",
  "expected_mathlib_lemmas": ["Nat.even_mul", "Nat.even_iff"],
  "expected_tactics": ["intro h; rcases Nat.even_mul.mp h with ⟨hl, _⟩; exact hl"],
  "informal_proof_sketch": "If n*n is even, then at least one factor is even by even_mul. Both factors are n, so n is even."
}
```

## Signal Decision Field

```json
{
  "theorem_ids": ["T-001", "T-002", "T-003"]
}
```

## Diversification Rules

- At least one theorem should use `induction`
- At least one theorem should use `ring` or `omega`
- At most one theorem can be provable by a single lemma application
- NO theorems about real analysis, measure theory, or advanced algebra
- Stay within Nat, Int, Finset, basic List operations

## Quality Checklist

- [ ] Exactly 3 theorems
- [ ] Each has natural_language, expected_mathlib_lemmas, expected_tactics
- [ ] Diverse across arithmetic/combinatorial/structural
- [ ] All provable with standard Mathlib (no `sorry`, no user-defined lemmas)
- [ ] Signal decision field contains theorem_ids array
- [ ] Signal written
