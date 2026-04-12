# tests.py -- uses invoke_tool provided by the test runner context

def test_differentiate_polynomial():
    """Derivative of x**2 is 2*x."""
    result = invoke_tool(expr="x**2", variable="x")
    s = str(result["result"])
    assert "2*x" in s or "2x" in s


def test_differentiate_constant():
    """Derivative of a constant is 0."""
    result = invoke_tool(expr="5", variable="x")
    assert str(result["result"]) == "0"


def test_differentiate_sin():
    """Derivative of sin(x) is cos(x)."""
    result = invoke_tool(expr="sin(x)", variable="x")
    assert "cos" in str(result["result"])
