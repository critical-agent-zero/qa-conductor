#!/bin/bash
# MEDIUM 1 shapes at the current head: s2-wide-rows T=5/20/45, s1 200 delete 32, w2 both 100/300 6, vf-wide
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36f/fixes
cd "$D/probe" || exit 1
N=/Users/mc/.nvm/versions/node/v24.14.0/bin/node
run() { perl -e 'setpgrp(0,0); alarm 300; exec @ARGV' "$N" --max-old-space-size=8000 "$@" 2>&1; echo "[exit $?]"; }
echo "=== s2-wide-rows"
for a in "5 a 0" "20 a 0" "45 a 0" "5 a 40" "45 z 0"; do
  run s2-wide-rows.mjs $a | grep -v "^    "
done
echo "=== s1-flagged-padding"
for a in "200 delete 32 a" "300 drop 32 a" "1000 drop 1 a" "1000 delete 1 a"; do
  run s1-flagged-padding.mjs $a
done
echo "=== w2-judgment"
for a in "both 100 6" "both 300 6" "rename 600 30" "touch 1200"; do
  run w2-judgment.mjs $a
done
echo "=== vf-wide (verify-fixes-0-repro's own probe)"
for a in "wide 5 50" "wide 20 12" "wide 45 6" "wide 45 3" "both 100 50 200" "both 300 50 200"; do
  run vf-wide.mjs $a
done
