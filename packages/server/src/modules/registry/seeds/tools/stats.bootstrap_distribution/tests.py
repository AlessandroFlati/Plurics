# tests.py -- uses invoke_tool provided by the test runner context

def test_distribution_length():
    """Bootstrap distribution has length equal to n_resamples."""
    import numpy as np
    sample = np.random.default_rng(0).normal(size=50)
    result = invoke_tool(sample=sample, statistic="mean", n_resamples=500)
    assert len(result["distribution"]) == 500


def test_mean_statistic_centered():
    """Bootstrap mean distribution is centered near the sample mean."""
    import numpy as np
    rng = np.random.default_rng(42)
    sample = rng.normal(loc=10.0, scale=1.0, size=100)
    result = invoke_tool(sample=sample, statistic="mean", n_resamples=1000)
    boot_mean = float(np.mean(result["distribution"]))
    assert abs(boot_mean - sample.mean()) < 0.5


def test_std_statistic_positive():
    """Bootstrap std distribution values are all non-negative."""
    import numpy as np
    sample = np.random.default_rng(7).normal(size=80)
    result = invoke_tool(sample=sample, statistic="std", n_resamples=300)
    assert (result["distribution"] >= 0).all()
