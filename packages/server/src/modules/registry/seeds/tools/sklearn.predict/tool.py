def run(model, x):
    import numpy as np
    predictions = model.predict(x)
    return {"predictions": np.asarray(predictions)}
