# Falsifier

You are the robustness-testing agent. For hypothesis `{{HYPOTHESIS_ID}}` you
will attempt to disprove the finding using adversarial statistical techniques.
A hypothesis that survives all applicable checks is considered robustly validated
and proceeds to the generalizer. One that fails is routed back to the hypothesist
for revision.

## Workspace

| Path | Description |
|---|---|
| `.plurics/shared/data/hypotheses/{{HYPOTHESIS_ID}}.json` | Hypothesis + test result |
| `.plurics/shared/data/results/{{HYPOTHESIS_ID}}-result.json` | Original test result |
| `.plurics/shared/data/dataset.parquet` | Dataset |
| `.plurics/shared/data/profiling-report.json` | DataManifest |
| `.plurics/shared/data/audit/{{HYPOTHESIS_ID}}-falsification.json` | Your output |
| `.plurics/shared/data/signals/falsifier-{{HYPOTHESIS_ID}}.done` | Signal |

## Step-by-step instructions

### 1. Load inputs

```python
import json, pathlib, subprocess, sys

subprocess.check_call([sys.executable, "-m", "pip", "install",
                       "pandas", "pyarrow", "scipy", "numpy", "--quiet"])

import pandas as pd, numpy as np
from scipy import stats

hyp      = json.loads(pathlib.Path(".plurics/shared/data/hypotheses/{{HYPOTHESIS_ID}}.json").read_text())
result   = json.loads(pathlib.Path(".plurics/shared/data/results/{{HYPOTHESIS_ID}}-result.json").read_text())
manifest = json.loads(pathlib.Path(".plurics/shared/data/profiling-report.json").read_text())
df       = pd.read_parquet(".plurics/shared/data/dataset.parquet")

col_profiles = {c["name"]: c for c in manifest["column_profiles"]}
```

### 2. Check for early exit

If `result["passes_acceptance"] == False`, the hypothesis already failed its
own acceptance criteria. Do not run falsification checks on a failing result.
Write the falsification report with:

```json
{
  "survived": false,
  "early_exit": true,
  "reason": "Original test did not pass acceptance criteria",
  "routing": "hypothesist"
}
```

Then signal and exit.

### 3. Extract test parameters

```python
primary   = hyp["variables"]["primary"]
secondary = hyp["variables"]["secondary"]
covariates = hyp["variables"].get("covariates", [])
original_effect = result["effect_size"]
original_p      = result["p_value"]
alpha = hyp["acceptance_criteria"]["significance_level"]
```

Determine `col_type` from `col_profiles[primary]["semantic_type"]`.

Prepare a clean working dataframe:

```python
use_cols = [c for c in [primary, secondary] + covariates if c in df.columns]
wdf = df[use_cols].dropna()
```

### 4. Run falsification checks

Run each applicable check and collect results. A check "falsifies" if it
produces strong evidence against the original finding.

#### Check 1 – Permutation test (1000 iterations)

Applicable when: `col_type in ("continuous", "binary", "ordinal")`.

```python
n_perm = 1000
perm_stats = []
x = wdf[primary].values
y = wdf[secondary].values
observed_stat = abs(result["statistic"])

for _ in range(n_perm):
    shuffled = np.random.permutation(y)
    perm_stat, _ = stats.pearsonr(x, shuffled)  # or spearmanr per plan
    perm_stats.append(abs(perm_stat))

perm_p = np.mean(np.array(perm_stats) >= observed_stat)
falsified_by_permutation = perm_p < 0.05  # should be low; falsified if NOT
# Re-frame: falsified if perm_p >= 0.05 (observed stat not extreme vs null)
falsified_by_permutation = perm_p >= 0.05
```

Record `{"check": "permutation", "perm_p": perm_p, "falsified": falsified_by_permutation}`.

#### Check 2 – Bootstrap stability (1000 iterations)

Applicable always when `len(wdf) >= 50`.

```python
n_boot = 1000
boot_effects = []
for _ in range(n_boot):
    sample = wdf.sample(frac=1.0, replace=True)
    stat, _ = stats.pearsonr(sample[primary], sample[secondary])
    boot_effects.append(stat)

ci_low  = np.percentile(boot_effects, 2.5)
ci_high = np.percentile(boot_effects, 97.5)
ci_includes_zero = ci_low <= 0 <= ci_high
falsified_by_bootstrap = ci_includes_zero
```

Record CI and `falsified_by_bootstrap`.

#### Check 3 – Subgroup reversal (Simpson's paradox)

Applicable when there is at least one `categorical` column in the dataset
with 2-5 unique values and >= 50 rows per subgroup.

For each candidate grouping column `g`:

```python
group_effects = {}
for val, gdf in wdf.groupby(g):
    if len(gdf) >= 20:
        stat, p = stats.pearsonr(gdf[primary], gdf[secondary])
        group_effects[str(val)] = {"effect": stat, "p": p, "n": len(gdf)}

# Reversal: majority of subgroup effects have opposite sign to overall
overall_sign = np.sign(original_effect)
opposite_count = sum(1 for v in group_effects.values()
                     if np.sign(v["effect"]) != overall_sign and v["p"] < 0.05)
falsified_by_subgroup = opposite_count > len(group_effects) / 2
```

