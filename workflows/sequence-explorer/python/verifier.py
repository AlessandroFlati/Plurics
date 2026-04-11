#!/usr/bin/env python3
"""
Verifier — dynamically loads a formalizer-generated Python function `sequence(n)`
and tests it against the known OEIS terms.

Safety model:
  - Spawns a subprocess with a wall-clock timeout
  - Disables network access via a minimal import shim (best-effort on Windows,
    where `resource.setrlimit` is not available)
  - Only imports math / functools / itertools / fractions / sympy implicitly
    (via the child's default sys.path — no whitelist enforcement beyond module
    availability, since the formalizer is a trusted Claude Code agent)

Environment variables:
  PLURICS_WORKSPACE   - workspace path
  PLURICS_AGENT_NAME  - agent name (e.g. "verifier.C-003") — used to extract scope

The scope is parsed from the agent name suffix (`verifier.C-003` → `C-003`).
The script reads:
  .plurics/shared/formalized/{scope}.py  — the candidate function
  .plurics/shared/oeis-manifest.json      — known terms

And writes:
  .plurics/shared/verification/{scope}-verification.json
"""
from __future__ import annotations

import json
import os
import sys
import time
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime, timezone


def workspace() -> Path:
    return Path(os.environ.get("PLURICS_WORKSPACE") or os.environ.get("CAAM_WORKSPACE") or os.getcwd())


def shared_dir() -> Path:
    return workspace() / ".plurics" / "shared"


def extract_scope() -> str | None:
    name = os.environ.get("PLURICS_AGENT_NAME") or os.environ.get("CAAM_AGENT_NAME") or ""
    # Agent names come as "verifier.C-003-C-003" (base.scope-scope from spawn)
    # or "verifier.C-003". Strip "verifier." prefix and take the first scope segment.
    if "." in name:
        rest = name.split(".", 1)[1]
        # If there's a duplicate (e.g. "C-003-C-003"), take the first half
        if "-" in rest:
            parts = rest.split("-")
            if len(parts) >= 4 and parts[:2] == parts[2:4]:
                return "-".join(parts[:2])
        return rest
    return None


CHILD_SCRIPT_TEMPLATE = r'''
import json, sys, time, traceback, signal, importlib.util

# Disable network imports defensively (best effort)
import socket
def _blocked(*a, **kw):
    raise RuntimeError("network disabled in verifier sandbox")
socket.socket = _blocked  # type: ignore
socket.create_connection = _blocked  # type: ignore

FORMULA_PATH = {formula_path!r}
KNOWN_TERMS = {known_terms!r}
OFFSET = {offset!r}
EXTRAPOLATION_COUNT = {extrapolation_count!r}

def _alarm_handler(signum, frame):
    raise TimeoutError("verifier internal deadline")

try:
    signal.signal(signal.SIGTERM, _alarm_handler)
except Exception:
    pass

result = {{
    "known_terms_length": len(KNOWN_TERMS),
    "predicted_terms_match": 0,
    "empirical_score": 0.0,
    "first_mismatch_index": None,
    "first_mismatch_expected": None,
    "first_mismatch_got": None,
    "extrapolated_terms": [],
    "execution_error": None,
}}

try:
    spec = importlib.util.spec_from_file_location("candidate", FORMULA_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load module from {{FORMULA_PATH}}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    if not hasattr(mod, "sequence"):
        raise RuntimeError("candidate module has no `sequence(n)` function")

    sequence = mod.sequence

    # Empirical check
    matches = 0
    for i, expected in enumerate(KNOWN_TERMS):
        n = i + OFFSET
        try:
            got = sequence(n)
        except Exception as exc:
            result["first_mismatch_index"] = i
            result["first_mismatch_expected"] = expected
            result["first_mismatch_got"] = f"<exception: {{type(exc).__name__}}: {{exc}}>"
            break
        try:
            got_int = int(got)
        except (TypeError, ValueError):
            got_int = got
        if got_int == expected:
            matches += 1
        else:
            result["first_mismatch_index"] = i
            result["first_mismatch_expected"] = expected
            result["first_mismatch_got"] = got_int if isinstance(got_int, (int, str)) else str(got_int)
            break

    result["predicted_terms_match"] = matches
    result["empirical_score"] = matches / len(KNOWN_TERMS) if KNOWN_TERMS else 0.0

    # Extrapolation only if we matched everything known
    if matches == len(KNOWN_TERMS):
        extras = []
        start = len(KNOWN_TERMS) + OFFSET
        for j in range(EXTRAPOLATION_COUNT):
            try:
                v = sequence(start + j)
                extras.append(int(v) if isinstance(v, (int, bool)) else v)
            except Exception as exc:
                extras.append(f"<error: {{exc}}>")
                break
        result["extrapolated_terms"] = extras

except Exception as exc:
    result["execution_error"] = f"{{type(exc).__name__}}: {{exc}}\n{{traceback.format_exc()}}"

print(json.dumps(result))
'''


