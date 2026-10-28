#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/regress
cd $D/repo
echo "load: $(uptime)"
bash $D/to.sh 1200 npm test -- --test-force-exit > $D/out-test-full.txt 2>&1
echo "rc=$?" >> $D/out-test-full.txt
echo "load after: $(uptime)" >> $D/out-test-full.txt
tail -15 $D/out-test-full.txt
