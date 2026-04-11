def run(X, y):
    import numpy as np
    import statsmodels.api as sm
    X_with_const = sm.add_constant(X)
    model = sm.OLS(y, X_with_const).fit()
    return {
        "coefficients": np.array(model.params),
        "p_values": np.array(model.pvalues),
        "r_squared": float(model.rsquared),
    }
