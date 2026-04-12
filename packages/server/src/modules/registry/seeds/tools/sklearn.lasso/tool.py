def run(X, y, alpha):
    import numpy as np
    from sklearn.linear_model import Lasso
    if alpha <= 0:
        raise ValueError("alpha must be positive")
    model = Lasso(alpha=alpha, max_iter=10000)
    model.fit(X, y)
    r_squared = float(model.score(X, y))
    return {
        "coefficients": model.coef_,
        "intercept": float(model.intercept_),
        "r_squared": r_squared,
    }
