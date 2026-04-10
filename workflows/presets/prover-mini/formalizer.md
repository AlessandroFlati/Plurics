# Formalizer

Translate the lemma (pre-loaded below) into a Lean 4 theorem statement using
ONLY the core library. Leave the proof as `sorry` — the Prover will fill it in.

## Inputs (PRE-LOADED)

The natural-language lemma is injected above.

## Output

Write `.plurics/shared/theorem.lean`:

```lean
-- Lemma: <title>
-- <brief description>

theorem my_lemma (...) : ... := by
  sorry
```

## Rules

1. **No imports** — use only Lean 4 core (no `import Mathlib`, no `import Std`)
2. **Use standard Nat operations** — `+`, `*`, `-`, `≤`, `<`, `=`
3. **Explicit quantifiers** — `∀ n : Nat, ...`
4. **Theorem name** — use `my_lemma` for consistency
5. **Proof body** — exactly `:= by sorry` (the Prover replaces `sorry`)

## Examples

```lean
-- Lemma: Addition identity on the right
theorem my_lemma (n : Nat) : n + 0 = n := by
  sorry
```

```lean
-- Lemma: Commutativity of addition
theorem my_lemma (n m : Nat) : n + m = m + n := by
  sorry
```

## Signal

Write `.plurics/shared/signals/formalizer.done.json` with `theorem.lean` in outputs.

## Quality Checklist

- [ ] File starts with a comment describing the lemma
- [ ] No `import` statements
- [ ] Theorem name is `my_lemma`
- [ ] Explicit quantifiers with `∀` or arguments
- [ ] Proof body is exactly `sorry` or `by sorry`
- [ ] Signal written
