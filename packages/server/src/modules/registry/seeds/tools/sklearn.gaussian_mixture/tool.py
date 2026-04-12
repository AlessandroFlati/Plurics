def run(matrix, n_components, extra_params=None):
    from sklearn.mixture import GaussianMixture
    import numpy as np
    extra_params = extra_params or {}
    X_arr = np.array(matrix)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    gmm = GaussianMixture(n_components=n_components, random_state=42, **extra_params)
    gmm.fit(X_arr)
    labels = gmm.predict(X_arr)
    probabilities = gmm.predict_proba(X_arr)
    return {
        "labels": labels,
        "probabilities": probabilities,
        "aic": float(gmm.aic(X_arr)),
        "bic": float(gmm.bic(X_arr)),
        "model": gmm,
    }
