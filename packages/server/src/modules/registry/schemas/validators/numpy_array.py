import numpy as np


def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    if not isinstance(value, np.ndarray):
        return False, f"Expected numpy.ndarray, got {type(value).__name__}."
    return True, None
