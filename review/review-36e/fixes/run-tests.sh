#!/bin/bash
# usage: bash run-tests.sh NODEBIN OUTFILE [test files...]  (own process group, 600 s alarm)
D="$(cd "$(dirname "$0")" && pwd)"
NODE="$1"; OUT="$2"; shift 2
cd "$D/repo"
if [ $# -eq 0 ]; then set -- test/*.test.mjs; fi
start=$(date +%s)
perl -e 'setpgrp(0,0); alarm 600; exec @ARGV' "$NODE" --test --test-force-exit "$@" > "$OUT" 2>&1
echo "exit $? in $(( $(date +%s) - start ))s"
tail -12 "$OUT"
