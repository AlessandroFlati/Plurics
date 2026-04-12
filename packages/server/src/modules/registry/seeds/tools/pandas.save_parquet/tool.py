def run(df, path):
    df.to_parquet(path, index=False)
    return {"written": True}
