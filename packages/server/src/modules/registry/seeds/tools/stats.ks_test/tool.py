def run(values, distribution, extra_params=None):
    import numpy as np
    from scipy import stats
    extra_params = extra_params or {}
    arr = np.array(values, dtype=float)
    result = stats.kstest(arr, distribution, **extra_params)
    return {"statistic": float(result.statistic), "p_value": float(result.pvalue)}
