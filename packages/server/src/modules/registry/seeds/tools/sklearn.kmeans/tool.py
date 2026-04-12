def run(matrix, n_clusters, extra_params=None):
    from sklearn.cluster import KMeans
    import numpy as np
    extra_params = extra_params or {}
    X_arr = np.array(matrix)
    if n_clusters < 1:
        raise ValueError("n_clusters must be >= 1")
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, **extra_params)
    labels = kmeans.fit_predict(X_arr)
    return {
        "labels": labels,
        "centers": kmeans.cluster_centers_,
        "inertia": float(kmeans.inertia_),
        "model": kmeans,
    }
