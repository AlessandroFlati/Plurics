def run(matrix, n_components, extra_params=None):
    from sklearn.decomposition import NMF
    import numpy as np
    extra_params = extra_params or {}
    X_arr = np.array(matrix)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    model = NMF(n_components=n_components, random_state=0, **extra_params)
    W = model.fit_transform(X_arr)
    return {
        "W": W,
        "H": model.components_,
    }
