# Named-function registry for scipy.minimize.
# Extend FUNCTIONS to add more named functions; do not use eval/exec.

FUNCTIONS = {
    'rosenbrock': lambda x: (1 - x[0])**2 + 100 * (x[1] - x[0]**2)**2,
    'quadratic':  lambda x: x[0]**2 + x[1]**2,
    'sphere':     lambda x: sum(xi**2 for xi in x),
}


def run(function, initial_guess, method="BFGS", extra_params=None):
    from scipy.optimize import minimize
    import numpy as np
    extra_params = extra_params or {}
    if function not in FUNCTIONS:
        raise ValueError(f"Unknown function '{function}'. Available: {list(FUNCTIONS)}")
    result = minimize(FUNCTIONS[function], np.array(initial_guess), method=method, **extra_params)
    return {
        "x": result.x,
        "fun": float(result.fun),
        "success": bool(result.success),
        "n_iter": int(getattr(result, 'nit', 0)),
    }
