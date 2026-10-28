#!/bin/bash
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/regress
cd $D/repo
echo "load before: $(uptime)" > $D/out-test-dd.txt
bash $D/to.sh 600 node --test --test-force-exit test/data-diff.test.mjs >> $D/out-test-dd.txt 2>&1
echo "rc=$?" >> $D/out-test-dd.txt
echo "load after: $(uptime)" >> $D/out-test-dd.txt
echo "load before: $(uptime)" > $D/out-test-al.txt
bash $D/to.sh 300 node --test --test-force-exit test/action-log.test.mjs >> $D/out-test-al.txt 2>&1
echo "rc=$?" >> $D/out-test-al.txt
grep -E '^# (tests|pass|fail)|^ℹ (tests|pass|fail)|^not ok|^✖|rc=|load' $D/out-test-dd.txt $D/out-test-al.txt
