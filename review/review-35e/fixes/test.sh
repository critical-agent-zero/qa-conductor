#!/bin/bash
# usage: test.sh <nodeversion> <outfile> [files...]
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35e/fixes
V=$1; OUT=$2; shift 2
if [ $# -gt 0 ]; then FILES="$*"; else FILES="test/*.test.mjs"; fi
NODE=/Users/mc/.nvm/versions/node/v$V/bin/node
cd "$D/repo" || exit 1
set -m
$NODE --test --test-force-exit $FILES > "$OUT" 2>&1 &
PID=$!
( sleep 600; kill -TERM -- -$PID 2>/dev/null ) &
W=$!
wait $PID
RC=$?
kill $W 2>/dev/null
echo "exit $RC" >> "$OUT"
tail -n 10 "$OUT"
