# tests.py -- uses invoke_tool provided by the test runner context

def test_additive_components():
    """Additive decomposition returns trend, seasonal, and residual."""
    import numpy as np
    t = np.arange(48)
    series = 2.0 * t + 10 * np.sin(2 * np.pi * t / 12) + np.random.default_rng(0).normal(size=48)
    result = invoke_tool(series=series, period=12, model="additive")
    assert "trend" in result and "seasonal" in result and "residual" in result


def test_component_lengths():
    """All components have the same length as the input series."""
    import numpy as np
    series = np.tile([1, 2, 3, 4], 10).astype(float)
    result = invoke_tool(series=series, period=4)
    assert len(result["seasonal"]) == len(series)
    assert len(result["residual"]) == len(series)


def test_multiplicative_runs():
    """Multiplicative decomposition completes without error."""
    import numpy as np
    series = np.abs(np.sin(np.linspace(0, 6 * np.pi, 36))) + 1.0
    result = invoke_tool(series=series, period=6, model="multiplicative")
    assert "trend" in result
