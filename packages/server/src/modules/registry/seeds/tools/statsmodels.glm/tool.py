def run(x, y, family="gaussian", extra_params=None):
    import numpy as np
    import statsmodels.api as sm
    extra_params = extra_params or {}
    FAMILIES = {
        'gaussian': sm.families.Gaussian(),
        'binomial': sm.families.Binomial(),
        'poisson': sm.families.Poisson(),
        'gamma': sm.families.Gamma(),
        'inverse_gaussian': sm.families.InverseGaussian(),
        'negative_binomial': sm.families.NegativeBinomial(),
        'tweedie': sm.families.Tweedie(),
    }
    if family not in FAMILIES:
        raise ValueError(f"family must be one of {list(FAMILIES.keys())}, got {family!r}")
    X = sm.add_constant(x)
    result = sm.GLM(y, X, family=FAMILIES[family], **extra_params).fit()
    return {
        "coefficients": np.array(result.params),
        "p_values": np.array(result.pvalues),
        "model": result,
    }
