#!/bin/bash
# usage: fuzz-vs-head.sh <sha>  -- fuzz-mask with <sha>'s engine as old and the working tree as new
D=/private/tmp/claude-502/-Users-mc-Documents-GitHub-homefree--claude-worktrees-qa-conductor-stage05/013e4732-ceef-439a-94a4-f253ff944b6b/scratchpad/fuzz
R=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo
git -C "$R" show "$1:lib/data-diff.mjs" > "$D/old/data-diff.mjs"
cd "$D" || exit 1
for seed in 1 2 3; do echo "fuzz-mask vs $1 seed $seed: $(node fuzz-mask.mjs 20000 $seed 2>&1 | tail -1)"; done
echo "fuzz-mask pct vs $1: $(node fuzz-mask.mjs 20000 7 x pct 2>&1 | tail -1)"
