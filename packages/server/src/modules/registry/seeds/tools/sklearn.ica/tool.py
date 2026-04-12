def run(X, n_components):
    from sklearn.decomposition import FastICA
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    ica = FastICA(n_components=n_components, random_state=0)
    transformed = ica.fit_transform(X_arr)
    return {
        "components": ica.components_,
        "transformed": transformed,
    }
