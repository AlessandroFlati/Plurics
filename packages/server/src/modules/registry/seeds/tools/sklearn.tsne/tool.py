def run(X, n_components, perplexity):
    from sklearn.manifold import TSNE
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    if perplexity <= 0:
        raise ValueError("perplexity must be > 0")
    tsne = TSNE(n_components=n_components, perplexity=perplexity, random_state=0)
    embedding = tsne.fit_transform(X_arr)
    return {"embedding": embedding}
