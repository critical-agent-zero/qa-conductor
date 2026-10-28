#!/bin/bash
# usage: fuzz-run.sh  -- the reviewers' differential fuzz: the working tree against 7193877 and 4a284f9
D=/private/tmp/claude-502/-Users-mc-Documents-GitHub-homefree--claude-worktrees-qa-conductor-stage05/013e4732-ceef-439a-94a4-f253ff944b6b/scratchpad/fuzz
cd "$D" || exit 1
for old in v7193877 v4a284f9; do
  cp "$old/data-diff.mjs" old/data-diff.mjs
  for seed in 1 2 3; do echo "fuzz-mask vs $old seed $seed: $(node fuzz-mask.mjs 20000 $seed 2>&1 | tail -1)"; done
  echo "fuzz-mask pct vs $old: $(node fuzz-mask.mjs 20000 7 x pct 2>&1 | tail -1)"
done
for seed in 1 2 3; do echo "fuzz seed $seed: $(node fuzz.mjs 20000 $seed 2>&1 | tail -1)"; done
for seed in 1 2; do echo "fuzz-keys seed $seed: $(node fuzz-keys.mjs 50000 $seed 2>&1 | tail -1)"; done
for seed in 1 2; do echo "fuzz-values seed $seed: $(node fuzz-values.mjs 20000 $seed 2>&1 | tail -1)"; done
for seed in 1 2; do echo "fuzz-dsn seed $seed: $(node fuzz-dsn.mjs 3000 $seed 2>&1 | tail -3 | tr '\n' ' ')"; done
