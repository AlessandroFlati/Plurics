def run(expression, extra_params=None):
    import sympy
    extra_params = extra_params or {}
    return {"simplified": sympy.simplify(expression, **extra_params)}
