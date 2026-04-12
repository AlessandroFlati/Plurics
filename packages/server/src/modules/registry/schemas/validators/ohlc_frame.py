import pandas as pd


REQUIRED_COLUMNS = {"open", "high", "low", "close"}


def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    if not isinstance(value, pd.DataFrame):
        return False, f"Expected pandas.DataFrame, got {type(value).__name__}."
    missing = REQUIRED_COLUMNS - set(value.columns)
    if missing:
        return False, f"OhlcFrame is missing required columns: {sorted(missing)}."
    for col in REQUIRED_COLUMNS:
        if not pd.api.types.is_numeric_dtype(value[col]):
            return False, f"Column '{col}' must be numeric, got dtype {value[col].dtype}."
    if not hasattr(value.index, 'dtype'):
        return False, "OhlcFrame index must be a DatetimeIndex."
    if not (pd.api.types.is_datetime64_any_dtype(value.index)):
        return False, f"OhlcFrame index must be datetime64, got {value.index.dtype}."
    if not value.index.is_monotonic_increasing:
        return False, "OhlcFrame index must be monotonically increasing."
    return True, None
