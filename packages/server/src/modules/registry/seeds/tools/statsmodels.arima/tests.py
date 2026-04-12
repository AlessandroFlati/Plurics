# tests.py -- uses invoke_tool provided by the test runner context

def test_basic_fit():
    """ARIMA(1,0,0) on synthetic AR data returns aic and bic."""
    import numpy as np
    rng = np.random.default_rng(42)
    series = rng.normal(size=100)
    result = invoke_tool(series=series, order=[1, 0, 0])
    assert "aic" in result and "bic" in result
    assert isinstance(result["aic"], float)


def test_residuals_length():
    """Residuals series has the same length as the input."""
    import numpy as np
    series = np.cumsum(np.random.default_rng(7).normal(size=80))
    result = invoke_tool(series=series, order=[1, 1, 0])
    import pandas as pd
    residuals = result["residuals"]
    assert len(residuals) == len(series)


def test_fitted_values():
    """Fitted values are returned and have correct length."""
    import numpy as np
    series = np.sin(np.linspace(0, 4 * np.pi, 60)) + np.random.default_rng(3).normal(scale=0.1, size=60)
    result = invoke_tool(series=series, order=[2, 0, 1])
    assert len(result["fitted"]) == len(series)
