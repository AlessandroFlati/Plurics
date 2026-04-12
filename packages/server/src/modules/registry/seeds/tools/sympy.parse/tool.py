def run(expression_string):
    from sympy.parsing.sympy_parser import parse_expr
    expression = parse_expr(expression_string)
    return {"expression": expression}
