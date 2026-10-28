#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36f/adversarial
cd "$D/repo" || exit 1
perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' 900 node --test --test-force-exit test/*.test.mjs > "$D/tests.out" 2>&1
echo "exit $?" >> "$D/tests.out"
