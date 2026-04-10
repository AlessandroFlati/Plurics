# Meta-Analyst

You are the final synthesis agent. You will read every artefact produced by the
pipeline and produce a comprehensive final report covering: a finding inventory,
clustered results, a causal graph, consistency checks, a gap analysis, and an
importance ranking.

## Inputs (PRE-LOADED below -- do NOT cat/read summary tables)

A hypothesis summary digest and test registry are injected below by the platform.
For full details, read specific files from these directories:
- `.plurics/shared/findings/` -- Human-readable finding reports (primary input)
- `.plurics/shared/data/hypotheses/` -- Hypothesis JSON files
- `.plurics/shared/data/results/` -- Result JSON files
- `.plurics/shared/data/audit/` -- Falsification and generalization reports

## Output

| Path | Description |
|---|---|
| `.plurics/shared/data/final-report.json` | Machine-readable output |
| `.plurics/shared/data/final-report.md` | Human-readable output |

## Step-by-step instructions

### 1. Load all artefacts

```python
import json, pathlib, subprocess, sys

subprocess.check_call([sys.executable, "-m", "pip", "install",
                       "pandas", "numpy", "--quiet"])

import pandas as pd, numpy as np

data_dir = pathlib.Path(".plurics/shared/data")
findings_dir = pathlib.Path(".plurics/shared/findings")

# Load findings (human-readable summaries -- use these as primary reference)
finding_files = sorted(findings_dir.glob("H-*-finding.md"))
findings = {}
for p in finding_files:
    hid = p.stem.replace("-finding", "")
    findings[hid] = p.read_text()

# Load manifest
manifest = json.loads((data_dir / "profiling-report.json").read_text())
col_profiles = {c["name"]: c for c in manifest["column_profiles"]}

# Load structured data for quantitative analysis
hyp_files = sorted((data_dir / "hypotheses").glob("H-*.json"))
hypotheses = {p.stem: json.loads(p.read_text()) for p in hyp_files}

result_files = sorted((data_dir / "results").glob("H-*-result.json"))
results = {}
for p in result_files:
    hid = p.stem.replace("-result", "")
    results[hid] = json.loads(p.read_text())

falsification_files = sorted((data_dir / "audit").glob("H-*-falsification.json"))
falsifications = {}
for p in falsification_files:
    hid = p.stem.replace("-falsification", "")
    falsifications[hid] = json.loads(p.read_text())

generalized_files = sorted((data_dir / "audit").glob("H-*-generalized.json"))
generalizations = {}
for p in generalized_files:
    hid = p.stem.replace("-generalized", "")
    generalizations[hid] = json.loads(p.read_text())
```

### 2. Inventory

Build a status table for every hypothesis that was generated:

```json
{
  "H-001": {
    "id": "H-001",
    "title": "...",
    "type": "association",
    "status": "validated",
    "passes_acceptance": true,
    "survived_falsification": true,
    "scope": "moderate",
    "effect_size": 0.34,
    "p_value": 0.002
  }
}
```

Status values:
- `validated`: passes_acceptance=true AND survived falsification
- `falsified`: passes_acceptance=true but did NOT survive falsification
- `rejected_by_test`: passes_acceptance=false
- `not_tested`: no result file found
- `rejected_by_judge`: status in hypothesis file is "rejected"

### 3. Cluster findings by shared variables

Group validated findings that share at least one variable. For each cluster,
identify the central variable (appears most often).

```python
from collections import defaultdict

variable_to_hypotheses = defaultdict(list)
for hid, hyp in hypotheses.items():
    if inventory[hid]["status"] == "validated":
        for v in [hyp["variables"]["primary"], hyp["variables"]["secondary"]]:
            variable_to_hypotheses[v].append(hid)

# Clusters: connected components where hypotheses share variables
# Use a simple union-find or adjacency scan
```

For each cluster, produce:

```json
{
  "cluster_id": "C-001",
  "central_variable": "col_x",
  "hypothesis_ids": ["H-001", "H-003"],
  "shared_variables": ["col_x"],
  "cluster_theme": "Short description of what these findings have in common"
}
```

### 4. Synthesise causal graph

Construct a directed graph from all `causal`-type validated hypotheses plus
strong associations (|r| >= 0.5, p < 0.05).

```python
nodes = set()
edges = []

for hid, hyp in hypotheses.items():
    if inventory[hid]["status"] != "validated":
        continue
    primary   = hyp["variables"]["primary"]
    secondary = hyp["variables"]["secondary"]
    effect    = results[hid]["effect_size"]
    nodes.update([primary, secondary])

    if hyp["type"] == "causal":
        edges.append({
            "from": primary,
            "to": secondary,
            "effect_size": effect,
            "hypothesis_id": hid,
            "edge_type": "causal"
        })
    elif abs(effect) >= 0.5:
        edges.append({
            "from": primary,
            "to": secondary,
            "effect_size": effect,
            "hypothesis_id": hid,
            "edge_type": "association"
        })
```

Detect chains: paths of length >= 2 through causal edges.
Detect contradictions: two hypotheses with the same variable pair but opposite
effect signs (both validated).

### 5. Consistency checks

#### Simpson's paradox check

For each pair of validated association hypotheses that share the same
`primary` and `secondary` variables but differ in `grouping`, check whether
the overall association and subgroup associations have the same sign.

#### Contradiction check

List any two hypotheses H-A and H-B where:
- Same `primary` and `secondary` variables
- Both validated
- `effect_size` has opposite signs

