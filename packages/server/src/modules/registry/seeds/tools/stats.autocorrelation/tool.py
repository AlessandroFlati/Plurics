def run(series, nlags=40, extra_params=None):
    import numpy as np
    from statsmodels.tsa.stattools import acf
    extra_params = extra_params or {}
    result = acf(series, nlags=nlags, **extra_params)
    if isinstance(result, tuple):
        acf_vals, confint = result[0], result[1]
        return {"acf": np.array(acf_vals), "confint": np.array(confint)}
    return {"acf": np.array(result), "confint": None}
