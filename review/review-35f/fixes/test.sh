#!/bin/bash
# usage: bash test.sh <nodeversion> <outfile> [files...]
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/fixes
V=$1; OUT=$2; shift 2
NODE=/Users/mc/.nvm/versions/node/v$V/bin/node
cd "$D/repo" || exit 1
uptime > "$OUT.uptime"
if [ $# -gt 0 ]; then
  bash $D/pgrun.sh 1500 "$OUT" $NODE --test --test-force-exit "$@" 2>/dev/null
else
  bash $D/pgrun.sh 1500 "$OUT" $NODE --test --test-force-exit test/*.test.mjs 2>/dev/null
fi
uptime >> "$OUT.uptime"
cat "$OUT.uptime"
grep -E '^ℹ (tests|pass|fail|cancelled|duration_ms)|^exit|TIMEOUT' "$OUT"
grep -E '^✖|not ok' "$OUT" | head -20
