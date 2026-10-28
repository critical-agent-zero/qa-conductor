#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35g/fixes
cd $D/repo
git rev-parse HEAD
for v in 2ec0bba 7193877 4a284f9 4ed6449 4033285; do
  mkdir -p $D/v$v
  git show $v:lib/data-diff.mjs > $D/v$v/data-diff.mjs || echo fail $v
  git show $v:test/data-diff.test.mjs > $D/v$v/data-diff.test.mjs 2>/dev/null || echo "no test at $v"
done
git show 4033285:test/data-masking-corpus.test.mjs > $D/v4033285/data-masking-corpus.test.mjs
wc -l $D/v*/data-diff.mjs
# copy prior-round probes
mkdir -p $D/p35f $D/p35e $D/p35d
R=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run
cp $R/review-35f/regress/*.mjs $D/p35f/
cp $R/review-35f/fixes/probes/*.mjs $D/p35f/ 2>/dev/null
cp $R/review-35e/adversarial/*.mjs $D/p35e/
cp $R/review-35e/fixes/*.mjs $D/p35e/
cp $R/review-35d/adversarial/*.mjs $D/p35d/
cp $R/review-35d/fixes/*.mjs $D/p35d/
ls $D/p35f $D/p35e $D/p35d
