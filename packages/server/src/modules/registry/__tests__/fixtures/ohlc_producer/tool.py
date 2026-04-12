def run():
    import numpy as np
    import pandas as pd

    dates = pd.date_range('2024-01-01', periods=5, freq='D')
    close_prices = np.array([100.0, 102.0, 101.0, 103.0, 105.0])
    df = pd.DataFrame({
        'open': close_prices * 0.99,
        'high': close_prices * 1.01,
        'low': close_prices * 0.98,
        'close': close_prices,
    }, index=dates)
    return {'ohlc': df}
