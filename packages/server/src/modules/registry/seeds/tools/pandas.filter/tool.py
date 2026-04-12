def run(df, query):
    import pandas as pd
    if not isinstance(df, pd.DataFrame):
        raise ValueError("df must be a pandas DataFrame")
    result = df.query(query)
    return {"result": result}
