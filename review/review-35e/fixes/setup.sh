#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/fixes
mkdir -p $D/old79 $D/old2ec $D/mut
git -C $D/repo show 7193877:lib/data-diff.mjs > $D/old79/data-diff.mjs
git -C $D/repo show 2ec0bba:lib/data-diff.mjs > $D/old2ec/data-diff.mjs 2>/dev/null || echo "no 2ec0bba"
git -C $D/repo show 7193877:test/data-diff.test.mjs > $D/old79/data-diff.test.mjs
ls -la $D/old79 $D/old2ec
