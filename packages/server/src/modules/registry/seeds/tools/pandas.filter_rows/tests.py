# tests.py -- uses invoke_tool provided by the test runner context

def test_filter_reduces_rows():
    """Query keeps only rows matching condition."""
    import pandas as pd
    df = pd.DataFrame({"a": [1, 2, 3, 4], "b": [10, 20, 30, 40]})
    result = invoke_tool(df=df, query="a > 2")
    assert len(result["filtered"]) == 2


def test_filter_all_pass():
    """Query that matches all rows returns full DataFrame."""
    import pandas as pd
    df = pd.DataFrame({"x": [5, 6, 7]})
    result = invoke_tool(df=df, query="x > 0")
    assert len(result["filtered"]) == 3


def test_filter_none_pass():
    """Query that matches no rows returns empty DataFrame."""
    import pandas as pd
    df = pd.DataFrame({"x": [1, 2, 3]})
    result = invoke_tool(df=df, query="x > 100")
    assert len(result["filtered"]) == 0
