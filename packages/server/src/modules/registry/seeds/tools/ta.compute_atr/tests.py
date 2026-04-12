# tests.py -- uses invoke_tool provided by the test runner context

def test_atr_length():
    """ATR output has the same length as the input."""
    import numpy as np
    n = 30
    high = np.linspace(101, 130, n)
    low = np.linspace(99, 128, n)
    close = np.linspace(100, 129, n)
    result = invoke_tool(high=high, low=low, close=close, period=14)
    assert len(result["atr"]) == n


def test_atr_positive():
    """All non-NaN ATR values are positive."""
    import numpy as np
    rng = np.random.default_rng(0)
    base = 100.0 + np.cumsum(rng.normal(size=40))
    high = base + abs(rng.normal(size=40))
    low = base - abs(rng.normal(size=40))
    result = invoke_tool(high=high, low=low, close=base, period=14)
    atr = result["atr"]
    valid = atr[~np.isnan(atr)]
    assert (valid > 0).all()


def test_atr_wider_range_means_higher_atr():
    """Doubling the high-low range roughly doubles the ATR."""
    import numpy as np
    n = 40
    base = np.linspace(100, 140, n)
    result1 = invoke_tool(high=base + 1, low=base - 1, close=base, period=5)
    result2 = invoke_tool(high=base + 2, low=base - 2, close=base, period=5)
    atr1 = result1["atr"][~np.isnan(result1["atr"])].mean()
    atr2 = result2["atr"][~np.isnan(result2["atr"])].mean()
    assert atr2 > atr1
