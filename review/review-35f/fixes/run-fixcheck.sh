#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/fixes
cd $D/fix
uptime
bash $D/pgrun.sh 900 $D/out-fixtests.txt node --test --test-force-exit test/data-diff.test.mjs 2>/dev/null
grep -E '^# (tests|pass|fail)|^exit|TIMEOUT|^not ok' $D/out-fixtests.txt
cd $D/probes
sed -e "s#const NEW = await import('../head/data-diff.mjs')#const NEW = await import(process.env.NEWLIB ?? '../head/data-diff.mjs')#" fuzz-mask.mjs > fuzz-mask-x.mjs
for args in "40000 11 notaglt pct" "30000 1"; do
  NEWLIB=../fix/lib/data-diff.mjs BASE=4a bash $D/pgrun.sh 900 $D/probes/out-fuzzfix-one.txt node fuzz-mask-x.mjs $args 2>/dev/null
  echo "fix vs 4a284f9 args=$args"; grep -E '^N=|TIMEOUT|^exit' $D/probes/out-fuzzfix-one.txt
  NEWLIB=../fix/lib/data-diff.mjs bash $D/pgrun.sh 900 $D/probes/out-fuzzfix-one.txt node fuzz-mask-x.mjs $args 2>/dev/null
  echo "fix vs 7193877 args=$args"; grep -E '^N=|TIMEOUT|^exit' $D/probes/out-fuzzfix-one.txt
done
uptime
