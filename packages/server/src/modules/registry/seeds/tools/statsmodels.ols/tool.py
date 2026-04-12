def run(x, y, add_constant=True):
    import numpy as np
    import statsmodels.api as sm
    X = sm.add_constant(x) if add_constant else x
    result = sm.OLS(y, X).fit()
    return {
        "coefficients": np.array(result.params),
        "p_values": np.array(result.pvalues),
        "r_squared": float(result.rsquared),
        "summary": str(result.summary()),
    }
