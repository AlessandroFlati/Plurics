# tests.py -- uses invoke_tool provided by the test runner context

def test_rolling_mean_length():
    """Rolling mean output has same length as input."""
    import pandas as pd
    import numpy as np
    df = pd.DataFrame({"v": np.arange(10, dtype=float)})
    result = invoke_tool(df=df, window=3, agg="mean")
    assert len(result["result"]) == 10


def test_rolling_mean_values():
    """Rolling mean of [1,2,3,4,5] with window=3 at index 2 is 2.0."""
    import pandas as pd
    df = pd.DataFrame({"v": [1.0, 2.0, 3.0, 4.0, 5.0]})
    result = invoke_tool(df=df, window=3, agg="mean")
    assert abs(result["result"]["v"].iloc[2] - 2.0) < 1e-9


def test_rolling_sum():
    """Rolling sum with window=2 gives correct cumulative sums."""
    import pandas as pd
    df = pd.DataFrame({"v": [1.0, 2.0, 3.0, 4.0]})
    result = invoke_tool(df=df, window=2, agg="sum")
    vals = result["result"]["v"].dropna().tolist()
    assert vals == [3.0, 5.0, 7.0]
