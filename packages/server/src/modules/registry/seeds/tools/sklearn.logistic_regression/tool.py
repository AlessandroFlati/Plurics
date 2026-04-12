def run(X, y):
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    model = LogisticRegression(max_iter=1000)
    model.fit(X, y)
    accuracy = float(model.score(X, y))
    return {
        "coefficients": model.coef_,
        "intercept": float(model.intercept_[0]),
        "accuracy": accuracy,
    }
