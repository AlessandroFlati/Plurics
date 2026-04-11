#!/usr/bin/env python3
"""
Cross-checker — queries the OEIS database with predicted terms from a
verified conjecture to determine novelty.

Reads:
  .plurics/shared/verification/{scope}-verification.json   — empirical + extrapolated terms
  .plurics/shared/oeis-manifest.json                        — target sequence ID

Writes:
  .plurics/shared/verification/{scope}-crosscheck.json

Policies:
  - Only runs if the verification had empirical_score == 1.0 (otherwise the
    extrapolated terms are nonsense)
  - Query OEIS for the first ~15 predicted terms (known + extrapolated)
  - If matched_target is true, verdict = "rediscovery"
  - If matched_target is false but other matches exist, verdict = "related"
  - If no matches at all, verdict = "novel"
  - On API error, verdict = "inconclusive"
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


def workspace() -> Path:
    return Path(os.environ.get("PLURICS_WORKSPACE") or os.environ.get("CAAM_WORKSPACE") or os.getcwd())


def shared_dir() -> Path:
    return workspace() / ".plurics" / "shared"


def extract_scope() -> str | None:
    name = os.environ.get("PLURICS_AGENT_NAME") or os.environ.get("CAAM_AGENT_NAME") or ""
    if "." in name:
        rest = name.split(".", 1)[1]
        if "-" in rest:
            parts = rest.split("-")
            if len(parts) >= 4 and parts[:2] == parts[2:4]:
                return "-".join(parts[:2])
        return rest
    return None


def query_oeis(terms: list[int], max_sequences: int = 5) -> list[dict]:
    """Query OEIS with a comma-separated list of terms and return matches."""
    query = ",".join(str(t) for t in terms)
    url = f"https://oeis.org/search?q={query}&fmt=json"
    req = urllib.request.Request(url, headers={"User-Agent": "plurics-sequence-explorer/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        raise RuntimeError(f"OEIS query failed: {exc}")

    # Politeness
    time.sleep(1.0)

    # OEIS returns either a bare JSON array [entry, ...] or a wrapped
    # {"results": [entry, ...]} — handle both.
    if isinstance(data, list):
        results = data
    elif isinstance(data, dict):
        results = data.get("results") or []
    else:
        results = []
    matches = []
    for entry in results[:max_sequences]:
        oeis_id = entry.get("number")
        if oeis_id is None:
            continue
        entry_terms = [int(x) for x in entry.get("data", "").split(",") if x]
        is_exact = all(
            i < len(entry_terms) and entry_terms[i] == t
            for i, t in enumerate(terms)
        )
        matches.append({
            "oeis_id": f"A{int(oeis_id):06d}",
            "name": entry.get("name", ""),
            "is_exact_match": is_exact,
        })
    return matches


def main() -> int:
    scope = extract_scope()
    if not scope:
        print("[cross_checker] ERROR: cannot extract scope", file=sys.stderr)
        return 2

    sh = shared_dir()
    verification_path = sh / "verification" / f"{scope}-verification.json"
    manifest_path = sh / "oeis-manifest.json"

    if not verification_path.exists():
        print(f"[cross_checker] verification not found: {verification_path}", file=sys.stderr)
        return 3
    if not manifest_path.exists():
        print(f"[cross_checker] manifest not found: {manifest_path}", file=sys.stderr)
        return 4

    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    target_oeis = manifest["oeis_id"]

    result: dict = {
        "conjecture_id": scope,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "query_terms": [],
        "matched_sequences": [],
        "verdict": "inconclusive",
        "matched_target": False,
        "notes": "",
    }

    if verification.get("empirical_score", 0) < 1.0:
        result["notes"] = "Skipped: empirical_score < 1.0, extrapolation invalid"
        result["verdict"] = "inconclusive"
    else:
        # Use first 15 predicted terms (known + extrapolated)
        known_terms = manifest["known_terms"][: verification["known_terms_length"]]
        extrapolated = [t for t in verification.get("extrapolated_terms", []) if isinstance(t, int)]
        query_terms = (known_terms + extrapolated)[:15]
        result["query_terms"] = query_terms

        try:
            matches = query_oeis(query_terms)
            result["matched_sequences"] = matches
            result["matched_target"] = any(m["oeis_id"] == target_oeis for m in matches)
            exact_matches = [m for m in matches if m["is_exact_match"]]
            if result["matched_target"]:
                result["verdict"] = "rediscovery"
                result["notes"] = f"Conjecture rediscovers target {target_oeis}"
            elif exact_matches:
                result["verdict"] = "related"
                result["notes"] = f"Matches {len(exact_matches)} other OEIS sequences"
            elif matches:
                result["verdict"] = "related"
                result["notes"] = f"Partial match with {len(matches)} OEIS sequences"
            else:
                result["verdict"] = "novel"
                result["notes"] = "No matches in OEIS — potentially novel"
        except Exception as exc:
            result["verdict"] = "inconclusive"
            result["notes"] = f"OEIS query error: {exc}"

    out_dir = sh / "verification"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{scope}-crosscheck.json"
    tmp = out_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(result, indent=2), encoding="utf-8")
    tmp.replace(out_path)

    print(f"[cross_checker] {scope}: verdict={result['verdict']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
