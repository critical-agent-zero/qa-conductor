# #8 review tooling and worker notes (backup, not product code)

This branch saves material from the local run directory that isn't on GitHub otherwise. It was saved at the 2026-10-28 handover; see the run-state comment on #8.

- `review/review-35e` to `review-35g`: the reviewers' work on #35's masking engine, rounds 5 to 7.
  - fuzzers: `fuzz.mjs`, `fuzz-keys.mjs`, `fuzz-values.mjs`, `fuzz-dsn.mjs`, `fuzz-mask.mjs`, and round 7's `gen.mjs`, `fuzz-rows.mjs` and `fuzz-over.mjs`;
  - probes, mutation harnesses, outputs (`out-*.txt`), and each round's `findings.json` and verdict.
  - `review-35g/regress/vfix/lib/data-diff.mjs` is round 7's prototype for maskInText, and `review-35g/vfix.diff` is its diff against `4033285`.
  - `review-35g/partial-results.json` holds round 7's raw results: both lenses and the 5 skeptics that finished.
- `review/review-36e`, `review-36f`: the reviewers' probes for #36's data answer, round 5. Round 6 re-runs `review-36f/fixes/probe/*.mjs`.
- `w1-notes`: the worker's own notes, patch scripts and reply drafts. Its ledger for #35 to #37 is `ledger-35-37.md`.

The scripts use absolute paths from the machine they ran on, and the head copies they compare (`heads/<sha>/`, `v<sha>/`) aren't included. Recreate those with `git show <sha>:lib/data-diff.mjs`. The secrets in these files are fake test values.
