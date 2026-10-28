#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/regress
cd $D/repo
for v in 7193877 4a284f9 4ed6449; do git show $v:test/data-diff.test.mjs > $D/v$v/data-diff.test.mjs; done
cd $D
bash $D/to.sh 600 node literals.mjs v7193877/data-diff.test.mjs v4a284f9/data-diff.test.mjs v4ed6449/data-diff.test.mjs ../../review-35e/adversarial/probe-corpus.mjs ../../review-35d/adversarial/probe-mask.mjs > $D/out-literals.txt 2>&1
echo rc=$?
tail -3 $D/out-literals.txt
