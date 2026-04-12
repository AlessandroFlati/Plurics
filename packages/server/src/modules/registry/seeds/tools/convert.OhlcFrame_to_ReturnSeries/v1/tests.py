import math
import numpy as np
import pandas as pd
from tool import run


def test_basic_returns():
    prices = [100.0, 101.0, 99.0, 102.0]
    df = pd.DataFrame(
        {"open": prices, "high": prices, "low": prices, "close": prices},
        index=pd.date_range("2024-01-01", periods=4, freq="D"),
    )
    result = run(df)
    returns = result["target"]
    assert isinstance(returns, pd.Series)
    assert len(returns) == 3  # n-1 after dropna


def test_first_return_value():
    prices = [100.0, 110.0]
    df = pd.DataFrame(
        {"open": prices, "high": prices, "low": prices, "close": prices},
        index=pd.date_range("2024-01-01", periods=2, freq="D"),
    )
    result = run(df)
    returns = result["target"]
    expected = math.log(110.0 / 100.0)
    assert abs(returns.iloc[0] - expected) < 1e-10


if __name__ == "__main__":
    test_basic_returns()
    test_first_return_value()
    print("All tests passed.")
