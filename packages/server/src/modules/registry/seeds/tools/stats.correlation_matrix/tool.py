def run(df, method="pearson"):
    corr = df.corr(method=method, numeric_only=True)
    return {"corr": corr}
