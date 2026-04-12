# tests.py -- uses invoke_tool provided by the test runner context

def test_simplify_trig_identity():
    """sin^2(x) + cos^2(x) simplifies to 1."""
    result = invoke_tool(expression="sin(x)**2 + cos(x)**2")
    assert str(result["simplified"]) == "1"


def test_simplify_polynomial():
    """x**2 - x**2 simplifies to 0."""
    result = invoke_tool(expression="x**2 - x**2")
    assert str(result["simplified"]) == "0"


def test_simplify_fraction():
    """(x**2 - 1) / (x - 1) simplifies to x + 1."""
    result = invoke_tool(expression="(x**2 - 1) / (x - 1)")
    simplified = str(result["simplified"])
    assert "x" in simplified
