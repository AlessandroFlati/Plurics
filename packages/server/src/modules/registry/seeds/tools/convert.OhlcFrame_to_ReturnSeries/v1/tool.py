import numpy as np
import pandas as pd


def run(source: pd.DataFrame) -> dict:
    returns = np.log(source["close"]).diff().dropna()
    return {"target": returns}
