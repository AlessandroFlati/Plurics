def run(values, axis=None):
    import numpy as np
    arr = np.array(values, dtype=float)
    result = np.mean(arr) if axis is None else np.mean(arr, axis=axis)
    return {"mean": float(result)}
