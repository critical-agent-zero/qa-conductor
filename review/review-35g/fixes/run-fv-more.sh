#!/bin/bash
# fuzz-values at the author's likely settings (2 x 20,000, seeds 1 and 2) and
# more seeds, against 4a284f9 and 4ed6449, to size the residual class.
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
cd $D
mkdir -p fz2
for o in 4a284f9 4ed6449; do
  for s in 1 2; do bash $D/pgrun.sh 600 $D/fz2/fv-$o-n20k-s$s.txt env O1=$o node fuzz-values.mjs 20000 $s 2>/dev/null; head -1 $D/fz2/fv-$o-n20k-s$s.txt; done
  for s in 4 5 6 7 8; do bash $D/pgrun.sh 600 $D/fz2/fv-$o-s$s.txt env O1=$o node fuzz-values.mjs 40000 $s 2>/dev/null; head -1 $D/fz2/fv-$o-s$s.txt; done
done
echo done
