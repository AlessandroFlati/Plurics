def run(returns, p=1, q=1, extra_params=None):
    from arch import arch_model
    extra_params = extra_params or {}
    model = arch_model(returns, vol='Garch', p=int(p), q=int(q), **extra_params)
    result = model.fit(disp='off')
    return {
        "aic": float(result.aic),
        "bic": float(result.bic),
        "conditional_volatility": result.conditional_volatility,
        "model": result,
    }
