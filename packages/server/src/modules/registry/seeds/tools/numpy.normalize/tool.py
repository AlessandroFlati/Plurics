def run(array, norm):
    import numpy as np
    arr = np.array(array, dtype=float)
    valid_norms = {"l1", "l2", "max"}
    if norm not in valid_norms:
        raise ValueError(f"norm must be one of {sorted(valid_norms)}, got '{norm}'")
    if norm == "l1":
        n = np.sum(np.abs(arr))
    elif norm == "l2":
        n = np.sqrt(np.sum(arr ** 2))
    else:  # max
        n = np.max(np.abs(arr))
    if n == 0:
        raise ValueError("Cannot normalize a zero array")
    return {"result": arr / n}
