def run(cause, effect, max_lag=10):
    import numpy as np
    import pandas as pd
    from statsmodels.tsa.stattools import grangercausalitytests
    cause_arr = np.array(cause)
    effect_arr = np.array(effect)
    data = np.column_stack([effect_arr, cause_arr])
    results_raw = grangercausalitytests(data, maxlag=int(max_lag), verbose=False)
    p_values = []
    for lag in range(1, int(max_lag) + 1):
        p_val = float(results_raw[lag][0]['ssr_ftest'][1])
        p_values.append(p_val)
    best_lag = int(np.argmin(p_values)) + 1
    return {"p_values": p_values, "best_lag": best_lag}
