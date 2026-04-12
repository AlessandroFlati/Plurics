def run(X, n_components):
    from sklearn.decomposition import PCA
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    pca = PCA(n_components=n_components)
    transformed = pca.fit_transform(X_arr)
    return {
        "components": pca.components_,
        "explained_variance": pca.explained_variance_,
        "transformed": transformed,
    }
