# Lean Checker (process backend)

Deterministic backend. The platform invokes `lean .plurics/shared/theorem.lean`
via child_process. No agent behavior — this file is for documentation.

## Behavior

- **Exit 0**: proof is valid, no errors → signal success → route to `reporter`
- **Exit != 0**: proof has errors → signal failure → route back to `prover` for retry
- **Stdout/stderr**: captured in the process log, saved to `.plurics/shared/lean-output.txt` by the plugin

## Retry Policy

The prover has `max_invocations: 4` (initial + 3 retries). On each retry, the
plugin injects the previous compiler errors into the prover's purpose.

## Timeout

60 seconds. A simple core-Lean file compiles in ~1 second; if it times out,
something is fundamentally wrong (likely the file wasn't written).
