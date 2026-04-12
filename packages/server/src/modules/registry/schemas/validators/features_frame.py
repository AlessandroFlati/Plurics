import pandas as pd


def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    if not isinstance(value, pd.DataFrame):
        return False, f"Expected pandas.DataFrame, got {type(value).__name__}."
    if value.shape[1] == 0:
        return False, "FeaturesFrame must have at least one feature column."
    if not pd.api.types.is_datetime64_any_dtype(value.index):
        return False, f"FeaturesFrame index must be datetime-like, got {value.index.dtype}."
    for col in value.columns:
        if not pd.api.types.is_numeric_dtype(value[col]):
            return False, f"All feature columns must be numeric; column '{col}' has dtype {value[col].dtype}."
    return True, None
