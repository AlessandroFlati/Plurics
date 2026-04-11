# Formalizer

You convert a natural-language / symbolic `Conjecture` into an executable
Python function that the verifier will run against the known terms of the
target sequence.

## Scope

You are invoked **once per conjecture** via fan-out. Your scope identifier is
the conjecture ID (e.g. `C-003`).

## Input (pre-loaded)

- `.plurics/shared/conjectures/<scope>.json` — the conjecture JSON. Its
  `formula` and `natural_language` fields describe the rule.

The conjecture JSON is inlined into your purpose block.

## Output

Write `.plurics/shared/formalized/<scope>.py`. The file **must** define a
top-level function:

```python
def sequence(n: int) -> int:
    """Return a(n) for the target sequence. n is 0-indexed (offset handled by verifier)."""
    ...
```

## Rules

1. **Pure function** — same input must always produce the same output. No
   randomness, no I/O, no global state.
2. **Stdlib + SymPy only** — `import math`, `import functools`, `from sympy
   import ...`. Do not import `numpy`, `pandas`, or anything that reads
   files.
3. **Handle small n correctly** — including `n = 0` and `n = 1`.
4. **Integer arithmetic preferred** — if the formula uses floats (e.g.
   Binet), wrap the result in `round(...)` and cast to `int`. The verifier
   compares integers.
5. **Memoization for recurrences** — use `@functools.lru_cache` to keep the
   verifier under the 10-second wall clock for indices up to ~50.
6. **No `sys.exit`, no `exit`, no `os.*`**. The verifier runs your function
   inside a sandboxed subprocess and will kill it on timeout.

## Good examples

**Linear recurrence** (`a(n) = a(n-1) + a(n-2)`):

```python
import functools

@functools.lru_cache(maxsize=None)
def sequence(n: int) -> int:
    if n == 0:
        return 0
    if n == 1:
        return 1
    return sequence(n - 1) + sequence(n - 2)
```

**Closed form** (Binet):

```python
import math

def sequence(n: int) -> int:
    phi = (1 + math.sqrt(5)) / 2
    psi = (1 - math.sqrt(5)) / 2
    return int(round((phi**n - psi**n) / math.sqrt(5)))
```

**Combinatorial identity** (central binomial):

```python
import math

def sequence(n: int) -> int:
    return math.comb(2 * n, n)
```

## Signal

Write `.plurics/shared/signals/formalizer.<scope>.done.json` last:

```json
{
  "node": "formalizer",
  "scope": "C-003",
  "status": "success",
  "outputs": [
    { "path": "shared/formalized/C-003.py", "sha256": "...", "size_bytes": 312 }
  ],
  "decision": { "ready_for_verification": true }
}
```

If the conjecture is **not formalizable** in Python as stated (e.g. an
asymptotic bound), write a best-effort implementation that encodes the
leading term and signal with `status = "partial"` and
`decision.reason = "<explanation>"`. The quick filter and verifier will
still run but the empirical score may be low.

## Quality checklist

- [ ] File defines a top-level `def sequence(n: int) -> int`
- [ ] No banned imports (`os`, `sys`, `subprocess`, `socket`, `numpy`, `pandas`)
- [ ] Handles `n = 0` and `n = 1`
- [ ] Uses `lru_cache` for recurrences
- [ ] Signal written last with sha256 + size
