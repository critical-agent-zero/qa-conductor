#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
cd $D
bash $D/pgrun.sh 60 $D/out-mutf-gen.txt node mutate-flags.mjs 2>/dev/null
cat $D/out-mutf-gen.txt
OUT=$D/out-mutf.txt
: > $OUT
while read -r id; do
  [ -z "$id" ] && continue
  M=$D/mutf/$id
  cd $M
  bash $D/pgrun.sh 300 $M/all.txt node --test --test-force-exit test/data-diff.test.mjs test/data-masking-corpus.test.mjs 2>/dev/null
  if grep -q '^ℹ fail 0' $M/all.txt; then c=survives; else c=KILLED; fi
  echo "$id $c $(grep -E '^✖' $M/all.txt | head -3 | cut -c1-120 | tr '\n' '|')" >> $OUT
done < $D/mutf/list.txt
cat $OUT
