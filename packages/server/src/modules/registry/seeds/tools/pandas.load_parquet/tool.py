def run(path, columns=None, extra_params=None):
    import pandas as pd
    extra_params = extra_params or {}
    kwargs = {}
    if columns is not None:
        kwargs['columns'] = columns
    df = pd.read_parquet(path, **kwargs, **extra_params)
    return {"df": df}
