def run(matrix, eps=0.5, min_samples=5):
    from sklearn.cluster import DBSCAN
    import numpy as np
    X_arr = np.array(matrix)
    if eps <= 0:
        raise ValueError("eps must be > 0")
    if min_samples < 1:
        raise ValueError("min_samples must be >= 1")
    dbscan = DBSCAN(eps=eps, min_samples=min_samples)
    labels = dbscan.fit_predict(X_arr)
    n_noise = int(np.sum(labels == -1))
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    return {
        "labels": labels,
        "n_clusters": int(n_clusters),
        "n_noise": n_noise,
    }
