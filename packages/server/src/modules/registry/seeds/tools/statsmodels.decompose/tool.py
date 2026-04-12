def run(series, period, model="additive"):
    from statsmodels.tsa.seasonal import seasonal_decompose
    result = seasonal_decompose(series, model=str(model), period=int(period), extrapolate_trend='freq')
    return {
        "trend": result.trend,
        "seasonal": result.seasonal,
        "residual": result.resid,
    }
