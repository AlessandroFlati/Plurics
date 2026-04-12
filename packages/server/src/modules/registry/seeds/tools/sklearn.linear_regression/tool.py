def run(x, y, fit_intercept=True, extra_params=None):
    from sklearn.linear_model import LinearRegression
    extra_params = extra_params or {}
    model = LinearRegression(fit_intercept=fit_intercept, **extra_params)
    model.fit(x, y)
    r_squared = float(model.score(x, y))
    return {
        "coefficients": model.coef_,
        "intercept": float(model.intercept_),
        "r_squared": r_squared,
        "model": model,
    }
