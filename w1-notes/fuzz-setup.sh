#!/bin/bash
# usage: fuzz-setup.sh  -- copies the engine at 2ec0bba, 7193877, 4a284f9 and the working tree into the
# scratch fuzz dir, with the reviewers' fuzzers wired to them (h.mjs: '4ed6449' stands for the working tree).
set -e
D=/private/tmp/claude-502/-Users-mc-Documents-GitHub-homefree--claude-worktrees-qa-conductor-stage05/013e4732-ceef-439a-94a4-f253ff944b6b/scratchpad/fuzz
R=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo
RUN=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run
mkdir -p "$D/v7193877" "$D/v4a284f9" "$D/v2ec0bba" "$D/v4ed6449" "$D/old" "$D/new"
git -C "$R" show 7193877:lib/data-diff.mjs > "$D/v7193877/data-diff.mjs"
git -C "$R" show 4a284f9:lib/data-diff.mjs > "$D/v4a284f9/data-diff.mjs"
git -C "$R" show 2ec0bba:lib/data-diff.mjs > "$D/v2ec0bba/data-diff.mjs"
cp "$R/lib/data-diff.mjs" "$D/v4ed6449/data-diff.mjs"
cp "$R/lib/data-diff.mjs" "$D/new/data-diff.mjs"
cp "$RUN/review-35f/regress/"{fuzz-dsn.mjs,fuzz-keys.mjs,fuzz-values.mjs,fuzz.mjs,h.mjs} "$D/"
cp "$RUN/review-35e/adversarial/fuzz-mask.mjs" "$D/"
ls "$D"
