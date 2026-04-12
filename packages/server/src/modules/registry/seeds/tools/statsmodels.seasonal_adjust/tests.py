# tests.py -- uses invoke_tool provided by the test runner context

def test_output_shape():
    """Seasonally adjusted output has the same length as input."""
    import numpy as np
    t = np.arange(48)
    values = 5.0 * t + 10 * np.sin(2 * np.pi * t / 12)
    result = invoke_tool(values=values, period=12)
    assert len(result["adjusted"]) == len(values)


def test_seasonal_removed():
    """Adjusted series has smaller seasonal amplitude than the original."""
    import numpy as np
    t = np.arange(48)
    seasonal = 20 * np.sin(2 * np.pi * t / 12)
    values = 1.0 * t + seasonal
    result = invoke_tool(values=values, period=12)
    adjusted = result["adjusted"]
    valid = adjusted[~np.isnan(adjusted)]
    assert valid.std() < values.std()


def test_output_is_numpy():
    """Output adjusted is a numpy array."""
    import numpy as np
    values = np.tile([1.0, 2.0, 3.0, 4.0], 12)
    result = invoke_tool(values=values, period=4)
    assert isinstance(result["adjusted"], np.ndarray)
