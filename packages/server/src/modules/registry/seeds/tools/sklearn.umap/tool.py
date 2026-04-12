def run(X, n_components, n_neighbors):
    from umap import UMAP
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    if n_neighbors < 2:
        raise ValueError("n_neighbors must be >= 2")
    reducer = UMAP(n_components=n_components, n_neighbors=n_neighbors, random_state=0)
    embedding = reducer.fit_transform(X_arr)
    return {"embedding": embedding}
