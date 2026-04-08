# CAAM Research Swarm — Core Data Schemas

**Date:** 2026-04-08
**Companion to:** CHANGES-TO-ARCHITECTURE.md
**Scope:** Hypothesis DSL, Architect dual-mode test plans, Profiler data manifest

---

## 1. Hypothesis DSL

### 1.1 Design Principles

The hypothesis schema is the central artifact of the entire swarm. It flows through almost every agent:

```
Hypothesist (writes) -> Adversary (annotates) -> Judge (filters)
  -> Architect (reads, produces test plan) -> Coder (reads test plan)
  -> Falsifier (reads, inverts) -> Generalizer (reads, modifies)
```

Three constraints drive the design:

1. **Machine-executable**: The Coder must be able to generate a Python script from the hypothesis + test plan without ambiguity.
2. **LLM-writable**: The Hypothesist (an LLM) must be able to produce valid instances without excessive prompting gymnastics.
3. **Semantically rich**: The Adversary and Judge must be able to reason about the hypothesis -- is it tautological? Does it have obvious confounders? Is it testable with the available data?

### 1.2 Schema

See `packages/server/src/modules/workflow/hypothesis-types.ts` for the full TypeScript definitions.

Key types: `Hypothesis`, `HypothesisType` (association, difference, distribution, causal, temporal, structural), `HypothesisPayload` (discriminated union), `AcceptanceCriteria`, `TestResult`, `FalsificationResult`, `GeneralizationResult`.

### 1.3 DSL Validation Rules

See `packages/server/src/modules/workflow/hypothesis-validator.ts` for the implementation.

Enforces: variable existence in data manifest, transform compatibility, confounder independence, effect size metric match, causal prerequisites, sample feasibility.

---

## 2. Architect Dual-Mode: Correlation vs. Causation

### 2.1 TestPlan Schema

See `packages/server/src/modules/workflow/test-plan-types.ts` for the full TypeScript definitions.

Key types: `TestPlan` (with mode: correlation | causal | distributional | structural), `CorrelationPlan`, `CausalPlan`, `DistributionalPlan`, `StructuralPlan`, `PreprocessingStep`, `AssumptionCheck`, `SampleSizeAnalysis`.

### 2.2 Decision Matrix

The Architect chooses mode based on hypothesis type, then selects specific test based on variable types from the data manifest. See spec for the full decision tree.

---

## 3. Profiler Data Manifest

### 3.1 Schema

See `packages/server/src/modules/workflow/manifest-types.ts` for the full TypeScript definitions.

Key types: `DataManifest`, `DatasetMetadata`, `ColumnProfile`, `SemanticType`, `ColumnStats`, `DistributionSummary`, `CorrelationEntry`, `DataQualityReport`, `AnalysisLead`.

---

## 4. Integration

| Schema | Written by | Read by | File location |
|---|---|---|---|
| DataManifest | Profiler | All downstream agents | `.caam/shared/profiling-report.json` |
| Hypothesis | Hypothesist | Adversary, Judge, Architect, Coder, Falsifier, Generalizer | `.caam/shared/hypotheses/H-{NNN}.json` |
| TestPlan | Architect | Coder, Auditor | `.caam/shared/test-plans/H-{NNN}-plan.json` |
| TestResult | Executor | Falsifier, Registrar, Meta-Analyst | `.caam/shared/results/H-{NNN}-result.json` |
