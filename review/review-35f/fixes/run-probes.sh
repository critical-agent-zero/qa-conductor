#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/fixes
P=$D/probes
cd $P
sed -e "s#'./repo/lib/data-diff.mjs'#'../head/data-diff.mjs'#" -e "s#'./old79/data-diff.mjs'#'../old79/data-diff.mjs'#" probe-fold.orig.mjs > probe-fold.mjs
sed -e "s#'./repo/lib/data-diff.mjs'#'../head/data-diff.mjs'#" probe-words.orig.mjs > probe-words.mjs
sed -e "s#\${here}repo/lib/data-diff.mjs#\${here}../head/data-diff.mjs#" -e "s#'./repo/lib/data-diff.mjs'#'../head/data-diff.mjs'#" probe-mutcols.orig.mjs > probe-mutcols.mjs
uptime
bash $D/pgrun.sh 300 $P/out-regress3.txt node probe-regress3.mjs
cat $P/out-regress3.txt
bash $D/pgrun.sh 300 $P/out-words.txt node probe-words.mjs
cat $P/out-words.txt
bash $D/pgrun.sh 300 $P/out-fold.txt node probe-fold.mjs
cat $P/out-fold.txt
bash $D/pgrun.sh 300 $P/out-mutcols.txt node probe-mutcols.mjs
cat $P/out-mutcols.txt
bash $D/pgrun.sh 300 $P/out-corpus.txt node probe-corpus.mjs
grep -vE '^ok ' $P/out-corpus.txt
BASE=4a bash $D/pgrun.sh 300 $P/out-corpus-4a.txt node probe-corpus.mjs
echo "--- vs 4a284f9"; grep -vE '^ok ' $P/out-corpus-4a.txt
bash $D/pgrun.sh 300 $P/out-mask.txt node probe-mask.mjs
cat $P/out-mask.txt
BASE=4a bash $D/pgrun.sh 300 $P/out-mask-4a.txt node probe-mask.mjs
echo "--- vs 4a284f9"; grep -E 'REGRESSION|fixed|^exit' $P/out-mask-4a.txt
