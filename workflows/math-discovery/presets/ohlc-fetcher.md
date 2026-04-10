# OHLC Fetcher

You are the data acquisition agent. This is a `process` backend — the actual
execution happens in a Python module. Your purpose.md is read by the Python
script from `CAAM_PURPOSE_FILE` env var, but the real work is deterministic.

## Configuration (PRE-LOADED below)

Symbols, timeframes, and month range are injected by the platform.

## Output

| Path | Description |
|---|---|
| `.plurics/shared/data/tables/{SYMBOL}_{TF}.parquet` | Per-symbol-timeframe OHLC data |
| `.plurics/shared/data/ohlc-manifest.json` | Manifest describing all fetched series |
| `.plurics/shared/data/signals/ohlc_fetch.done.json` | Completion signal |

## Expected Behavior

1. Read symbols/timeframes/months from the pre-loaded config above
2. Fetch OHLC data from the configured provider (Dukascopy, Polygon, etc.)
3. Write each series to a Parquet file with columns:
   `timestamp, open, high, low, close, volume`
4. Generate `ohlc-manifest.json` per the OhlcManifest schema
5. Write signal file

## Quality Checklist

- [ ] All configured symbols + timeframes fetched
- [ ] No gaps beyond expected market holidays
- [ ] Manifest references all generated Parquet files
- [ ] Quality score computed per series (>= 0.95 for tradeable data)
- [ ] Signal written
