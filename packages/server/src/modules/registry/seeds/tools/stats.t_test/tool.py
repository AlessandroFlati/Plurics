def run(sample_a, sample_b, equal_var=True, extra_params=None):
    import numpy as np
    from scipy import stats
    extra_params = extra_params or {}
    a_arr = np.array(sample_a, dtype=float)
    b_arr = np.array(sample_b, dtype=float)
    result = stats.ttest_ind(a_arr, b_arr, equal_var=equal_var, **extra_params)
    return {"statistic": float(result.statistic), "p_value": float(result.pvalue)}
