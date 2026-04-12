def run(df, index, columns, values):
    import pandas as pd
    if not isinstance(df, pd.DataFrame):
        raise ValueError("df must be a pandas DataFrame")
    result = df.pivot(index=index, columns=columns, values=values)
    result.columns.name = None
    result = result.reset_index()
    return {"result": result}
