#!/bin/bash
# run one or more test files with a hard timeout, in their own process group
# usage: run-one.sh OUTFILE TESTFILE... [-- extra node args via NODE_ARGS env]
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36e/adversarial
OUT=$1; shift
cd "$D/repo" || exit 1
perl -e 'setpgrp(0,0); alarm shift; exec @ARGV' 600 node --test --test-force-exit --test-timeout=300000 $NODE_ARGS "$@" > "$OUT" 2>&1
echo "exit=$?" >> "$OUT"
