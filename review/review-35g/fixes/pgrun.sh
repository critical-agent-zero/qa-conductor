#!/bin/bash
# usage: bash pgrun.sh <timeout-seconds> <outfile> <cmd...>
# runs cmd in its own process group; kills the whole group on timeout or exit
T=$1; OUT=$2; shift 2
perl -e 'setpgrp(0,0); exec @ARGV' "$@" > "$OUT" 2>&1 &
PID=$!
( sleep "$T"; if kill -0 $PID 2>/dev/null; then echo "TIMEOUT after ${T}s" >> "$OUT"; kill -TERM -$PID 2>/dev/null; sleep 2; kill -KILL -$PID 2>/dev/null; fi ) 2>/dev/null &
W=$!
wait $PID
RC=$?
kill $W 2>/dev/null
pkill -P $W sleep 2>/dev/null
kill -KILL -$PID 2>/dev/null
echo "exit $RC" >> "$OUT"
