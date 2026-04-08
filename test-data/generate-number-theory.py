#!/usr/bin/env python3
"""Generate the synthetic number theory dataset for CAAM research swarm testing."""

import pandas as pd
import numpy as np
from sympy import isprime, factorint, totient, mobius, primepi
from sympy.ntheory import divisor_count, divisor_sigma
import math

N = 10000

def collatz_steps(n):
    steps = 0
    while n != 1:
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        steps += 1
    return steps

def digit_sum(n):
    return sum(int(d) for d in str(n))

def is_palindrome(n):
    s = str(n)
    return s == s[::-1]

# Pre-compute Fibonacci set
fib_set = set()
a, b = 1, 1
while a <= N:
    fib_set.add(a)
    a, b = b, a + b

# Table 1: integers
print("Generating integers table...")
rows = []
for n in range(1, N + 1):
    factors = factorint(n)
    rows.append({
        'n': n,
        'is_prime': isprime(n),
        'is_even': n % 2 == 0,
        'n_mod_3': n % 3,
        'n_mod_6': n % 6,
        'num_divisors': divisor_count(n),
        'sum_of_divisors': int(divisor_sigma(n)),
        'euler_totient': int(totient(n)),
        'largest_prime_factor': max(factors.keys()) if factors else 1,
        'digit_count': len(str(n)),
        'digit_sum': digit_sum(n),
        'is_perfect_square': int(math.isqrt(n)) ** 2 == n,
        'is_fibonacci': n in fib_set,
        'collatz_steps': collatz_steps(n),
        'abundance': float(divisor_sigma(n) - n) / n,
        'prime_counting': int(primepi(n)),
        'is_palindrome': is_palindrome(n),
        'mobius': int(mobius(n)),
        'omega': len(factors),
        'bigomega': sum(factors.values()),
        'decade': n // 1000,
    })
    if n % 1000 == 0:
        print(f"  {n}/{N}")

integers = pd.DataFrame(rows)

# Table 2: prime_gaps
print("Generating prime_gaps table...")
primes = integers[integers['is_prime']]['n'].tolist()
gap_rows = []
for i, p in enumerate(primes):
    gap_rows.append({
        'prime_n': p,
        'prime_index': i + 1,
        'gap_to_next': primes[i + 1] - p if i + 1 < len(primes) else None,
        'gap_to_prev': p - primes[i - 1] if i > 0 else None,
    })

prime_gaps = pd.DataFrame(gap_rows)
prime_gaps['is_twin'] = prime_gaps['gap_to_next'] == 2
prime_gaps['is_cousin'] = prime_gaps['gap_to_next'] == 4
prime_gaps['is_sexy'] = prime_gaps['gap_to_next'] == 6
prime_gaps['gap_category'] = pd.cut(
    prime_gaps['gap_to_next'].fillna(0),
    bins=[-1, 4, 12, 1000],
    labels=['small', 'medium', 'large']
)

# Table 3: digit_distributions
print("Generating digit_distributions table...")
digit_rows = []
for n in range(1, N + 1):
    for pos, d in enumerate(reversed(str(n))):
        digit_rows.append({
            'n': n,
            'position': pos,
            'digit_value': int(d),
        })

digit_distributions = pd.DataFrame(digit_rows)

# Save
print("Writing parquet files...")
integers.to_parquet('integers.parquet', index=False)
prime_gaps.to_parquet('prime_gaps.parquet', index=False)
digit_distributions.to_parquet('digit_distributions.parquet', index=False)

integers.head(100).to_csv('integers_sample.csv', index=False)
prime_gaps.head(100).to_csv('prime_gaps_sample.csv', index=False)
digit_distributions.head(100).to_csv('digit_distributions_sample.csv', index=False)

print(f"integers: {len(integers)} rows, {len(integers.columns)} columns")
print(f"prime_gaps: {len(prime_gaps)} rows, {len(prime_gaps.columns)} columns")
print(f"digit_distributions: {len(digit_distributions)} rows, {len(digit_distributions.columns)} columns")
print("Done.")
