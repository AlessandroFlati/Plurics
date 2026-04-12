def run(left, right, on, how):
    import pandas as pd
    if not isinstance(left, pd.DataFrame):
        raise ValueError("left must be a pandas DataFrame")
    if not isinstance(right, pd.DataFrame):
        raise ValueError("right must be a pandas DataFrame")
    valid_how = {"inner", "outer", "left", "right"}
    if how not in valid_how:
        raise ValueError(f"how must be one of {sorted(valid_how)}, got '{how}'")
    result = pd.merge(left, right, on=list(on), how=how)
    return {"result": result}
