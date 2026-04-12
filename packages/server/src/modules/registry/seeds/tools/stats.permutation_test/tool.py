_STATISTICS = {
    'mean_diff': lambda x, y: __import__('numpy').mean(x) - __import__('numpy').mean(y),
    'median_diff': lambda x, y: __import__('numpy').median(x) - __import__('numpy').median(y),
}


def run(sample_a, sample_b, statistic, n_resamples=9999, extra_params=None):
    import numpy as np
    from scipy import stats
    extra_params = extra_params or {}
    if statistic not in _STATISTICS:
        raise ValueError(f"statistic must be one of {list(_STATISTICS)}, got {statistic!r}")
    a_arr = np.array(sample_a, dtype=float)
    b_arr = np.array(sample_b, dtype=float)
    result = stats.permutation_test(
        (a_arr, b_arr),
        _STATISTICS[statistic],
        n_resamples=n_resamples,
        alternative='two-sided',
        random_state=0,
        **extra_params,
    )
    return {"statistic": float(result.statistic), "p_value": float(result.pvalue)}
