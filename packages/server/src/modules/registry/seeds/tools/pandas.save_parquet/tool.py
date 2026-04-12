def run(df, path, extra_params=None):
    extra_params = extra_params or {}
    df.to_parquet(path, **extra_params)
    return {"path": path}
