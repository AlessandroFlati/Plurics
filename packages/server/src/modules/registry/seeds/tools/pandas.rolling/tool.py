def run(df, window, agg):
    import pandas as pd
    if not isinstance(df, pd.DataFrame):
        raise ValueError("df must be a pandas DataFrame")
    if window < 1:
        raise ValueError("window must be >= 1")
    rolled = df.rolling(window=window)
    agg_fn = getattr(rolled, agg, None)
    if agg_fn is None:
        raise ValueError(f"Unsupported aggregation function: '{agg}'")
    result = agg_fn()
    return {"result": result}
