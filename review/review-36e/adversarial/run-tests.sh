#!/bin/bash
# run the suite with a hard timeout, in its own process group
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial
cd "$D/repo" || exit 1
perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' 900 node --test --test-force-exit --test-timeout=600000 test/*.test.mjs > "$D/npm-test.out" 2>&1
echo "exit=$?" >> "$D/npm-test.out"
