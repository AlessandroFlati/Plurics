# Plurics

Plurics orchestrates **heterogeneous agent networks** — mixing Claude Code terminals, local LLMs, and deterministic processes — into YAML-defined DAG workflows. It is a general-purpose platform for multi-agent pipelines: the core knows nothing about any specific domain, while plugins and workflow instances provide domain-specific behavior.

The name is a nod to Multics: where Multics was a **multi**plexed information and computing service for operators sharing a mainframe, Plurics is a **pluri**plexed agent service for humans sharing the cognitive load with multiple LLMs and tools at once.

## What it does

- **Orchestrates workflows** — YAML DAG with fan-out, branching, retry, timeout, resume-after-crash, and snapshot persistence
- **Mixes agent backends** — `claude-code` (Claude Code via node-pty), `process` (child_process for Python, `lake build`, etc.), and `local-llm` (OpenAI-compatible or Ollama native API)
- **Tracks evolutionary populations** — built-in `EvolutionaryPool` with tournament/roulette/top-k selection, lineage tracking, persistence/resume
- **Provides observability** — real-time DAG visualization and findings panel in the browser, all agent I/O captured to per-run logs
- **Fails gracefully** — atomic signal files, SHA-256 integrity, normalization layer for LLM output tolerance, polling fallback for filesystem watching on Windows

## Reference workflows

Five example instances ship with the repo:

| Workflow | Purpose | Pipeline |
|---|---|---|
| `smoke-test` | Validates the three backend types end-to-end | 3 nodes, ~34s |
| `theorem-prover-mini` | Generator → formalizer → prover → Lean verifier → reporter | 5 nodes, ~5 min per theorem |
| `research-swarm` | Autonomous statistical research on tabular data | 14 nodes, ~1h on real datasets |
| `math-discovery` | Financial time-series + formal proof in Lean (gated by confirmed findings) | 14 nodes, 3 phases, requires local LLM prover |
| `sequence-explorer` | Evolutionary discovery loop for OEIS integer sequences | 10 nodes, round-loop with pool lineage, ~27 min/round for 5 conjectures |

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full layered architecture (Platform / SDK / Workflow Instances), the WorkflowPlugin hook reference, and the REST/WebSocket protocol.

## Quick start

```bash
# Install
npm install

# Start dev server (frontend + backend)
npm run dev

# Open http://localhost:11000
```

To run a workflow end-to-end, start the server and launch one of the test runners in `test-data/`:

```bash
cd test-data && node run-smoke.js               # Validates all three backends
cd test-data && node run-prover-mini.js         # Proves an elementary theorem in Lean
cd test-data && node run-e2e.js                 # Runs research-swarm on synthetic data
cd test-data && node run-sequence.js            # Sequence Explorer on OEIS A000045 (Fibonacci)
```

## Requirements

- Node.js 22+
- Optional: Lean 4 (elan) for formal verification workflows
- Optional: Ollama or vLLM for `local-llm` backend

## License

Private.
