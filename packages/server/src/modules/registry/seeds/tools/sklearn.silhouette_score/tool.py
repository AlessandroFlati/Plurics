def run(matrix, labels):
    from sklearn.metrics import silhouette_score
    score = float(silhouette_score(matrix, labels))
    return {"score": score}
