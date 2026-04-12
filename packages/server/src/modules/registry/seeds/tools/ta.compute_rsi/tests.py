# tests.py -- uses invoke_tool provided by the test runner context

def test_rsi_length():
    """RSI output has the same length as the input."""
    import numpy as np
    close = np.array([44, 45, 44, 46, 45, 47, 46, 48, 47, 49, 48, 50, 51, 50, 52], dtype=float)
    result = invoke_tool(close=close, period=14)
    assert len(result["rsi"]) == len(close)


def test_rsi_range():
    """All non-NaN RSI values are between 0 and 100."""
    import numpy as np
    rng = np.random.default_rng(42)
    close = 100.0 + np.cumsum(rng.normal(size=50))
    result = invoke_tool(close=close, period=14)
    rsi = result["rsi"]
    valid = rsi[~np.isnan(rsi)]
    assert (valid >= 0).all() and (valid <= 100).all()


def test_rsi_constant_prices():
    """RSI of a constant price series is 50 (no gain, no loss)."""
    import numpy as np
    close = np.full(30, 100.0)
    result = invoke_tool(close=close, period=14)
    rsi = result["rsi"]
    valid = rsi[~np.isnan(rsi)]
    assert (abs(valid - 50.0) < 1e-6).all()
