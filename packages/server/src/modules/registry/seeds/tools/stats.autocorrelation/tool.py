def run(values, max_lag):
    import numpy as np
    arr = np.array(values, dtype=float)
    n = len(arr)
    if max_lag < 0 or max_lag >= n:
        raise ValueError("max_lag must be in [0, len(values)-1]")
    arr_mean = arr - arr.mean()
    full_corr = np.correlate(arr_mean, arr_mean, mode='full')
    acf = full_corr[n - 1: n + max_lag] / full_corr[n - 1]
    return {"acf": acf.tolist()}
