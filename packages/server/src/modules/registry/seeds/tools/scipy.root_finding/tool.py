# Named-function registry for scipy.root_finding.
# Extend FUNCTIONS to add more named functions; do not use eval/exec.

FUNCTIONS = {
    'quadratic_shift': lambda x: x**2 - 2,
    'cubic':           lambda x: x**3 - x - 2,
    'sine':            lambda x: __import__('math').sin(x),
}


def run(function, bracket, extra_params=None):
    from scipy.optimize import brentq
    extra_params = extra_params or {}
    if function not in FUNCTIONS:
        raise ValueError(f"Unknown function '{function}'. Available: {list(FUNCTIONS)}")
    a, b = float(bracket[0]), float(bracket[1])
    try:
        root = brentq(FUNCTIONS[function], a, b, **extra_params)
        converged = True
    except ValueError as exc:
        raise ValueError(f"Root finding failed: {exc}") from exc
    return {
        "root": float(root),
        "converged": converged,
    }
