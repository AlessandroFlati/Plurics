def run(df, rule, agg):
    import pandas as pd
    if not isinstance(df, pd.DataFrame):
        raise ValueError("df must be a pandas DataFrame")
    resampled = df.resample(rule)
    agg_fn = getattr(resampled, agg, None)
    if agg_fn is None:
        raise ValueError(f"Unsupported aggregation function: '{agg}'")
    result = agg_fn()
    return {"result": result}
