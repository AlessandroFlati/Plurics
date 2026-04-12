def run(matrix, n_components=None, whiten=False, extra_params=None):
    from sklearn.decomposition import PCA
    import numpy as np
    extra_params = extra_params or {}
    X_arr = np.array(matrix)
    pca = PCA(n_components=n_components, whiten=whiten, **extra_params)
    loadings = pca.fit_transform(X_arr)
    return {
        "components": pca.components_,
        "loadings": loadings,
        "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
    }
