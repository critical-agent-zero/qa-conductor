#!/bin/bash
# MEDIUM 2 and 3 shapes at the current head
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36f/fixes
cd "$D/probe" || exit 1
N=/Users/mc/.nvm/versions/node/v24.14.0/bin/node
run() { perl -e 'setpgrp(0,0); alarm 300; exec @ARGV' "$N" --max-old-space-size=8000 "$@" 2>&1; echo "[exit $?]"; }
echo "=== a-base-null (review-36e's, unchanged)"
for a in "1000 control drop a" "1000 now-fail drop a" "1000 late-base drop a" "1000 now-fail drop z" "600 now-fail drop a" "120 now-fail fat a" "120 late-base fat a" "260 now-fail fat a" "120 control fat a"; do
  run a-base-null.mjs $a
done
echo "=== a2-base-null (more shapes: never, open-fail, the PR's tables older than its seed)"
for m in now-fail late-base never open-fail; do
  for o in 0 1; do
    run a2-base-null.mjs 1000 $m drop a $o
  done
done
for m in never open-fail; do
  for o in 0 1; do
    run a2-base-null.mjs 260 $m fat a $o
  done
done
echo "=== c-amber-seeded (review-36e's, unchanged)"
for a in "0 drop 4 a" "1000 drop 4 a" "499 drop 4 a" "600 drop 4 a" "300 fat 4 a" "1000 drop 4 z" "170 fat 4 a" "300 fat 4 z"; do
  run c-amber-seeded.mjs $a
done
echo "=== d-key-lost-cover (review-36e's low)"
run d-key-lost-cover.mjs
