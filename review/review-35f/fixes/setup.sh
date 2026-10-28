#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/fixes
cd $D
if [ ! -d repo ]; then
  git clone -q https://github.com/critical-labs/qa-conductor repo
fi
cd repo
git fetch -q origin pull/35/head:pr35 2>&1 || git fetch -q -f origin pull/35/head:pr35
git checkout -q pr35
git log --oneline -8
echo "--- name-status 561bd84..HEAD"
git diff --name-status 561bd84..HEAD
echo "--- stat 4a284f9..HEAD"
git diff --stat 4a284f9..HEAD
mkdir -p $D/old79 $D/old2ec $D/old4a $D/mut
git show 7193877:lib/data-diff.mjs > $D/old79/data-diff.mjs
git show 2ec0bba:lib/data-diff.mjs > $D/old2ec/data-diff.mjs
git show 4a284f9:lib/data-diff.mjs > $D/old4a/data-diff.mjs
git show 4a284f9:test/data-diff.test.mjs > $D/old4a/data-diff.test.mjs
ls -la $D/old79 $D/old2ec $D/old4a
