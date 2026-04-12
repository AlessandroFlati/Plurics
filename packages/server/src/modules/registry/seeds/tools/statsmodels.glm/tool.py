def run(X, y, family):
    import numpy as np
    import statsmodels.api as sm
    FAMILIES = {
        'gaussian': sm.families.Gaussian(),
        'binomial': sm.families.Binomial(),
        'poisson': sm.families.Poisson(),
    }
    if family not in FAMILIES:
        raise ValueError(f"family must be one of {list(FAMILIES.keys())}, got {family!r}")
    X_with_const = sm.add_constant(X)
    model = sm.GLM(y, X_with_const, family=FAMILIES[family]).fit()
    return {
        "coefficients": np.array(model.params),
        "p_values": np.array(model.pvalues),
        "aic": float(model.aic),
    }
