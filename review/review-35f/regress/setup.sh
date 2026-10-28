#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/regress
cd $D/repo
for v in 7193877 4a284f9 4ed6449 2ec0bba; do
  mkdir -p $D/v$v
  git show $v:lib/data-diff.mjs > $D/v$v/data-diff.mjs || echo fail $v
done
ls -la $D/v*/
node --version
