# tests.py -- uses invoke_tool provided by the test runner context

def test_basic_garch():
    """GARCH(1,1) returns aic, bic, and conditional_volatility."""
    import numpy as np
    rng = np.random.default_rng(0)
    returns = rng.normal(scale=0.01, size=200)
    result = invoke_tool(returns=returns, p=1, q=1)
    assert "aic" in result and "bic" in result
    assert "conditional_volatility" in result


def test_volatility_positive():
    """Conditional volatility values are all positive."""
    import numpy as np
    returns = np.random.default_rng(1).normal(scale=0.02, size=150)
    result = invoke_tool(returns=returns, p=1, q=1)
    import pandas as pd
    vol = result["conditional_volatility"]
    assert (vol > 0).all()


def test_aic_bic_ordering():
    """AIC and BIC are finite floats."""
    import numpy as np
    returns = np.random.default_rng(5).normal(scale=0.01, size=200)
    result = invoke_tool(returns=returns)
    assert np.isfinite(result["aic"])
    assert np.isfinite(result["bic"])