def main() -> int:
    scope = extract_scope()
    if not scope:
        print("[verifier] ERROR: cannot extract scope from agent name", file=sys.stderr)
        return 2

    sh = shared_dir()
    formula_path = sh / "formalized" / f"{scope}.py"
    manifest_path = sh / "oeis-manifest.json"

    if not formula_path.exists():
        print(f"[verifier] formula not found: {formula_path}", file=sys.stderr)
        return 3
    if not manifest_path.exists():
        print(f"[verifier] manifest not found: {manifest_path}", file=sys.stderr)
        return 4

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    # Use at most 30 known terms for verification (bounds child exec time)
    known_terms = manifest["known_terms"][: int(os.environ.get("VERIFIER_KNOWN_LIMIT", "30"))]
    offset = int(manifest.get("offset", 0))
    extrapolation = int(os.environ.get("VERIFIER_EXTRAPOLATION", "20"))
    timeout = float(os.environ.get("VERIFIER_TIMEOUT", "10"))

    # Emit the child script to a temp file
    child_code = CHILD_SCRIPT_TEMPLATE.format(
        formula_path=str(formula_path),
        known_terms=known_terms,
        offset=offset,
        extrapolation_count=extrapolation,
    )

    start = time.time()
    result: dict
    exit_code = 0
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as tf:
            tf.write(child_code)
            tf_path = tf.name
        try:
            proc = subprocess.run(
                [sys.executable, tf_path],
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        finally:
            try:
                os.unlink(tf_path)
            except OSError:
                pass

        if proc.returncode != 0:
            result = {
                "known_terms_length": len(known_terms),
                "predicted_terms_match": 0,
                "empirical_score": 0.0,
                "first_mismatch_index": None,
                "first_mismatch_expected": None,
                "first_mismatch_got": None,
                "extrapolated_terms": [],
                "execution_error": f"child exit {proc.returncode}: {proc.stderr[:500]}",
            }
            exit_code = 0  # Don't fail the node — the verification result itself captures the failure
        else:
            try:
                result = json.loads(proc.stdout.strip())
            except json.JSONDecodeError as exc:
                result = {
                    "known_terms_length": len(known_terms),
                    "predicted_terms_match": 0,
                    "empirical_score": 0.0,
                    "first_mismatch_index": None,
                    "first_mismatch_expected": None,
                    "first_mismatch_got": None,
                    "extrapolated_terms": [],
                    "execution_error": f"child output parse error: {exc}; raw: {proc.stdout[:300]}",
                }
    except subprocess.TimeoutExpired:
        result = {
            "known_terms_length": len(known_terms),
            "predicted_terms_match": 0,
            "empirical_score": 0.0,
            "first_mismatch_index": None,
            "first_mismatch_expected": None,
            "first_mismatch_got": None,
            "extrapolated_terms": [],
            "execution_error": f"verifier timeout after {timeout}s",
        }

    execution_ms = int((time.time() - start) * 1000)

    full_result = {
        "conjecture_id": scope,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **result,
        "execution_ms": execution_ms,
        "exit_code": exit_code,
    }

    out_dir = sh / "verification"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{scope}-verification.json"
    tmp = out_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(full_result, indent=2), encoding="utf-8")
    tmp.replace(out_path)

    print(
        f"[verifier] {scope}: empirical={full_result['empirical_score']:.2f} "
        f"({full_result['predicted_terms_match']}/{full_result['known_terms_length']})"
    )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
