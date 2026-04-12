def run(x, y):
    from sklearn.metrics import mutual_info_score
    mi = float(mutual_info_score(x, y))
    return {"mi": mi}
