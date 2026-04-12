def run(probabilities, base=None):
    from scipy.stats import entropy as scipy_entropy
    kwargs = {}
    if base is not None:
        kwargs["base"] = float(base)
    result = float(scipy_entropy(probabilities, **kwargs))
    return {"entropy": result}
