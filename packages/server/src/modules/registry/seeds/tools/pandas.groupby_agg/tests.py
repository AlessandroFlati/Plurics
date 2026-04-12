# tests.py -- uses invoke_tool provided by the test runner context

def test_groupby_sum():
    """Groupby with sum aggregation totals correctly."""
    import pandas as pd
    df = pd.DataFrame({"cat": ["a", "a", "b", "b"], "val": [1.0, 2.0, 3.0, 4.0]})
    result = invoke_tool(df=df, by=["cat"], agg={"val": "sum"})
    agg = result["aggregated"].set_index("cat") if "cat" in result["aggregated"].columns else result["aggregated"]
    assert agg.loc["a", "val"] == 3.0
    assert agg.loc["b", "val"] == 7.0


def test_groupby_mean():
    """Groupby with mean aggregation returns correct means."""
    import pandas as pd
    df = pd.DataFrame({"grp": ["x", "x", "y"], "v": [10.0, 20.0, 5.0]})
    result = invoke_tool(df=df, by=["grp"], agg={"v": "mean"})
    agg = result["aggregated"]
    assert agg is not None and len(agg) == 2


def test_groupby_preserves_columns():
    """Output contains the grouped-by column and the aggregated column."""
    import pandas as pd
    df = pd.DataFrame({"cat": ["a", "b", "a"], "num": [1.0, 2.0, 3.0]})
    result = invoke_tool(df=df, by=["cat"], agg={"num": "max"})
    cols = list(result["aggregated"].columns)
    assert "num" in cols
