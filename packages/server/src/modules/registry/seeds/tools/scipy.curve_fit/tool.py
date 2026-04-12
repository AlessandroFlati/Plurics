# Named-function registry for scipy.curve_fit.
# Extend FUNCTIONS to add more model functions; do not use eval/exec.

def _exponential(x, a, b):
    import numpy as np
    return a * np.exp(b * x)


FUNCTIONS = {
    'linear':      lambda x, a, b: a * x + b,
    'quadratic':   lambda x, a, b, c: a * x**2 + b * x + c,
    'exponential': _exponential,
}


def run(function, x, y, initial_guess=None):
    from scipy.optimize import curve_fit
    import numpy as np
    if function not in FUNCTIONS:
        raise ValueError(f"Unknown function '{function}'. Available: {list(FUNCTIONS)}")
    x_arr = np.array(x)
    y_arr = np.array(y)
    p0 = np.array(initial_guess) if initial_guess is not None else None
    parameters, covariance = curve_fit(FUNCTIONS[function], x_arr, y_arr, p0=p0)
    return {
        "parameters": parameters,
        "covariance": covariance,
    }
