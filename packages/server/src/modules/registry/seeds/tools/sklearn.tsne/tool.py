def run(matrix, n_components=2, perplexity=30.0, extra_params=None):
    from sklearn.manifold import TSNE
    import numpy as np
    extra_params = extra_params or {}
    X_arr = np.array(matrix)
    tsne = TSNE(n_components=n_components, perplexity=perplexity, random_state=0, **extra_params)
    embedding = tsne.fit_transform(X_arr)
    return {"embedding": embedding}
