# Lean Checker (theorem-prover-mini)

Process backend: runs `lake build` on the Lean project. This preset is
informational — the actual execution is a child_process managed by the
AgentRegistry. The plugin generates the signal from exit code + stdout/stderr.

## Execution

```bash
cd .plurics/shared/lean-project
lake build TheoremProverMini.Theorems.{{SCOPE}}
```

## Signal Generation

The plugin inspects stdout+stderr after process exit:
- **exit 0, no `error:` in output, no `sorry` warning**: signal `success`, decision `proof_valid`
- **exit != 0 OR errors present**: signal `failure`, decision `proof_invalid`, error text saved

On failure, the plugin writes the error to `{{SCOPE}}-last-error.txt` for the
next Prover retry.
