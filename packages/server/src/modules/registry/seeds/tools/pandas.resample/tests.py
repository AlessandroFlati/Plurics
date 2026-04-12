# tests.py -- uses invoke_tool provided by the test runner context

def test_resample_reduces_rows():
    """Resampling 60 minutely rows to hourly yields 1 row."""
    import pandas as pd
    import numpy as np
    idx = pd.date_range("2024-01-01", periods=60, freq="min")
    df = pd.DataFrame({"v": np.ones(60)}, index=idx)
    result = invoke_tool(df=df, frequency="1h", agg="mean")
    assert len(result["resampled"]) == 1


def test_resample_sum():
    """Resampled sum over 4 daily rows to one week gives sum of all values."""
    import pandas as pd
    import numpy as np
    idx = pd.date_range("2024-01-01", periods=4, freq="D")
    df = pd.DataFrame({"v": [1.0, 2.0, 3.0, 4.0]}, index=idx)
    result = invoke_tool(df=df, frequency="W", agg="sum")
    assert result["resampled"]["v"].sum() == 10.0


def test_resample_output_has_datetime_index():
    """Resampled output retains a datetime index."""
    import pandas as pd
    import numpy as np
    idx = pd.date_range("2024-01-01", periods=10, freq="h")
    df = pd.DataFrame({"x": np.arange(10, dtype=float)}, index=idx)
    result = invoke_tool(df=df, frequency="D", agg="mean")
    assert isinstance(result["resampled"].index, pd.DatetimeIndex)
