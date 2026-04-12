#!/usr/bin/env python3
"""
Plurics tool runner.

Usage: python runner.py <tool_dir> <entry_point>
  tool_dir    - absolute path to a tool version directory (contains tool.py)
  entry_point - "tool.py:run" (module file + function name)

Protocol:
  stdin  - JSON envelope:
             {
               "inputs":         { port_name: value, ... },
               "input_schemas":  { port_name: schema_name, ... },
               "output_schemas": { port_name: schema_name, ... },
               "value_refs":     { handle: { "_schema":..., "_encoding":"pickle_b64", "_data":... }, ... }
             }
             Inputs whose value is { "_type": "value_ref", "_handle": "..." } are resolved
             by looking up the handle in value_refs before calling the tool function.

  stdout - JSON envelope:
             on success (exit 0):    { "ok": true, "outputs": { ... } }
             on tool error (exit 1): { "ok": false, "error": {...} }
             on runner error (exit 2): empty stdout, stderr carries details

Structured schemas listed in PICKLE_SCHEMAS are transported as
  { "_schema": name, "_encoding": "pickle_b64", "_data": base64 }
on both sides. For output ports with structured schemas, the runner also
emits a compact summary as "_summary" (computed by _make_summary).

This file is shipped with the Plurics server and copied to
~/.plurics/registry/runner.py at first initialization. Do not edit the
copy; edit the source in packages/server/src/modules/registry/python/.
"""

import sys
import json
import base64
import pickle
import traceback
import importlib.util
from pathlib import Path


PICKLE_SCHEMAS = {"NumpyArray", "DataFrame", "SymbolicExpr"}


def _make_summary(schema_name, value):
    """Compute a compact human-readable summary of a structured value.

    Returns a dict or None. Never raises — any failure returns None so that
    a summary failure does not fail the tool invocation.
    """
    try:
        if schema_name == "NumpyArray":
            return {
                "shape": list(value.shape),
                "ndim": int(value.ndim),
                "size": int(value.size),
                "dtype": str(value.dtype),
                "sample": value.flat[:5].tolist(),
            }
        if schema_name == "DataFrame":
            return {
                "shape": list(value.shape),
                "columns": list(value.columns),
                "head": value.head(5).to_dict("records"),
                "stats": value.describe().to_dict(),
            }
        if schema_name == "SymbolicExpr":
            try:
                s = str(value)
                return s[:200] + '...' if len(s) > 200 else s
            except Exception:
                return '<unprintable SymbolicExpr>'
    except Exception:
        return None
    return None


def decode_value(raw, schema_name, value_refs):
    """Decode a single input value.

    If raw is a value_ref, look up the handle in value_refs and decode from
    the resolved envelope. Otherwise fall through to the standard path.
    """
    if isinstance(raw, dict) and raw.get("_type") == "value_ref":
        handle = raw.get("_handle", "")
        envelope = value_refs.get(handle)
        if envelope is None:
            raise ValueError("handle_not_found: %s" % handle)
        if not isinstance(envelope, dict) or envelope.get("_encoding") != "pickle_b64":
            raise ValueError(
                "value_ref envelope for handle %s is not a valid pickle_b64 envelope" % handle
            )
        return pickle.loads(base64.b64decode(envelope["_data"]))

    if schema_name in PICKLE_SCHEMAS:
        if not isinstance(raw, dict) or raw.get("_encoding") != "pickle_b64":
            raise ValueError(
                "port with schema %s expects pickle_b64 envelope, got: %s"
                % (schema_name, type(raw).__name__)
            )
        return pickle.loads(base64.b64decode(raw["_data"]))
    return raw


def encode_value(value, schema_name):
    if schema_name in PICKLE_SCHEMAS:
        encoded = {
            "_schema": schema_name,
            "_encoding": "pickle_b64",
            "_data": base64.b64encode(pickle.dumps(value)).decode("ascii"),
        }
        summary = _make_summary(schema_name, value)
        if summary is not None:
            encoded["_summary"] = summary
        return encoded
    return value


def load_entry_point(tool_dir, entry_point):
    if ":" not in entry_point:
        raise ValueError("entry_point must be 'file.py:function', got: %s" % entry_point)
    module_file, func_name = entry_point.split(":", 1)
    module_path = tool_dir / module_file
    if not module_path.is_file():
        raise FileNotFoundError("entry point file not found: %s" % module_path)
    spec = importlib.util.spec_from_file_location("plurics_tool", module_path)
    if spec is None or spec.loader is None:
        raise ImportError("cannot load spec from %s" % module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, func_name):
        raise AttributeError("%s has no function %r" % (module_file, func_name))
    return getattr(module, func_name)


def emit_error(exc_type, message, tb):
    sys.stdout.write(json.dumps({
        "ok": False,
        "error": {"type": exc_type, "message": message, "traceback": tb},
    }))


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: runner.py <tool_dir> <entry_point>\n")
        return 2

    tool_dir = Path(sys.argv[1])
    entry_point = sys.argv[2]

    try:
        envelope = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        sys.stderr.write("malformed stdin JSON: %s\n" % e)
        return 2

    raw_inputs = envelope.get("inputs") or {}
    input_schemas = envelope.get("input_schemas") or {}
    output_schemas = envelope.get("output_schemas") or {}
    # Phase 2: map of handle -> pickle_b64 envelope for resolving value_refs in inputs
    value_refs = envelope.get("value_refs") or {}

    try:
        fn = load_entry_point(tool_dir, entry_point)
    except Exception as e:
        sys.stderr.write("load failed: %s\n%s" % (e, traceback.format_exc()))
        return 2

    try:
        decoded = {
            name: decode_value(raw_inputs[name], input_schemas.get(name, "JsonObject"), value_refs)
            for name in raw_inputs
        }
    except Exception as e:
        emit_error("input_decode_error", str(e), traceback.format_exc())
        return 1

    try:
        result = fn(**decoded)
    except Exception as e:
        emit_error(type(e).__name__, str(e), traceback.format_exc())
        return 1

    if not isinstance(result, dict):
        emit_error(
            "output_type_error",
            "tool must return dict, got %s" % type(result).__name__,
            "",
        )
        return 1

    try:
        encoded = {
            name: encode_value(result[name], output_schemas.get(name, "JsonObject"))
            for name in result
        }
    except Exception as e:
        emit_error("output_encode_error", str(e), traceback.format_exc())
        return 1

    sys.stdout.write(json.dumps({"ok": True, "outputs": encoded}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
