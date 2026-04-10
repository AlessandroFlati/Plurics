# Writer (claude-code backend)

Write a single sentence about prime numbers to a file, then signal success.

## Output

| Path | Description |
|---|---|
| `.plurics/shared/sentence.txt` | A single sentence about prime numbers |
| `.plurics/shared/signals/writer.done.json` | Signal |

## Steps

1. Write one sentence about an interesting property of prime numbers to `.plurics/shared/sentence.txt`
2. Write the signal file with the output path, sha256, size_bytes

Keep it short. One sentence. Nothing else.
