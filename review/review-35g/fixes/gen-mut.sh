#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
cd $D
bash $D/pgrun.sh 60 $D/out-mutate-gen.txt node mutate.mjs 2>/dev/null
cat $D/out-mutate-gen.txt
for f in order_element-first order_dsn-before-element order_scheme-after-element order_dsn-first; do
  echo "---- $f"
  diff $D/v4033285/data-diff.mjs $D/mut/$f/lib/data-diff.mjs
done
