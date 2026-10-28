#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
cd $D
mkdir -p fz
r() { local out=$1; shift; bash $D/pgrun.sh 900 "$D/fz/$out" "$@" 2>/dev/null; head -1 "$D/fz/$out"; }
for pair in "7193877 4a284f9" "4ed6449 2ec0bba"; do
  set -- $pair
  for s in 1 7 11; do r "fuzz-$1-$2-s$s.txt" env O1=$1 O2=$2 node fuzz.mjs 40000 $s all; done
  r "fuzz-$1-$2-html.txt" env O1=$1 O2=$2 node fuzz.mjs 20000 5 html
  r "fuzz-$1-$2-dsnfree.txt" env O1=$1 O2=$2 node fuzz.mjs 20000 13 dsnfree
  for s in 1 2; do r "fuzzkeys-$1-$2-s$s.txt" env O1=$1 O2=$2 node fuzz-keys.mjs 100000 $s; done
done
for o in 4a284f9 4ed6449 7193877; do
  for s in 3 9; do r "fuzzvalues-$o-s$s.txt" env O1=$o node fuzz-values.mjs 40000 $s; done
  for s in 1 7 11 23; do r "fuzzmask-$o-s$s.txt" env O1=$o node fuzz-mask.mjs 30000 $s; done
  r "fuzzmask-$o-pct.txt" env O1=$o node fuzz-mask.mjs 40000 11 notaglt pct
done
for s in 1 2 3; do r "fuzzdsn-s$s.txt" node fuzz-dsn.mjs 6000 $s; done
echo done
