def run(values, bins=10, range=None):
    import numpy as np
    arr = np.array(values, dtype=float)
    kwargs = {}
    if range is not None:
        kwargs['range'] = tuple(range)
    counts, bin_edges = np.histogram(arr, bins=bins, **kwargs)
    return {"counts": counts, "bin_edges": bin_edges}
