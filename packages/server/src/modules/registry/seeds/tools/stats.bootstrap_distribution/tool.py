_STATISTICS = {
    "mean": None,
    "median": None,
    "std": None,
}

def run(sample, statistic, n_resamples=None):
    import numpy as np
    if n_resamples is None:
        n_resamples = 9999
    stat_fns = {
        "mean": np.mean,
        "median": np.median,
        "std": np.std,
    }
    if statistic not in stat_fns:
        raise ValueError(f"statistic must be one of {list(stat_fns)}, got {statistic!r}")
    fn = stat_fns[statistic]
    rng = np.random.default_rng()
    sample_arr = np.asarray(sample)
    n = len(sample_arr)
    dist = np.empty(n_resamples)
    for i in range(n_resamples):
        resample = rng.choice(sample_arr, size=n, replace=True)
        dist[i] = fn(resample)
    return {"distribution": dist}
