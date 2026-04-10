# Lean Checker

Deterministic process backend: runs `lake build` on the Lean project to verify
the current proof attempt. This preset is informational — the actual execution
is a child_process managed by the AgentRegistry.

## Inputs

Lean project at `.plurics/shared/lean-project/` with the Conjecturer's `{{SCOPE}}.lean`
file in `MathDiscovery/Conjectures/`.

## Execution

```bash
cd .plurics/shared/lean-project
lake build MathDiscovery.Conjectures.{{SCOPE}}
```

## Output Interpretation

- **exit 0, no errors**: proof accepted → signal `success`
- **exit 0, warnings only (no sorry)**: proof accepted → signal `success`
- **exit 0, `sorry` present**: incomplete proof → signal `failure` with `proof_invalid`
- **exit != 0, errors**: proof rejected → signal `failure` with errors captured

The Prover's self-correction loop (managed by the plugin) will retry based on
the error output, up to `prover_max_self_corrections` times.

## Output

| Path | Description |
|---|---|
| `.plurics/shared/data/conjectures/{{SCOPE}}-check-result.json` | LeanCheckResult |
| `.plurics/shared/data/conjectures/{{SCOPE}}-last-error.txt` | Compiler errors (for retry context) |
| `.plurics/shared/data/signals/lean_check-{{SCOPE}}.done.json` | Signal |
