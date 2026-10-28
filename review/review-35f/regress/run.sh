#!/bin/bash
# run.sh SCRIPT OUT [SECS] [args...]: run a node probe with a group-killing timeout
D=/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/review-35f/regress
cd $D
s=$1; o=$2; t=${3:-300}; shift 3 2>/dev/null
bash $D/to.sh "$t" node "$s" "$@" > "$D/$o" 2>&1
echo "rc=$? lines=$(wc -l < $D/$o)"
