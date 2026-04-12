def run(path, parse_dates=None, index_col=None, dtype=None, extra_params=None):
    import pandas as pd
    extra_params = extra_params or {}
    kwargs = {}
    if parse_dates is not None:
        kwargs['parse_dates'] = parse_dates
    if index_col is not None:
        kwargs['index_col'] = index_col
    if dtype is not None:
        kwargs['dtype'] = dtype
    df = pd.read_csv(path, **kwargs, **extra_params)
    return {"df": df}
