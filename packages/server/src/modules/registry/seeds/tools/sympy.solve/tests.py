# tests.py -- uses invoke_tool provided by the test runner context

def test_linear_equation():
    """x - 3 = 0 solves to x = 3."""
    result = invoke_tool(expr="x - 3", variable="x")
    assert "3" in result["solutions"]


def test_quadratic_equation():
    """x**2 - 4 = 0 has solutions 2 and -2."""
    result = invoke_tool(expr="x**2 - 4", variable="x")
    solutions = set(result["solutions"])
    assert "2" in solutions and "-2" in solutions


def test_no_real_solution_returns_list():
    """solve always returns a list (even if empty or complex)."""
    result = invoke_tool(expr="x**2 + 1", variable="x")
    assert isinstance(result["solutions"], list)
