def run(matrix, n_components=None, extra_params=None):
    from sklearn.decomposition import FastICA
    import numpy as np
    extra_params = extra_params or {}
    X_arr = np.array(matrix)
    ica = FastICA(n_components=n_components, random_state=0, **extra_params)
    sources = ica.fit_transform(X_arr)
    return {
        "components": ica.components_,
        "sources": sources,
    }
