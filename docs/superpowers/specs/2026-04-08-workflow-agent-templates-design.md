# CAAM Research Swarm -- Workflow & Agent Templates

**Date:** 2026-04-08
**Scope:** Production-ready workflow YAML, all 13 agent purpose templates

## Implemented

- `workflows/research-swarm.yaml` -- Complete workflow definition with 13 nodes
- `workflows/presets/research/` -- 13 agent purpose templates (ingestor through meta-analyst)
- Template injection map for purpose-templates.ts placeholder resolution

## Agent Roster

| Agent | Role | Phase |
|---|---|---|
| Ingestor | Data format detection + normalization | 0 |
| Profiler | EDA + data manifest generation | 0 |
| Hypothesist | Structured hypothesis generation | 1 |
| Adversary | Adversarial hypothesis review | 1 |
| Judge | Filter + routing decisions | 1 |
| Architect | Statistical test design | 2 |
| Coder | Test script implementation | 2 |
| Auditor | Code review + logic verification | 2 |
| Fixer | Bug fix based on audit | 2 |
| Executor | Script execution + result capture | 2 |
| Falsifier | Robustness testing (6 strategies) | 2 |
| Generalizer | Condition relaxation (4 strategies) | 3 |
| Meta-Analyst | Synthesis + final report | 3 |
