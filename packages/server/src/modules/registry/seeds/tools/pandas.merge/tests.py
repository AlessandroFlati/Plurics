# tests.py -- uses invoke_tool provided by the test runner context

def test_inner_join():
    """Inner join keeps only matching rows."""
    import pandas as pd
    left = pd.DataFrame({"id": [1, 2, 3], "a": [10, 20, 30]})
    right = pd.DataFrame({"id": [2, 3, 4], "b": [200, 300, 400]})
    result = invoke_tool(left=left, right=right, on=["id"], how="inner")
    assert len(result["result"]) == 2


def test_left_join():
    """Left join retains all rows from the left DataFrame."""
    import pandas as pd
    left = pd.DataFrame({"id": [1, 2, 3], "a": [1, 2, 3]})
    right = pd.DataFrame({"id": [2, 3], "b": [20, 30]})
    result = invoke_tool(left=left, right=right, on=["id"], how="left")
    assert len(result["result"]) == 3


def test_merged_columns():
    """Result contains columns from both DataFrames."""
    import pandas as pd
    left = pd.DataFrame({"k": ["a", "b"], "x": [1, 2]})
    right = pd.DataFrame({"k": ["a", "b"], "y": [3, 4]})
    result = invoke_tool(left=left, right=right, on=["k"], how="inner")
    cols = list(result["result"].columns)
    assert "x" in cols and "y" in cols