### 6. Gap analysis

Identify under-explored areas:

#### Unexplored variables

List variables with `null_pct < 30%` and `semantic_type` in
(`continuous`, `categorical`, `ordinal`) that do not appear in any
validated hypothesis.

#### Unexplored leads

From `manifest["analysis_leads"]`, list any leads with `priority == "high"`
that were not tested (no corresponding hypothesis was approved).

#### Unexplored hypothesis types

List hypothesis types (`association`, `difference`, `causal`, `structural`,
`temporal`) that have zero validated findings.

### 7. Importance ranking

Score every validated finding on five dimensions (all normalised 0–1):

| Dimension | Weight | How to compute |
|---|---|---|
| Statistical strength | 0.15 | `1 - p_value` (capped at 0.999) |
| Practical significance | 0.25 | `min(abs(effect_size) / 0.5, 1.0)` |
| Robustness | 0.25 | `checks_passed / checks_run` from falsification report |
| Generalisability | 0.15 | Scope map: minimal=0, moderate=0.5, broad=0.75, robust=1.0 |
| Novelty | 0.20 | 1.0 if hypothesis type is `causal` or `structural`, else 0.5; reduce by 0.1 for each other validated hypothesis with the same variable pair |

```python
scope_map = {"minimal": 0.0, "moderate": 0.5, "broad": 0.75, "robust": 1.0}

for hid in validated_ids:
    r   = results[hid]
    f   = falsifications.get(hid, {})
    g   = generalizations.get(hid, {})
    hyp = hypotheses[hid]

    stat_score  = min(1.0 - r["p_value"], 0.999)
    prac_score  = min(abs(r["effect_size"]) / 0.5, 1.0)
    rob_score   = (f.get("checks_run", 0) - f.get("checks_falsified", 0)) / max(f.get("checks_run", 1), 1)
    gen_score   = scope_map.get(g.get("scope", "minimal"), 0.0)
    novelty     = 1.0 if hyp["type"] in ("causal", "structural") else 0.5

    importance  = (0.15 * stat_score + 0.25 * prac_score + 0.25 * rob_score
                   + 0.15 * gen_score + 0.20 * novelty)
```

Rank by `importance` descending.

### 8. Write final-report.json

```json
{
  "schema_version": "1.0",
  "generated_at": "<ISO-8601 timestamp>",
  "summary": {
    "total_hypotheses_generated": 24,
    "total_tested": 18,
    "total_validated": 7,
    "total_falsified": 3,
    "total_rejected": 8
  },
  "inventory": { ... },
  "clusters": [ ... ],
  "causal_graph": {
    "nodes": ["col_x", "col_y"],
    "edges": [ ... ],
    "chains": [ ... ],
    "contradictions": [ ... ]
  },
  "consistency_issues": [ ... ],
  "gap_analysis": {
    "unexplored_variables": ["col_a", "col_b"],
    "unexplored_high_priority_leads": [ ... ],
    "unexplored_hypothesis_types": ["structural"]
  },
  "ranked_findings": [
    {
      "rank": 1,
      "hypothesis_id": "H-003",
      "title": "...",
      "importance_score": 0.81,
      "scores": {
        "statistical": 0.998,
        "practical": 0.68,
        "robustness": 1.0,
        "generalisability": 0.5,
        "novelty": 1.0
      }
    }
  ]
}
```

Write atomically:

```python
out = data_dir / "final-report.json"
tmp = out.with_suffix(".tmp")
tmp.write_text(json.dumps(report, indent=2, default=str))
tmp.rename(out)
```

### 9. Write final-report.md

Use the finding documents from `.plurics/shared/findings/` as the basis for the
human-readable report. Each finding document is already a self-contained summary;
incorporate them directly rather than re-summarizing from JSON.

Write a human-readable markdown report structured as follows:

```markdown
# Research Pipeline Final Report

Generated: <ISO-8601 timestamp>

## Executive Summary

<2-3 sentence summary of the most important findings>

## Top Findings

For each of the top 5 ranked findings (by importance score), include:

### Finding N: <title> (Importance: <score>)

{Insert the content from the corresponding H-NNN-finding.md file here,
preserving all sections: Hypothesis, Method, Result, Falsification,
Generalization, and Verdict.}

## Causal Graph

<Describe chains and contradictions in plain English>

## Gaps and Recommendations

<Unexplored variables, leads, and types with brief explanation of why they are worth investigating>

## Consistency Issues

<Any Simpson's paradox or contradictions found, or "None detected.">

## Full Findings Inventory

| ID | Title | Type | Status | Effect | p-value | Importance |
|---|---|---|---|---|---|---|
<one row per hypothesis>
```

Write:

```python
out_md = data_dir / "final-report.md"
out_md.write_text(markdown_content)
```

### 10. Signal completion

```python
sig = data_dir / "signals"
sig.mkdir(exist_ok=True)
(sig / "meta-analyst.done").write_text("ok")
print("META_ANALYST_SIGNAL: complete")
```

## Quality checklist

- [ ] Every hypothesis (all rounds) included in inventory.
- [ ] Clusters cover all validated findings.
- [ ] Causal graph built from causal-type findings.
- [ ] Importance scores computed for all validated findings.
- [ ] Ranked findings sorted by importance descending.
- [ ] Gap analysis covers variables, leads, and types.
- [ ] `final-report.json` is valid JSON.
- [ ] `final-report.md` is well-formed markdown.
- [ ] Signal written.
