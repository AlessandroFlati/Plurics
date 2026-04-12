def run(df, query):
    import pandas as pd
    if not isinstance(df, pd.DataFrame):
        raise ValueError("df must be a pandas DataFrame")
    filtered = df.query(query)
    return {"filtered": filtered}
