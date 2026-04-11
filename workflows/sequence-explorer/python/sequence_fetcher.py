#!/usr/bin/env python3
"""
Fetch an OEIS sequence from the online API, cache it, and write the manifest.

Reads configuration from the purpose file (JSON lines embedded in the
plurics purpose.md via PLURICS_PURPOSE_FILE env var) OR from environment:

    SEQUENCE_EXPLORER_OEIS_ID   - target OEIS ID (e.g. "A000045")
    SEQUENCE_EXPLORER_WORKSPACE - workspace path (where .plurics/ lives)

If neither is provided, defaults to A000045 (Fibonacci).

Output: .plurics/shared/oeis-manifest.json
Cache: .plurics/shared/oeis-cache/<oeis_id>.json
Signal: the platform generates the signal from the exit code.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone


def read_purpose_config() -> dict:
    """Extract target_oeis_id from the purpose file if present."""
    purpose_file = os.environ.get("PLURICS_PURPOSE_FILE") or os.environ.get("CAAM_PURPOSE_FILE")
    if not purpose_file or not Path(purpose_file).exists():
        return {}
    text = Path(purpose_file).read_text(encoding="utf-8")
    # Look for "target_oeis_id: AXXXXXX" anywhere in the purpose
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("target_oeis_id:"):
            return {"oeis_id": line.split(":", 1)[1].strip().strip('"').strip("'")}
    return {}


def workspace() -> Path:
    return Path(os.environ.get("PLURICS_WORKSPACE") or os.environ.get("CAAM_WORKSPACE") or os.getcwd())


def shared_dir() -> Path:
    return workspace() / ".plurics" / "shared"


def cache_dir() -> Path:
    d = shared_dir() / "oeis-cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


def fetch_from_oeis(oeis_id: str) -> dict:
    """Query the OEIS JSON API. Returns the raw response."""
    url = f"https://oeis.org/search?q=id:{oeis_id}&fmt=json"
    req = urllib.request.Request(url, headers={"User-Agent": "plurics-sequence-explorer/0.1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_or_fetch(oeis_id: str) -> dict:
    """Check cache first, then hit the API. Cache entries never expire in this
    implementation — sequences don't change on OEIS side."""
    cache_file = cache_dir() / f"{oeis_id}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))
    data = fetch_from_oeis(oeis_id)
    cache_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    # Politeness: avoid slamming OEIS
    time.sleep(1.0)
    return data


def build_manifest(oeis_id: str, raw) -> dict:
    """Normalize the OEIS raw response into the OeisManifest schema.

    OEIS returns either a bare JSON array [entry, ...] or a wrapped
    {"results": [entry, ...]} — handle both.
    """
    if isinstance(raw, list):
        entries = raw
    elif isinstance(raw, dict):
        entries = raw.get("results") or []
    else:
        entries = []
    if not entries:
        raise RuntimeError(f"OEIS ID {oeis_id} not found")
    entry = entries[0]
    data_str = entry.get("data", "")
    known_terms: list[int] = [int(x) for x in data_str.split(",") if x]

    def field_lines(key: str) -> list[str]:
        val = entry.get(key, [])
        if isinstance(val, list):
            return val
        if isinstance(val, str):
            return val.splitlines()
        return []

    # Extract cross-reference OEIS IDs from xref field
    xrefs: list[str] = []
    for line in field_lines("xref"):
        for token in line.split():
            if token.startswith("A") and len(token) >= 6 and token[1:7].isdigit():
                xrefs.append(token[:7])

    return {
        "schema_version": 1,
        "oeis_id": oeis_id,
        "name": entry.get("name", ""),
        "known_terms": known_terms,
        "known_terms_count": len(known_terms),
        "offset": int(str(entry.get("offset", "0")).split(",")[0]),
        "formula_text": field_lines("formula"),
        "example_text": field_lines("example"),
        "cross_references": sorted(set(xrefs)),
        "keywords": (entry.get("keyword", "") or "").split(","),
        "author": entry.get("author", ""),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def write_atomic(path: Path, content: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    cfg = read_purpose_config()
    oeis_id = (
        cfg.get("oeis_id")
        or os.environ.get("SEQUENCE_EXPLORER_OEIS_ID")
        or "A000045"
    )
    print(f"[sequence_fetcher] target: {oeis_id}")

    try:
        raw = load_or_fetch(oeis_id)
        manifest = build_manifest(oeis_id, raw)
    except Exception as exc:
        print(f"[sequence_fetcher] FAILED: {exc}", file=sys.stderr)
        return 1

    out = shared_dir() / "oeis-manifest.json"
    write_atomic(out, json.dumps(manifest, indent=2))
    print(f"[sequence_fetcher] wrote {out} ({manifest['known_terms_count']} terms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
