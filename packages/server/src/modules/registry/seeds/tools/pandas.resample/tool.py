def run(df, frequency, agg="mean"):
    import pandas as pd
    if not isinstance(df, pd.DataFrame):
        raise ValueError("df must be a pandas DataFrame")
    resampled = df.resample(frequency)
    agg_fn = getattr(resampled, agg, None)
    if agg_fn is None:
        raise ValueError(f"Unsupported aggregation function: '{agg}'")
    result = agg_fn()
    return {"resampled": result}
