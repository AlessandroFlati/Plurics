# CAAM Research Swarm -- Synthesis Agents & Architecture Review

**Date:** 2026-04-08
**Scope:** Meta-Analyst spec, Falsifier strategies, Generalizer strategies, architecture gaps

## Implemented

- synthesis-types.ts: FindingCluster, SynthesizedCausalGraph, ConsistencyCheck, GapAnalysis,
  ImportanceScore, FinalReport, FalsificationStrategy types + applicability matrix,
  GeneralizationStrategy types
- purpose-templates.ts: manifestSlice() for per-agent context window management
- dag-executor.ts: concurrency semaphore (max_parallel_hypotheses), depends_on_all evaluation,
  graceful degradation when no hypotheses survive, sub-DAG counter
- signal-validator.ts: validateOutputNamespace() for scope/pattern enforcement

## Design Decisions

- Meta-Analyst sees everything, produces structured + narrative reports
- Falsifier applies all applicable strategies, robustness_score = survived/attempted
- Required strategies (permutation, bootstrap) can unilaterally falsify; others are informational
- Generalizer relaxes conditions one at a time, runs tests directly (shortcut, not full pipeline)
- Importance scoring: practical (0.25) + robustness (0.25) weighted highest
- Context slicing: full manifest for hypothesist/adversary, filtered for architect/coder, summary for judge
- Ingestor output: parquet + CSV sample + report (spec only, not yet implemented)
- Script sandboxing: timeout wrapper (120s default, not Docker)
- Hypothesis ID allocation: counter file in .caam/shared/hypothesis-counter.json
