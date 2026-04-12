def run(series, regression="c", extra_params=None):
    from statsmodels.tsa.stattools import adfuller
    extra_params = extra_params or {}
    result = adfuller(series, regression=regression, **extra_params)
    statistic, p_value, _used_lag, _nobs, critical_values = result[0], result[1], result[2], result[3], result[4]
    return {
        "statistic": float(statistic),
        "p_value": float(p_value),
        "critical_values": {k: float(v) for k, v in critical_values.items()},
    }
