def run(values, q):
    import numpy as np
    if not values:
        raise ValueError("values must be a non-empty list")
    if not (0.0 <= q <= 1.0):
        raise ValueError("q must be in [0, 1]")
    return {"quantile": float(np.quantile(values, q))}
