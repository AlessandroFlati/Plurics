def run(sample_a, sample_b, extra_params=None):
    import numpy as np
    from scipy import stats
    extra_params = extra_params or {}
    a_arr = np.array(sample_a, dtype=float)
    b_arr = np.array(sample_b, dtype=float)
    result = stats.mannwhitneyu(a_arr, b_arr, alternative='two-sided', **extra_params)
    return {"statistic": float(result.statistic), "p_value": float(result.pvalue)}
