def run(array, shape):
    import numpy as np
    arr = np.array(array)
    result = arr.reshape(tuple(int(s) for s in shape))
    return {"result": result}
