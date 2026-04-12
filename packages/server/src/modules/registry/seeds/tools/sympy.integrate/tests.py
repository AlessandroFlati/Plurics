# tests.py -- uses invoke_tool provided by the test runner context

def test_integrate_polynomial():
    """Integral of x is x**2/2."""
    result = invoke_tool(expr="x", variable="x")
    s = str(result["result"])
    assert "x**2" in s or "x^2" in s


def test_integrate_constant():
    """Integral of 1 with respect to x is x."""
    result = invoke_tool(expr="1", variable="x")
    assert "x" in str(result["result"])


def test_integrate_sin():
    """Integral of sin(x) is -cos(x)."""
    result = invoke_tool(expr="sin(x)", variable="x")
    s = str(result["result"])
    assert "cos" in s
