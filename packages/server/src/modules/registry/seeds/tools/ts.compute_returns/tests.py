# tests.py -- uses invoke_tool provided by the test runner context

def test_log_returns_length():
    """Log returns have length one less than prices."""
    import numpy as np
    import pandas as pd
    prices = pd.Series([100.0, 101.0, 99.5, 102.0, 103.5])
    result = invoke_tool(prices=prices, method="log")
    assert len(result["returns"]) == len(prices) - 1


def test_simple_returns_value():
    """Simple returns are computed correctly for a doubling price."""
    import numpy as np
    import pandas as pd
    prices = pd.Series([50.0, 100.0])
    result = invoke_tool(prices=prices, method="simple")
    assert abs(result["returns"].iloc[0] - 1.0) < 1e-9


def test_log_returns_default():
    """Default method produces log returns close to zero for stable prices."""
    import numpy as np
    import pandas as pd
    prices = pd.Series([100.0] * 20)
    result = invoke_tool(prices=prices)
    assert (result["returns"].abs() < 1e-10).all()
