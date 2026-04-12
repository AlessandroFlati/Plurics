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
import os
import json
import base64
import pickle
import traceback
import importlib.util
from pathlib import Path


VALIDATION_DISABLED = os.environ.get("PLURICS_DISABLE_VALIDATION", "0") == "1"

if VALIDATION_DISABLED:
    sys.stderr.write(json.dumps({"type": "validation_disabled", "message": "PLURICS_DISABLE_VALIDATION=1 is set; schema validators are suppressed."}) + "\n")
    sys.stderr.flush()


PICKLE_SCHEMAS = {
    'NumpyArray', 'DataFrame', 'SymbolicExpr',
    'Series', 'OhlcFrame', 'FeaturesFrame',
    'ReturnSeries', 'SignalSeries', 'Statistics',
    'RegressionModel', 'ClusteringModel',
}


class SchemaValidationError(Exception):
    def __init__(self, schema_name: str, message: str):
        self.schema_name = schema_name
        self.message = message
        super().__init__(f"Schema validation failed for {schema_name!r}: {message}")


def load_validator(validator_module_path: str, validator_function: str):
    """Load a validator Python file and return the callable."""
    spec = importlib.util.spec_from_file_location("_validator", validator_module_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, validator_function)


_validator_cache: dict = {}


def get_validator(module_path: str, function_name: str):
    key = (module_path, function_name)
    if key not in _validator_cache:
        _validator_cache[key] = load_validator(module_path, function_name)
    return _validator_cache[key]


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
        if schema_name == 'Series':
            try:
                return f"Series name={value.name!r} dtype={value.dtype} len={len(value)} sample={value.head(3).to_dict()}"
            except Exception:
                return '<unprintable Series>'
        if schema_name == 'OhlcFrame':
            try:
                idx = value.index
                return f"OhlcFrame shape={value.shape} cols={list(value.columns)} dates={idx[0]}..{idx[-1]}"
            except Exception:
                return '<unprintable OhlcFrame>'
        if schema_name == 'FeaturesFrame':
            try:
                return f"FeaturesFrame shape={value.shape} features={list(value.columns)[:5]}"
            except Exception:
                return '<unprintable FeaturesFrame>'
        if schema_name == 'ReturnSeries':
            try:
                import numpy as np
                return f"ReturnSeries len={len(value)} mean={np.mean(value):.6f} std={np.std(value):.6f}"
            except Exception:
                return '<unprintable ReturnSeries>'
        if schema_name == 'SignalSeries':
            try:
                return f"SignalSeries len={len(value)} unique={sorted(value.unique().tolist())} counts={value.value_counts().to_dict()}"
            except Exception:
                return '<unprintable SignalSeries>'
        if schema_name == 'Statistics':
            try:
                keys = list(value.keys())
                sample = {k: value[k] for k in keys[:4]}
                return f"Statistics keys={keys} sample={sample}"
            except Exception:
                return '<unprintable Statistics>'
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
    # Phase 4c: per-port schema info dicts with optional validator_module/validator_function
    input_schema_info = envelope.get("input_schema_info") or {}

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

    # Phase 4c: validate deserialized inputs against their schema validators.
    if not VALIDATION_DISABLED:
        for name, deserialized_value in decoded.items():
            schema_info = input_schema_info.get(name) or {}
            if schema_info.get("validator_module"):
                try:
                    fn_v = get_validator(
                        schema_info["validator_module"],
                        schema_info.get("validator_function", "validate"),
                    )
                    ok, err_msg = fn_v(deserialized_value, schema_info)
                    if not ok:
                        sys.stdout.write(json.dumps({
                            "ok": False,
                            "error": {
                                "category": "schema_validation_failed",
                                "message": str(SchemaValidationError(schema_info.get("name", name), err_msg)),
                                "schema": schema_info.get("name", name),
                            },
                        }))
                        return 1
                except SchemaValidationError:
                    raise
                except Exception as exc:
                    sys.stdout.write(json.dumps({
                        "ok": False,
                        "error": {
                            "category": "schema_validation_failed",
                            "message": f"validator raised an unexpected error for port '{name}': {exc}",
                            "schema": schema_info.get("name", name),
                        },
                    }))
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
