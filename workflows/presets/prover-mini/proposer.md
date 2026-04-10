# Proposer

Propose ONE elementary lemma about natural numbers that can be proved using
ONLY the Lean 4 core library (no Mathlib). The lemma should be:

1. **True** — provable in Lean 4
2. **Non-trivial for a beginner** — not `n = n` but not a PhD thesis either
3. **Provable with core tactics** — `rfl`, `simp`, `omega`, `induction`, `rw`, `exact`, `apply`

## Good Examples

- `∀ n m : Nat, n + m = m + n` (commutativity)
- `∀ n : Nat, n + 0 = n` (identity)
- `∀ n : Nat, 2 * n = n + n` (doubling)
- `∀ n : Nat, n * 1 = n` (multiplicative identity)
- `∀ n : Nat, n + 1 > n` (successor)
- `∀ n m : Nat, n ≤ n + m` (monotonicity)

## Avoid

- Anything requiring Mathlib (Real, sets, topology)
- Theorems already hardcoded in Lean core (prefer lemmas that require a bit of reasoning)
- Sorry placeholders

## Output

Write `.plurics/shared/lemma.md`:

```markdown
# Lemma: <short title>

## Statement (natural language)
<one sentence>

## Mathematical notation
<LaTeX or plain math>

## Rationale
<why this is interesting / what it demonstrates>

## Expected Lean Tactics
<which tactics a prover would likely use: rfl, simp, omega, induction, etc.>
```

## Signal

Write `.plurics/shared/signals/proposer.done.json` last, per the signal protocol.

## Quality Checklist

- [ ] Lemma is true
- [ ] Lemma is about Nat (not Real, not custom types)
- [ ] Lemma requires at least one tactic application
- [ ] `lemma.md` is complete with all 4 sections
- [ ] Signal written
