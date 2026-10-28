#!/bin/bash
# usage: bash run-tests.sh <node-version-dir> <outfile> [test files...]
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-36f/fixes
NODE=/Users/mc/.nvm/versions/node/$1/bin/node
OUT=$2
shift 2
cd "$D/repo" || exit 1
FILES="$@"
[ -z "$FILES" ] && FILES="test/*.test.mjs"
perl -e 'setpgrp(0,0); alarm 1500; exec @ARGV' "$NODE" --test --test-force-exit $FILES > "$OUT" 2>&1
echo "[exit $?]" >> "$OUT"
tail -12 "$OUT"
