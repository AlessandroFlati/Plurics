def run(path):
    import pandas as pd
    df = pd.read_parquet(path)
    return {"df": df}
