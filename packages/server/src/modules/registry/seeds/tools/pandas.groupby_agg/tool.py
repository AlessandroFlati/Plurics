def run(df, by, agg):
    import pandas as pd
    if not isinstance(df, pd.DataFrame):
        raise ValueError("df must be a pandas DataFrame")
    if not isinstance(by, list) or len(by) == 0:
        raise ValueError("by must be a non-empty list of column names")
    result = df.groupby(by).agg(agg).reset_index()
    return {"result": result}
