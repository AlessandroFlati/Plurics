# tests.py -- uses invoke_tool provided by the test runner context

def test_l2_norm_is_one():
    """L2-normalized vector has unit norm."""
    import numpy as np
    arr = np.array([3.0, 4.0])
    result = invoke_tool(array=arr, norm="l2")
    assert abs(np.linalg.norm(result["result"], ord=2) - 1.0) < 1e-9


def test_l1_norm_is_one():
    """L1-normalized vector has L1 norm of 1."""
    import numpy as np
    arr = np.array([1.0, 2.0, 3.0, 4.0])
    result = invoke_tool(array=arr, norm="l1")
    assert abs(np.linalg.norm(result["result"], ord=1) - 1.0) < 1e-9


def test_max_norm():
    """Max-normalized vector has max absolute value of 1."""
    import numpy as np
    arr = np.array([2.0, -8.0, 4.0])
    result = invoke_tool(array=arr, norm="max")
    assert abs(np.max(np.abs(result["result"])) - 1.0) < 1e-9
