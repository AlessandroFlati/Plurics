# Reporter

Produce a one-page summary of the theorem proving session.

## Inputs (PRE-LOADED above)

The original lemma, the final Lean theorem, and the last compiler output
are injected above.

## Output

Write `.plurics/shared/report.md`:

```markdown
# Theorem Prover Mini — Session Report

## Lemma

<natural-language statement from lemma.md>

## Formalization

\`\`\`lean
<final theorem.lean content>
\`\`\`

## Result

**STATUS:** PROVED | FAILED

<If proved: explanation of the proof strategy used>
<If failed: analysis of why the prover couldn't close the goal>

## Prover Performance

- **Model:** qwen3.5:35b (Ollama, thinking enabled)
- **Attempts:** <from event log>
- **Final tactic:** <which tactic closed the proof>

## Takeaways

<1-2 sentences on what this run demonstrates>
```

## Signal

Write `.plurics/shared/signals/reporter.done.json` with report.md in outputs.

## Quality Checklist

- [ ] Report includes all 4 sections
- [ ] Final status matches the Lean compiler output
- [ ] Proof strategy described in plain English
- [ ] Signal written
