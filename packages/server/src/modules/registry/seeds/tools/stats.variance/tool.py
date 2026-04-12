def run(values):
    import numpy as np
    if not values:
        raise ValueError("values must be a non-empty list")
    return {"variance": float(np.var(values))}
