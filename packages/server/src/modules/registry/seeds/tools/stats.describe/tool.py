def run(df, percentiles=None):
    if percentiles is None:
        percentiles = [0.25, 0.5, 0.75]
    stats = df.describe(percentiles=percentiles)
    return {"stats": stats}
