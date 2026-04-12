def run(data, max_lag):
    import numpy as np
    from statsmodels.tsa.stattools import grangercausalitytests
    results_raw = grangercausalitytests(data, maxlag=int(max_lag), verbose=False)
    output = {}
    for lag, test_dict in results_raw.items():
        stats = test_dict[0]
        output[str(lag)] = {
            "ssr_ftest_pvalue": float(stats['ssr_ftest'][1]),
            "ssr_chi2test_pvalue": float(stats['ssr_chi2test'][1]),
        }
    return {"results": output}
