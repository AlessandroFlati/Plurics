def run(prices, method=None):
    import numpy as np
    import pandas as pd
    if method is None:
        method = "log"
    if method not in ("log", "simple"):
        raise ValueError(f"method must be 'log' or 'simple', got {method!r}")
    prices_series = pd.Series(prices) if not isinstance(prices, pd.Series) else prices
    if method == "log":
        returns = np.log(prices_series / prices_series.shift(1)).dropna()
    else:
        returns = prices_series.pct_change().dropna()
    return {"returns": returns}
