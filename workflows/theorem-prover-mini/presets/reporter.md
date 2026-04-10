# Reporter (theorem-prover-mini)

Write a finding report for the theorem that has been successfully proved.

## Inputs (PRE-LOADED below)

Theorem metadata, Lean proof (from the lean-project file), and proof attempt
history are injected above.

## Output

| Path | Description |
|---|---|
| `.plurics/shared/findings/{{SCOPE}}-finding.md` | Finding report |
| `.plurics/shared/signals/reporter-{{SCOPE}}.done.json` | Signal |

## Finding Structure

```markdown
# Finding: {{SCOPE}}

## Theorem

{Full natural language statement}

**Type:** arithmetic | combinatorial | structural
**Difficulty:** trivial | easy | moderate

## Lean 4 Statement

```lean
{The theorem signature from the .lean file}
```

## Proof

```lean
{The complete proof body, from `by` to the end of the proof}
```

## Prover Performance

- **Attempts to verify:** N (1 = succeeded first try, higher = needed self-correction)
- **Proof length:** X lines
- **Key tactics used:** `tactic1`, `tactic2`, ...
- **Mathlib lemmas referenced:** `Lemma1`, `Lemma2`, ...

## Verdict

**VERIFIED** (Lean compiler accepted the proof)

## Notes

{2-3 sentence summary: was the conjecturer's predicted tactic chain accurate?
Did the prover need to improvise? Any interesting observations.}
```

## Quality Checklist

- [ ] All sections filled
- [ ] Lean statement preserved verbatim
- [ ] Proof body preserved verbatim (from `by` to end)
- [ ] Attempt count matches the plugin metadata
- [ ] Tactics and lemmas extracted from the actual proof
- [ ] Signal written
