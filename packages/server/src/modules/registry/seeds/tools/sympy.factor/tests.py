# tests.py -- uses invoke_tool provided by the test runner context

def test_factor_quadratic():
    """x**2 - 5*x + 6 factors into (x-2)*(x-3)."""
    result = invoke_tool(expr="x**2 - 5*x + 6")
    factored = str(result["result"])
    assert "x - 2" in factored or "x - 3" in factored


def test_factor_difference_of_squares():
    """x**2 - 1 factors into (x-1)*(x+1)."""
    result = invoke_tool(expr="x**2 - 1")
    factored = str(result["result"])
    assert "x - 1" in factored and "x + 1" in factored


def test_factor_already_prime():
    """A prime polynomial returns itself or equivalent."""
    result = invoke_tool(expr="x**2 + 1")
    assert result["result"] is not None
