# tests.py -- uses invoke_tool provided by the test runner context

def test_p_values_length():
    """p_values list has length equal to max_lag."""
    import numpy as np
    rng = np.random.default_rng(0)
    cause = rng.normal(size=100)
    effect = rng.normal(size=100)
    result = invoke_tool(cause=cause, effect=effect, max_lag=5)
    assert len(result["p_values"]) == 5


def test_p_values_in_range():
    """All p-values are between 0 and 1."""
    import numpy as np
    rng = np.random.default_rng(1)
    cause = rng.normal(size=80)
    effect = cause + rng.normal(scale=0.5, size=80)
    result = invoke_tool(cause=cause, effect=effect, max_lag=3)
    for pv in result["p_values"]:
        assert 0.0 <= pv <= 1.0


def test_best_lag_valid():
    """best_lag is an integer within [1, max_lag]."""
    import numpy as np
    rng = np.random.default_rng(2)
    x = rng.normal(size=100)
    y = np.roll(x, 2) + rng.normal(scale=0.1, size=100)
    result = invoke_tool(cause=x, effect=y, max_lag=4)
    assert 1 <= result["best_lag"] <= 4
