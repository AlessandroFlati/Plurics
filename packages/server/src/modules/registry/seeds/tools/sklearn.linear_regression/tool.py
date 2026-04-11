def run(X, y):
    import numpy as np
    from sklearn.linear_model import LinearRegression
    model = LinearRegression()
    model.fit(X, y)
    r_squared = float(model.score(X, y))
    return {
        "coefficients": model.coef_,
        "intercept": float(model.intercept_),
        "r_squared": r_squared,
    }
