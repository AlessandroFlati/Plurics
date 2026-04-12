def run(df, path, index=True, extra_params=None):
    extra_params = extra_params or {}
    df.to_csv(path, index=index, **extra_params)
    return {"path": path}
