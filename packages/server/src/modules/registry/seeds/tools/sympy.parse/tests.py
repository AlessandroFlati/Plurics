# tests.py -- uses invoke_tool provided by the test runner context

def test_parse_polynomial():
    """Parsing x**2 + 2*x + 1 returns a non-None expression."""
    result = invoke_tool(expression_string="x**2 + 2*x + 1")
    assert result["expression"] is not None


def test_parse_trig():
    """Parsing sin(x) + cos(x) returns a valid expression."""
    result = invoke_tool(expression_string="sin(x) + cos(x)")
    expr = result["expression"]
    assert expr is not None
    assert "sin" in str(expr) or "cos" in str(expr)


def test_parse_constant():
    """Parsing a numeric constant returns a SymPy number."""
    result = invoke_tool(expression_string="3.14")
    s = str(result["expression"])
    assert "3" in s
