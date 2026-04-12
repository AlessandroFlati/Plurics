def run(x, y, alpha=1.0, extra_params=None):
    from sklearn.linear_model import Ridge
    extra_params = extra_params or {}
    if alpha <= 0:
        raise ValueError("alpha must be positive")
    model = Ridge(alpha=alpha, **extra_params)
    model.fit(x, y)
    r_squared = float(model.score(x, y))
    return {
        "coefficients": model.coef_,
        "intercept": float(model.intercept_),
        "r_squared": r_squared,
        "model": model,
    }
