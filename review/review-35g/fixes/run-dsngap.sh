#!/bin/bash
# fuzz-dsn (round 6's generator passwords) against mutants the tests don't kill
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
cd $D
for m in dsn_pw-no-gt dsn_user-word dsn_pw-64; do
  VARIANT=$D/mut/$m/lib/data-diff.mjs bash $D/pgrun.sh 300 $D/fz2/dsn-$m.txt node fuzz-dsn.mjs 6000 1 2>/dev/null
  echo "$m: $(grep -v '^\[h' $D/fz2/dsn-$m.txt | head -1)"
done
