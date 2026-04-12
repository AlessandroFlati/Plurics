def run(x, y):
    import numpy as np
    ax = np.array(x, dtype=float)
    ay = np.array(y, dtype=float)
    if ax.shape != ay.shape:
        raise ValueError("x and y must have the same length")
    ax_norm = ax - ax.mean()
    ay_norm = ay - ay.mean()
    ccf = np.correlate(ax_norm, ay_norm, mode='full')
    denom = np.sqrt(np.dot(ax_norm, ax_norm) * np.dot(ay_norm, ay_norm))
    if denom == 0:
        raise ValueError("one of the inputs has zero variance")
    return {"ccf": (ccf / denom).tolist()}
