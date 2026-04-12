def run(values, bins):
    import numpy as np
    if not values:
        raise ValueError("values must be a non-empty list")
    if bins < 1:
        raise ValueError("bins must be >= 1")
    counts, edges = np.histogram(values, bins=bins)
    return {"counts": counts.tolist(), "edges": edges.tolist()}
