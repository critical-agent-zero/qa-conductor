#!/bin/bash
# For each mutant: the corpus test, then (if it survives) data-diff.test.mjs.
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
OUT=$D/out-mut.txt
: > $OUT
while read -r id; do
  [ -z "$id" ] && continue
  M=$D/mut/$id
  cd $M
  bash $D/pgrun.sh 120 $M/corpus.txt node --test --test-force-exit test/data-masking-corpus.test.mjs 2>/dev/null
  if grep -q '^# fail 0' $M/corpus.txt || grep -q '^ℹ fail 0' $M/corpus.txt; then c=survives; else c=KILLED; fi
  if [ $c = survives ]; then
    bash $D/pgrun.sh 300 $M/dd.txt node --test --test-force-exit test/data-diff.test.mjs 2>/dev/null
    if grep -q '^# fail 0' $M/dd.txt || grep -q '^ℹ fail 0' $M/dd.txt; then d=survives; else d=KILLED; fi
  else d=-; fi
  echo "$id corpus=$c dd=$d" >> $OUT
done < $D/mut/list.txt
echo done >> $OUT
