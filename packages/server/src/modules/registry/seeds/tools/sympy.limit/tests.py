# tests.py -- uses invoke_tool provided by the test runner context

def test_limit_sin_x_over_x():
    """lim_{x->0} sin(x)/x = 1."""
    result = invoke_tool(expr="sin(x)/x", variable="x", point="0")
    assert str(result["result"]) == "1"


def test_limit_polynomial():
    """lim_{x->2} x**2 = 4."""
    result = invoke_tool(expr="x**2", variable="x", point="2")
    assert str(result["result"]) == "4"


def test_limit_at_infinity():
    """lim_{x->oo} 1/x = 0."""
    result = invoke_tool(expr="1/x", variable="x", point="oo")
    assert str(result["result"]) == "0"
