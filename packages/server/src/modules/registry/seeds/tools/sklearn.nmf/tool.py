def run(X, n_components):
    from sklearn.decomposition import NMF
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    model = NMF(n_components=n_components, random_state=0)
    W = model.fit_transform(X_arr)
    return {
        "W": W,
        "H": model.components_,
        "reconstruction_error": float(model.reconstruction_err_),
    }
