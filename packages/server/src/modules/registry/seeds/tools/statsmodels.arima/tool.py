def run(series, order, extra_params=None):
    from statsmodels.tsa.arima.model import ARIMA
    extra_params = extra_params or {}
    p, d, q = int(order[0]), int(order[1]), int(order[2])
    arima = ARIMA(series, order=(p, d, q), **extra_params)
    result = arima.fit()
    return {
        "aic": float(result.aic),
        "bic": float(result.bic),
        "residuals": result.resid,
        "fitted": result.fittedvalues,
        "model": result,
    }
