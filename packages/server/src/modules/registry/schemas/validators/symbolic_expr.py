try:
    import sympy
    _sympy_available = True
except ImportError:
    _sympy_available = False


def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    if not _sympy_available:
        return True, None  # Cannot validate without sympy; pass through.
    if not isinstance(value, sympy.Basic):
        return False, f"Expected sympy.Basic, got {type(value).__name__}."
    return True, None