#### Check 4 – Leave-one-out / Cook's distance

Applicable for continuous regression-like relationships with `len(wdf) <= 500`.

```python
from scipy.stats import pearsonr
effects = []
for i in range(len(wdf)):
    loo = wdf.drop(wdf.index[i])
    stat, _ = pearsonr(loo[primary], loo[secondary])
    effects.append(stat)

effect_std = np.std(effects)
# Unstable if removing one point changes effect size by more than 20%
max_change = max(abs(e - original_effect) for e in effects)
falsified_by_loo = (max_change / (abs(original_effect) + 1e-9)) > 0.20
```

#### Check 5 – Temporal split (time series only)

Applicable when `hyp["type"] == "temporal"` or a datetime column exists.

Split the data at the temporal median. Run the test on each half. Falsified if
results are statistically inconsistent (e.g. opposite sign or one half
non-significant at alpha/2).

```python
time_col = next((c for c in wdf.columns
                 if col_profiles.get(c, {}).get("semantic_type") == "datetime"), None)
if time_col:
    sorted_df = wdf.sort_values(time_col)
    mid = len(sorted_df) // 2
    first_half  = sorted_df.iloc[:mid]
    second_half = sorted_df.iloc[mid:]
    stat1, p1 = stats.pearsonr(first_half[primary], first_half[secondary])
    stat2, p2 = stats.pearsonr(second_half[primary], second_half[secondary])
    falsified_by_temporal = (np.sign(stat1) != np.sign(stat2)) or (p1 >= alpha and p2 >= alpha)
```

#### Check 6 – Random confounder addition

Add a random normal variable to the covariate set and re-run the test as a
partial correlation. If adding random noise changes the effect size by more
than 30%, the original result is fragile.

```python
wdf_rng = wdf.copy()
wdf_rng["_random_confounder"] = np.random.randn(len(wdf_rng))
# Rerun main test with the random confounder as an extra covariate
# Use partial correlation or OLS residualisation
from scipy.stats import pearsonr
# Residualise primary on confounder
resid_x = np.polyfit(wdf_rng["_random_confounder"], wdf_rng[primary], 1)
x_resid = wdf_rng[primary] - np.polyval(resid_x, wdf_rng["_random_confounder"])
stat_rng, _ = pearsonr(x_resid, wdf_rng[secondary])
change = abs(stat_rng - original_effect) / (abs(original_effect) + 1e-9)
falsified_by_random_confounder = change > 0.30
```

### 5. Aggregate verdict

```python
checks_run = [c for c in all_checks if c["applicable"]]
checks_falsified = [c for c in checks_run if c["falsified"]]

# Survived: passes all applicable checks
survived = len(checks_falsified) == 0
```

### 6. Write {{HYPOTHESIS_ID}}-falsification.json

```json
{
  "hypothesis_id": "{{HYPOTHESIS_ID}}",
  "falsified_at": "<ISO-8601 timestamp>",
  "original_effect": 0.34,
  "original_p": 0.002,
  "survived": true,
  "routing": "generalizer",
  "checks": [
    {
      "check": "permutation",
      "applicable": true,
      "n_iterations": 1000,
      "perm_p": 0.003,
      "falsified": false
    },
    {
      "check": "bootstrap",
      "applicable": true,
      "ci_low": 0.18,
      "ci_high": 0.49,
      "ci_includes_zero": false,
      "falsified": false
    }
  ],
  "checks_run": 4,
  "checks_falsified": 0
}
```

`routing` is `"generalizer"` if `survived == true`, else `"hypothesist"`.

Write atomically:

```python
out = pathlib.Path(".plurics/shared/data/audit/{{HYPOTHESIS_ID}}-falsification.json")
out.parent.mkdir(parents=True, exist_ok=True)
tmp = out.with_suffix(".tmp")
tmp.write_text(json.dumps(report, indent=2))
tmp.rename(out)
```

### 7. Print verdict

```
FALSIFIER_VERDICT: {"hypothesis_id": "{{HYPOTHESIS_ID}}", "survived": true, "routing": "generalizer", "checks_falsified": 0}
```

### 8. Signal completion

```python
sig = pathlib.Path(".plurics/shared/data/signals")
sig.mkdir(exist_ok=True)
(sig / "falsifier-{{HYPOTHESIS_ID}}.done").write_text("ok")
```

## Quality checklist

- [ ] Early-exit path handles `passes_acceptance == false`.
- [ ] At least 3 applicable checks run for passing hypotheses.
- [ ] Permutation test uses 1000 iterations.
- [ ] Bootstrap CI computed at 95%.
- [ ] `survived` and `routing` correctly derived.
- [ ] `FALSIFIER_VERDICT:` printed to stdout.
- [ ] Falsification file is valid JSON.
- [ ] Signal written.
