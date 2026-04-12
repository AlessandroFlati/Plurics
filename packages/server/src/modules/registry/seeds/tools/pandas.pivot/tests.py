# tests.py -- uses invoke_tool provided by the test runner context

def test_pivot_shape():
    """Pivot table has correct shape from unique index/column values."""
    import pandas as pd
    df = pd.DataFrame({
        "row": ["r1", "r1", "r2", "r2"],
        "col": ["c1", "c2", "c1", "c2"],
        "val": [1.0, 2.0, 3.0, 4.0],
    })
    result = invoke_tool(df=df, index="row", columns="col", values="val")
    pivoted = result["result"]
    assert pivoted.shape == (2, 2)


def test_pivot_values():
    """Pivot table contains correct values."""
    import pandas as pd
    df = pd.DataFrame({
        "row": ["a", "a", "b"],
        "col": ["x", "y", "x"],
        "val": [10.0, 20.0, 30.0],
    })
    result = invoke_tool(df=df, index="row", columns="col", values="val")
    pivoted = result["result"]
    assert pivoted.loc["a", "x"] == 10.0


def test_pivot_index():
    """Pivot index matches unique values of the index column."""
    import pandas as pd
    df = pd.DataFrame({
        "r": ["a", "b", "a"],
        "c": ["x", "x", "y"],
        "v": [1.0, 2.0, 3.0],
    })
    result = invoke_tool(df=df, index="r", columns="c", values="v")
    assert set(result["result"].index) == {"a", "b"}
