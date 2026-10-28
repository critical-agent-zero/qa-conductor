#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/fixes
E=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e
P=$D/probes
cd $P
sed -e "s#import \* as NEW from './new/data-diff.mjs'#const NEW = await import('../head/data-diff.mjs')#" \
    -e "s#import \* as OLD from './old/data-diff.mjs'#const OLD = await import(process.env.BASE === '4a' ? '../old4a/data-diff.mjs' : '../old79/data-diff.mjs')#" \
    $E/adversarial/fuzz-flags.mjs > fuzz-flags.mjs
: > $P/out-fuzz-all.txt
for base in 79 4a; do
  for args in "30000 1" "40000 11 notaglt pct" "40000 7 notaglt" "40000 23"; do
    BASE=$base bash $D/pgrun.sh 900 $P/out-fuzz-one.txt node fuzz-mask.mjs $args 2>/dev/null
    echo "base=$base args=$args" >> $P/out-fuzz-all.txt
    cat $P/out-fuzz-one.txt >> $P/out-fuzz-all.txt
  done
done
grep -E '^base=|^N=|TIMEOUT|^exit' $P/out-fuzz-all.txt
for args in "8000 5" "8000 9"; do
  BASE=4a bash $D/pgrun.sh 900 $P/out-fuzzflags-one.txt node fuzz-flags.mjs $args 2>/dev/null
  echo "flags base=4a args=$args"; grep -E '^N=|TIMEOUT|^exit' $P/out-fuzzflags-one.txt; head -5 $P/out-fuzzflags-one.txt
done
