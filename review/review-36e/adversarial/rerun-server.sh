#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial
for i in 1 2 3; do
  bash "$D/run-one.sh" "$D/server-$i.out" test/server.test.mjs
  grep -E "^ℹ (pass|fail)|exit=" "$D/server-$i.out" | tr '\n' ' '
  grep "^✖" "$D/server-$i.out" | head -2
  echo
done
