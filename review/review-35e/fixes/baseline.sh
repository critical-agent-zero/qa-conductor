#!/bin/bash
# usage: baseline.sh <node version> <skip: 1|0> <outfile>
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/fixes
NODE=/Users/mc/.nvm/versions/node/v$1/bin/node
cd $D/repo
if [ "$2" = "1" ]; then SKIP=(--test-skip-pattern='is linear'); else SKIP=(); fi
START=$(date +%s)
perl -e 'setpgrp(0,0); $pid=fork; if(!$pid){exec @ARGV} $SIG{ALRM}=sub{kill -9, -$$; exit 124}; alarm 400; waitpid($pid,0); exit($?>>8)' $NODE "${SKIP[@]}" --test --test-force-exit --test-reporter=spec test/data-diff.test.mjs > $3 2>&1
echo "exit=$? secs=$(( $(date +%s) - START ))" >> $3
grep -E '^ℹ (tests|pass|fail|skipped)|^✖|^exit' $3 | head -20
