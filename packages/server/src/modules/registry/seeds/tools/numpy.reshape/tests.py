# tests.py -- uses invoke_tool provided by the test runner context

def test_reshape_1d_to_2d():
    """Reshape 12-element array to (3, 4)."""
    import numpy as np
    arr = np.arange(12, dtype=float)
    result = invoke_tool(array=arr, shape=[3, 4])
    assert result["result"].shape == (3, 4)


def test_reshape_inferred_dimension():
    """Reshape with -1 infers the correct dimension."""
    import numpy as np
    arr = np.arange(20, dtype=float)
    result = invoke_tool(array=arr, shape=[4, -1])
    assert result["result"].shape == (4, 5)


def test_reshape_preserves_values():
    """Reshaped array preserves all original values."""
    import numpy as np
    arr = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    result = invoke_tool(array=arr, shape=[2, 3])
    assert result["result"].flatten().tolist() == arr.tolist()
